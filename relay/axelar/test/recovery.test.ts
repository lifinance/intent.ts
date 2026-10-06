import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Keypair,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  Network,
  Wallet,
  keccak256,
  type JsonRpcPayload,
  type JsonRpcResult,
} from "ethers";
import { finishOrRenewProof } from "../src/destination";
import { sendStep, transaction } from "../src/solana";
import { Pending, Rejected } from "../src/hub";
import { Journal } from "../src/state";
import verification from "./fixtures/verification-status.json" with { type: "json" };

const approvalAbi = new Interface([
  "function approveMessages((string sourceChain,string messageId,string sourceAddress,address contractAddress,bytes32 payloadHash)[] messages,(((address signer,uint128 weight)[] signers,uint128 threshold,bytes32 nonce) signers,bytes[] signatures) proof)",
]);
const oracle = "0x" + "12".repeat(20);

// JSON-RPC-level fake: the real ethers Wallet, Contract, evmSend and disk Journal run.
class FakeRpc extends JsonRpcProvider {
  constructor(
    private readonly handle: (method: string, params: unknown[]) => unknown,
  ) {
    super("http://fake.invalid", Network.from(1n), {
      staticNetwork: true,
      batchMaxCount: 1,
      // The node's answers change between passes; never reuse a recent response.
      cacheTimeout: -1,
    });
  }
  override async _send(
    payload: JsonRpcPayload | JsonRpcPayload[],
  ): Promise<JsonRpcResult[]> {
    return [payload].flat().map(({ id, method, params }) => {
      try {
        return {
          id,
          result: this.handle(method, (params ?? []) as unknown[]),
        } as JsonRpcResult;
      } catch (error) {
        return {
          id,
          error: error as { code: number; message: string },
        } as never;
      }
    });
  }
}

