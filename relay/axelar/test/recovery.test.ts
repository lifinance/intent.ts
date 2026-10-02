import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  Network,
  Wallet,
  type JsonRpcPayload,
  type JsonRpcResult,
} from "ethers";
import { finishOrRenewProof } from "../src/destination";
import { Pending, Rejected } from "../src/hub";
import { Journal } from "../src/state";
import verification from "./fixtures/verification-status.json" with { type: "json" };

const approvalAbi = new Interface([
  "function approveMessages((string sourceChain,string messageId,string sourceAddress,address contractAddress,bytes32 payloadHash)[] messages,(((address signer,uint128 weight)[] signers,uint128 threshold,bytes32 nonce) signers,bytes[] signatures) proof)",
]);
const oracle = "0x" + "12".repeat(20);

// JSON-RPC-level fake: the real ethers Wallet, Contract, evmSend and disk Journal run.
class FakeRpc extends JsonRpcProvider {
  constructor(private readonly handle: (method: string) => unknown) {
    super("http://fake.invalid", Network.from(1n), {
      staticNetwork: true,
      batchMaxCount: 1,
    });
  }
  override async _send(
    payload: JsonRpcPayload | JsonRpcPayload[],
  ): Promise<JsonRpcResult[]> {
    return [payload].flat().map(({ id, method }) => {
      try {
        return { id, result: this.handle(method) } as JsonRpcResult;
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
}) {
  const dir = await mkdtemp(join(tmpdir(), "axelar-recovery-"));
  const message = structuredClone(verification.responses.unknown![0]!.message);
  const job = {
    message,
    payload: "00",
    hub: { chainId: "axelar-test", rpcUrl: "", destinationProver: "prover" },
    destination: {
      platform: "evm",
      chainId: "1",
      gateway: "0x" + "34".repeat(20),
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
  const provider = new FakeRpc((method) => {
    calls.push(method);
    switch (method) {
      case "eth_chainId":
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
      case "eth_getTransactionReceipt":
        return null;
      // Every broadcast loses its response: the node may or may not have the transaction.
      case "eth_sendRawTransaction":
        throw { code: -32000, message: "connection reset" };
    }
    throw { code: -32601, message: `unexpected ${method}` };
  });
  let hubConnects = 0;
  const run = async () =>
    finishOrRenewProof({
      job,
      journal: await new Journal(path, job).load(),
      executeData,
      evm: { signer: new Wallet("0x" + "11".repeat(32), provider) },
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
    executeData,
    hubConnects: () => hubConnects,
    state: async () => (await new Journal(path, job).load()).state,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a lost approval broadcast keeps the proof and its signed bytes even after rotation", async () => {
  const h = await harness({ estimate: "succeeds", currentSet: "set-2" });
  try {
    const error = await h.run().catch((e) => e);
    expect(h.calls).toContain("eth_sendRawTransaction");
    expect(error).not.toBeInstanceOf(Rejected);
    expect(error).not.toBeInstanceOf(Pending);
    expect(h.hubConnects()).toBe(0);
    const state = await h.state();
    expect(state.executeData).toBe(h.executeData);
    expect(state.sessionId).toBe("9");
    expect(Object.keys(state.transactions)).toEqual(["evm:approve:9"]);
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