async function harness(t: {
  estimate: "reverts" | "succeeds";
  currentSet: string;
  // "lost": every broadcast loses its response. "reverts": the node accepts it and mines it with status 0.
  broadcast?: "lost" | "reverts";
}) {
  // Hashes the node reports as mined with status 0; tests may add to it between passes.
  const chain = { reverted: new Set<string>() };
  const signer = new Wallet("0x" + "11".repeat(32));
  const gateway = "0x" + "34".repeat(20);
  const dir = await mkdtemp(join(tmpdir(), "axelar-recovery-"));
  const message = structuredClone(verification.responses.unknown![0]!.message);
  const job = {
    message,
    payload: "00",
    hub: { chainId: "axelar-test", rpcUrl: "", destinationProver: "prover" },
    destination: {
      platform: "evm",
      chainId: "1",
      gateway,
      oracle,
    },
  } as never;
  const executeData = approvalAbi
    .encodeFunctionData("approveMessages", [
      [
        [
          message.cc_id.source_chain,
          message.cc_id.message_id,
          message.source_address,
          oracle,
          "0x" + message.payload_hash,
        ],
      ],
      [[[], 1, "0x" + "00".repeat(32)], []],
    ])
    .slice(2);
  const path = join(dir, "journal.json");
  const journal = await new Journal(path, job).load();
  Object.assign(journal.state, {
    sessionId: "9",
    sessionExpiresAt: 70,
    sessionVerifierSet: "set-1",
    executeData,
  });
  await journal.save();
  const calls: string[] = [];
  const broadcasts: string[] = [];
  const provider = new FakeRpc((method, params) => {
    calls.push(method);
    switch (method) {
      case "eth_chainId":
        return "0x1";
      case "eth_blockNumber":
        return "0x1";
      // isMessageExecuted / isMessageApproved: the message is not approved.
      case "eth_call":
        return AbiCoder.defaultAbiCoder().encode(["bool"], [false]);
      case "eth_estimateGas":
        if (t.estimate === "reverts")
          throw { code: 3, message: "execution reverted", data: "0x" };
        return "0x5208";
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x1";
      case "eth_getBlockByNumber": {
        const zero = "0x" + "00".repeat(32);
        return {
          number: "0x1",
          hash: zero,
          parentHash: zero,
          timestamp: "0x0",
          nonce: "0x0000000000000000",
          difficulty: "0x0",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          miner: "0x" + "00".repeat(20),
          extraData: "0x",
          baseFeePerGas: "0x1",
          transactions: [],
        };
      }
      case "eth_getTransactionReceipt": {
        const hash = params[0] as string;
        if (!chain.reverted.has(hash)) return null;
        return {
          transactionHash: hash,
          blockHash: "0x" + "00".repeat(32),
          blockNumber: "0x1",
          transactionIndex: "0x0",
          from: signer.address,
          to: gateway,
          contractAddress: null,
          gasUsed: "0x5208",
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x0",
          type: "0x2",
        };
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as string;
        broadcasts.push(raw);
        if (t.broadcast !== "reverts")
          throw { code: -32000, message: "connection reset" };
        chain.reverted.add(keccak256(raw));
        return keccak256(raw);
      }
    }
    throw { code: -32601, message: `unexpected ${method}` };
  });
  let hubConnects = 0;
  const run = async () =>
    finishOrRenewProof({
      job,
      journal: await new Journal(path, job).load(),
      executeData,
      evm: { signer: signer.connect(provider) },
      connectHub: async () => {
        hubConnects++;
        return {
          queryContractSmart: async (_: string, query: unknown) => {
            expect(query).toBe("current_verifier_set");
            return { id: t.currentSet };
          },
          disconnect() {},
        } as never;
      },
    });
  return {
    run,
    calls,
    chain,
    broadcasts,
    executeData,
    hubConnects: () => hubConnects,
    state: async () => (await new Journal(path, job).load()).state,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a lost approval broadcast keeps the proof and replays its journaled signed bytes even after rotation", async () => {
  const h = await harness({ estimate: "succeeds", currentSet: "set-2" });
  try {
    const error = await h.run().catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/connection reset/);
    expect(error).not.toBeInstanceOf(Rejected);
    expect(error).not.toBeInstanceOf(Pending);
    expect(h.hubConnects()).toBe(0);
    const state = await h.state();
    expect(state.executeData).toBe(h.executeData);
    expect(state.sessionId).toBe("9");
    expect(Object.keys(state.transactions)).toEqual(["evm:approve:9"]);
    const journaled = state.transactions["evm:approve:9"]!;
    expect(h.broadcasts).toEqual([journaled.raw]);

    await expect(h.run()).rejects.toThrow(/connection reset/);
    expect(h.broadcasts).toEqual([journaled.raw, journaled.raw]);
    expect(h.calls.filter((m) => m === "eth_estimateGas")).toHaveLength(1);
    expect(h.hubConnects()).toBe(0);
    expect((await h.state()).transactions).toEqual(state.transactions);
  } finally {
    await h.cleanup();
  }
});

test("a journaled approval later found reverted after rotation discards the proof without rebroadcasting", async () => {
  const h = await harness({ estimate: "succeeds", currentSet: "set-2" });
  try {
    await expect(h.run()).rejects.toThrow(/connection reset/);
    const journaled = (await h.state()).transactions["evm:approve:9"]!;
    // The lost broadcast reached the node and was mined with status 0.
    h.chain.reverted.add(journaled.id);
    await expect(h.run()).rejects.toThrow(/rotated-out Axelar verifier set/);
    expect(h.broadcasts).toHaveLength(1);
    expect(h.hubConnects()).toBe(1);
    const state = await h.state();
    expect(state.executeData).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
    expect(state.proofRequest).toBe("construct:after:9");
  } finally {
    await h.cleanup();
  }
});

test("an approval that passes estimation but reverts on-chain after rotation discards the proof on the first pass", async () => {
  const h = await harness({
    estimate: "succeeds",
    broadcast: "reverts",
    currentSet: "set-2",
  });
  try {
    const error = await h.run().catch((e) => e);
    expect(error).toBeInstanceOf(Pending);
    expect(error.message).toMatch(/EVM transaction 0x[0-9a-f]{64} reverted/);
    expect(h.broadcasts).toHaveLength(1);
    expect(h.hubConnects()).toBe(1);
    const state = await h.state();
    expect(state.executeData).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
    expect(state.proofRequest).toBe("construct:after:9");
  } finally {
    await h.cleanup();
  }
});

test("a confirmed approval revert after rotation discards the proof for a new session", async () => {
  const h = await harness({ estimate: "reverts", currentSet: "set-2" });
  try {
    await expect(h.run()).rejects.toBeInstanceOf(Pending);
    const state = await h.state();
    expect(state.executeData).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
    expect(state.proofRequest).toBe("construct:after:9");
    expect(state.transactions).toEqual({});
  } finally {
    await h.cleanup();
  }
});

test("a confirmed approval revert without rotation keeps the proof and surfaces the rejection", async () => {
  const h = await harness({ estimate: "reverts", currentSet: "set-1" });
  try {
    await expect(h.run()).rejects.toBeInstanceOf(Rejected);
    expect(h.hubConnects()).toBe(1);
    expect((await h.state()).executeData).toBe(h.executeData);
  } finally {
    await h.cleanup();
  }
});

async function solanaHarness(err: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "axelar-recovery-"));
  const journal = await new Journal(join(dir, "journal.json"), {}).load();
  const signer = Keypair.generate();
  const simulated: VersionedTransaction[] = [];
  let sent = 0;
  const connection = {
    getAccountInfo: async () => null,
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    simulateTransaction: async (
      tx: VersionedTransaction,
      config: { sigVerify?: boolean },
    ) => {
      expect(config.sigVerify).toBe(true);
      simulated.push(tx);
      return { context: { slot: 1 }, value: { err, logs: [] } };
    },
    sendRawTransaction: async () => {
      sent++;
      throw new Error("must not broadcast");
    },
  };
  const send = (computeUnitPrice?: number) =>
    sendStep({
      connection: connection as never,
      signer,
      computeUnitPrice,
      journal,
      step: {
        name: "approve:9:approve",
        kind: "approved",
        account: Keypair.generate().publicKey.toBase58(),
        instruction: {
          programId: Keypair.generate().publicKey.toBase58(),
          keys: [],
          data: "0x01",
        },
      } as never,
      context: {} as never,
    });
  return {
    send,
    signer,
    simulated,
    journal,
    sent: () => sent,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a Solana instruction refused in simulation is rejected before it is journaled or broadcast", async () => {
  const h = await solanaHarness({ InstructionError: [1, { Custom: 6000 }] });
  try {
    const error = await h.send().catch((e) => e);
    expect(error).toBeInstanceOf(Rejected);
    expect(error.message).toMatch(/Solana simulation failed: .*Custom.*6000/);
    expect(h.sent()).toBe(0);
    expect(h.journal.state.transactions).toEqual({});
    const [tx] = h.simulated;
    // The exact signed transaction is simulated: limit + Axelar instruction, no priority fee.
    expect(tx!.message.staticAccountKeys[0]!.equals(h.signer.publicKey)).toBe(
      true,
    );
    expect(tx!.signatures[0]!.some((b) => b !== 0)).toBe(true);
    expect(tx!.message.compiledInstructions).toHaveLength(2);
  } finally {
    await h.cleanup();
  }
});

test("a transient Solana simulation failure is retried later rather than treated as a refusal", async () => {
  const h = await solanaHarness("BlockhashNotFound");
  try {
    const error = await h.send(5000).catch((e) => e);
    expect(error).not.toBeInstanceOf(Rejected);
    expect(error.message).toMatch(
      /Solana simulation failed: "BlockhashNotFound"/,
    );
    expect(h.sent()).toBe(0);
    expect(h.journal.state.transactions).toEqual({});
    // The configured priority fee is a SetComputeUnitPrice(5000) instruction.
    const price = h.simulated[0]!.message.compiledInstructions[1]!;
    expect(price.data[0]).toBe(3);
    expect(Buffer.from(price.data).readBigUInt64LE(1)).toBe(5000n);
  } finally {
    await h.cleanup();
  }
});

// Journaled bytes from an earlier pass skip prepare's simulation; the send-time
// preflight refusal must still be classified, without misreading a landed or transient case.
async function resumedSolanaHarness({
  status,
  err,
  rpcMessage = "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1770",
}: {
  status: { err: unknown; confirmationStatus: string } | null;
  err: unknown;
  rpcMessage?: string;
}) {
  const dir = await mkdtemp(join(tmpdir(), "axelar-recovery-"));
  const journal = await new Journal(join(dir, "journal.json"), {}).load();
  const signer = Keypair.generate();
  const ix = {
    programId: Keypair.generate().publicKey.toBase58(),
    keys: [],
    data: "0x01",
  } as const;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const tx = transaction(ix as never, signer.publicKey, blockhash);
  tx.sign(signer);
  const stored = {
    id: bs58.encode(tx.signature!),
    raw: tx.serialize().toString("base64"),
    blockhash,
    lastValidBlockHeight: 100,
  };
  journal.state.transactions["solana:approve:9:approve"] = stored;
  await journal.save();
  const simulated: string[] = [];
  let sent = 0;
  const connection = {
    getAccountInfo: async () => null,
    getBlockHeight: async () => 50,
    getSignatureStatuses: async () => ({
      context: { slot: 1 },
      value: [status],
    }),
    getLatestBlockhash: async () => {
      throw new Error("must not re-sign journaled bytes");
    },
    simulateTransaction: async (v: VersionedTransaction) => {
      simulated.push(Buffer.from(v.serialize()).toString("base64"));
      return { context: { slot: 1 }, value: { err, logs: [] } };
    },
    sendRawTransaction: async () => {
      sent++;
      throw new SendTransactionError({
        action: "simulate",
        signature: stored.id,
        transactionMessage: rpcMessage,
        logs: [],
      });
    },
  };
  const send = () =>
    sendStep({
      connection: connection as never,
      signer,
      journal,
      step: {
        name: "approve:9:approve",
        kind: "approved",
        account: Keypair.generate().publicKey.toBase58(),
        instruction: ix,
      } as never,
      context: {} as never,
    });
  return {
    send,
    stored,
    simulated,
    journal,
    sent: () => sent,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a resumed journaled Solana transaction refused at preflight is rejected so the proof can renew", async () => {
  const h = await resumedSolanaHarness({
    status: null,
    err: { InstructionError: [0, { Custom: 6000 }] },
  });
  try {
    const error = await h.send().catch((e) => e);
    expect(error).toBeInstanceOf(Rejected);
    expect(error.message).toMatch(/Custom.*6000/);
    expect(h.sent()).toBe(1);
    // The exact journaled bytes are what was sent and classified.
    expect(h.simulated).toEqual([h.stored.raw]);
    expect(h.journal.state.transactions["solana:approve:9:approve"]).toEqual(
      h.stored,
    );
  } finally {
    await h.cleanup();
  }
});

test("a resumed Solana preflight error stays ambiguous when the signature already landed or the refusal is transient", async () => {
  for (const c of [
    {
      status: { err: null, confirmationStatus: "confirmed" },
      err: { InstructionError: [0, { Custom: 6000 }] },
    },
    { status: null, err: "BlockhashNotFound" },
    // A node-health RPC error is wrapped in the same class but is no preflight verdict.
    {
      status: null,
      err: { InstructionError: [0, { Custom: 6000 }] },
      rpcMessage: "Node is behind by 200 slots",
    },
  ]) {
    const h = await resumedSolanaHarness(c);
    try {
      const error = await h.send().catch((e) => e);
      expect(error).toBeInstanceOf(SendTransactionError);
      expect(error).not.toBeInstanceOf(Rejected);
    } finally {
      await h.cleanup();
    }
  }
});
