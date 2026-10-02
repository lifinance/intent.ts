import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey, type Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Interface, keccak256 } from "ethers";
import {
  anchorDiscriminator,
  AXELAR_ORACLE_PROGRAM,
  axelarConfigAddress,
  axelarReceiveSteps,
  axelarSubmitInstruction,
  type AxelarMessage,
} from "../../../src/axelar/index";
import { chainMapping, deployment } from "../src/deployment";
import { validateEvmApproval } from "../src/destination";
import { Pending, relayHub, type HubClient, type HubReceipt } from "../src/hub";
import { admission, completed, transaction } from "../src/solana";
import { solanaEvents, type GatewayTransaction } from "../src/source";
import { exclusive, Journal, type StoredTransaction } from "../src/state";
import verification from "./fixtures/verification-status.json" with { type: "json" };

const responses: Record<string, { message: AxelarMessage; status: string }[]> =
  verification.responses;
const gateway = "gtwT4uGVTYSPnTGv6rSpMheyFyczUicxVWKqdtxNGw9";
const gasService = "gasUBnVr9GZon2cp8X5gyFrUsQFhzrprjy734Ci6Bmn";
const payer = new PublicKey(Buffer.alloc(32, 6)).toString();
const blockhash = "11111111111111111111111111111111";
const serializedLength = (tx: Transaction) =>
  tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;

function fixture() {
  const oif = Buffer.concat([
    Buffer.alloc(32, 3),
    Buffer.from("00010140", "hex"),
    Buffer.alloc(320, 9),
  ]);
  const envelope = Buffer.concat([
    Buffer.from("0064010000", "hex"),
    oif,
    Buffer.from("01000000", "hex"),
    new PublicKey(axelarConfigAddress()).toBuffer(),
    Buffer.from([0]),
  ]);
  const message: AxelarMessage = {
    cc_id: { source_chain: "a".repeat(20), message_id: "b".repeat(128) },
    source_address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    destination_chain: "c".repeat(20),
    destination_address: AXELAR_ORACLE_PROGRAM,
    payload_hash: keccak256(envelope).slice(2),
  };
  return {
    gateway,
    payer,
    sourceChainId: 2n,
    sourceKind: "stellar" as const,
    message,
    payload: envelope,
  };
}

test("library builds bounded standard execution and registration transactions", () => {
  const request = fixture(),
    result = axelarReceiveSteps(request);
  expect(result.config).toBe(axelarConfigAddress());
  for (const step of result.steps)
    expect(
      serializedLength(transaction(step.instruction, payer, blockhash)),
    ).toBeLessThanOrEqual(1232);
  const changed = structuredClone(request);
  changed.message.payload_hash = "00".repeat(32);
  expect(() => axelarReceiveSteps(changed)).toThrow();
  expect(() => admission({ contextBytes: 149 })).toThrow();
  expect(admission({ contextBytes: 148 }).fillBytes).toBe(320);
  expect(() => admission({ sourceChainId: String(1n << 128n) })).toThrow();
  const manifest = {
    platform: "solana",
    oracle: AXELAR_ORACLE_PROGRAM,
    gateway,
    gasService,
    chainId: "9",
    chainName: "solana",
    rpcUrl: "http://localhost:8899",
    routes: [{ name: "stellar", chainId: "2", kind: "stellar" }],
  };
  const config = deployment(manifest, payer);
  expect(config.inputOracle).toBe(axelarConfigAddress());
  expect(config.mappings.length).toBe(1);
  for (const ix of [config.initialize, ...config.mappings])
    transaction(ix, payer, blockhash);
  expect(() => deployment({ ...manifest, chainName: "Solana" }, payer)).toThrow(
    /local chain name/,
  );
  const duplicate = { name: "base", chainId: "2", kind: "evm" };
  expect(() =>
    deployment({ ...manifest, routes: [...manifest.routes, duplicate] }, payer),
  ).toThrow(/duplicate/);
  // JSON numbers above 2^53 are already rounded; only exact decimal strings are accepted.
  const unsafe = 9007199254740993;
  expect(() => deployment({ ...manifest, chainId: unsafe }, payer)).toThrow(
    /decimal strings/,
  );
  expect(() =>
    chainMapping({ name: "base", chainId: unsafe, kind: "evm" }, payer),
  ).toThrow(/decimal strings/);
  const exact = chainMapping(
    { name: "base", chainId: "9007199254740993", kind: "evm" },
    payer,
  );
  // Data: discriminator[8] || name (u32 length + "base") || chain_id u128LE || kind.
  const id = Buffer.from(exact.data.slice(2), "hex").subarray(16, 32);
  expect(id.readBigUInt64LE(0)).toBe(9007199254740993n);
});

test("recovery only accepts exact gateway-owned state and signature bits", async () => {
  const r = axelarReceiveSteps(fixture()),
    context = { ...r, gateway },
    execute = r.steps[0]!;
  const data = Buffer.alloc(78);
  data.set(anchorDiscriminator("account", "IncomingMessage"));
  data[13] = 1;
  Buffer.from(r.messageHash.slice(2), "hex").copy(data, 14);
  Buffer.from(r.payloadHash.slice(2), "hex").copy(data, 46);
  const a = { owner: new PublicKey(gateway), data };
  const connection = { getAccountInfo: async () => a };
  expect(await completed(connection, execute, context)).toBe(true);
  data[14]! ^= 1;
  await expect(completed(connection, execute, context)).rejects.toThrow(
    /commitment/,
  );
  data[14]! ^= 1;
  a.owner = new PublicKey(AXELAR_ORACLE_PROGRAM);
  await expect(completed(connection, execute, context)).rejects.toThrow(
    /Invalid IncomingMessage/,
  );
});

test("journal resumes ambiguous broadcast with the identical signed bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "axelar-journal-"));
  try {
    let prepared = 0;
    const job = { message: "bound" },
      path = join(dir, "state.json");
    const first = await new Journal(path, job).load();
    await expect(
      first.transaction(
        "fee",
        async () => {
          prepared++;
          return { id: "hash", raw: "signed bytes" };
        },
        async () => null,
        async () => {
          throw new Error("lost response");
        },
      ),
    ).rejects.toThrow();
    const second = await new Journal(path, job).load();
    const receipt = await second.transaction(
      "fee",
      async (): Promise<StoredTransaction> => {
        throw new Error("must not sign again");
      },
      async (tx) => {
        expect(tx.raw).toBe("signed bytes");
        return { confirmed: true };
      },
      async () => {
        throw new Error("must not broadcast confirmed transaction");
      },
    );
    expect(prepared).toBe(1);
    expect(receipt.confirmed).toBe(true);
    await expect(
      new Journal(path, { message: "substituted" }).load(),
    ).rejects.toThrow(/different message/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Records journal transaction names and answers each with a fixed hub receipt. */
class RecordingJournal extends Journal {
  calls: string[] = [];
  constructor(
    path: string,
    job: unknown,
    private readonly onCall: (name: string) => void,
  ) {
    super(path, job);
  }
  override async transaction<R>(name: string): Promise<R> {
    this.calls.push(name);
    this.onCall(name);
    const receipt: HubReceipt = {
      events: [
        {
          attributes: [
            { key: "multisig_session_id", value: '"9"' },
            { key: "expires_at", value: "62" },
            { key: "verifier_set_id", value: "set-1" },
            { key: "poll_id", value: "1" },
          ],
        },
      ],
    };
    // relayHub only issues hub transactions here, whose result type is HubReceipt.
    return receipt as R;
  }
}

test("full hub flow waits for provider verification and checks signed message identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "axelar-hub-"));
  try {
    const { message: m, payload } = fixture();
    const job = {
      message: m,
      payload: payload.toString("hex"),
      hub: {
        rpcUrl: "http://localhost:26657",
        chainId: "axelar-test",
        sourceGateway: "source",
        destinationGateway: "dest",
        destinationProver: "prover",
        votingVerifier: "verifier",
        gasPrice: "0.025uaxl",
      },
    };
    let routed = false,
      verified = false,
      signed = false;
    const journal = await new RecordingJournal(
      join(dir, "s.json"),
      job,
      (name) => {
        if (name === "hub:end-poll:1") verified = true;
        if (name === "hub:route") routed = true;
      },
    ).load();
    let poll: unknown = null;
    const unused = async (): Promise<never> => {
      throw new Error("unexpected hub transaction call");
    };
    const client: HubClient = {
      getChainId: async () => "axelar-test",
      getHeight: async () => 12,
      queryContractSmart: async (_address, query) => {
        if (query.outgoing_messages) return routed ? [m] : [];
        if (query.messages_status) {
          const status = verified
            ? "succeeded_on_source_chain"
            : poll
              ? "in_progress"
              : "unknown";
          return [{ ...responses[status]![0], message: m }];
        }
        if (query.poll_by_message) return poll;
        if (query.proof)
          return {
            message_ids: [m.cc_id],
            status: signed
              ? { completed: { execute_data: "aabb" } }
              : "pending",
          };
        throw new Error("unexpected query");
      },
      simulate: unused,
      sign: unused,
      getTx: unused,
      broadcastTx: unused,
    };
    await expect(
      relayHub({ client, sender: "payer", job, journal }),
    ).rejects.toBeInstanceOf(Pending);
    poll = { messages: { poll_id: "1", expires_at: 10, finished: false } };
    await expect(
      relayHub({ client, sender: "payer", job, journal }),
    ).rejects.toBeInstanceOf(Pending);
    signed = true;
    expect(await relayHub({ client, sender: "payer", job, journal })).toBe(
      "aabb",
    );
    expect(journal.calls).toEqual([
      "hub:verify:initial",
      "hub:end-poll:1",
      "hub:route",
      "hub:construct",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway extraction preserves actual CPI indices and rejects truncated events", () => {
  const str = (value: string) => {
    const data = Buffer.from(value),
      n = Buffer.alloc(4);
    n.writeUInt32LE(data.length);
    return Buffer.concat([n, data]);
  };
  const data = Buffer.concat([
    Buffer.from("e445a52e51cb9a1d", "hex"),
    anchorDiscriminator("event", "CallContractEvent"),
    new PublicKey(AXELAR_ORACLE_PROGRAM).toBuffer(),
    Buffer.alloc(32, 7),
    str("stellar"),
    str("receiver"),
    str("payload"),
  ]);
  const instructions = [
    { programIdIndex: 0, data: bs58.encode(Buffer.alloc(0)) },
    { programIdIndex: 0, data: bs58.encode(data) },
  ];
  const meta: NonNullable<GatewayTransaction["meta"]> = {
    innerInstructions: [{ index: 2, instructions }],
  };
  const tx: GatewayTransaction = {
    meta,
    transaction: {
      message: {
        getAccountKeys: () => ({ get: () => new PublicKey(gateway) }),
      },
    },
  };
  const events = solanaEvents(tx, "signature", gateway);
  expect(events[0]!.id).toBe("signature-3.2");
  expect(events[0]!.source_address).toBe(AXELAR_ORACLE_PROGRAM);
  instructions[1]!.data = bs58.encode(data.subarray(0, -1));
  expect(() => solanaEvents(tx, "signature", gateway)).toThrow(/Truncated/);
  meta.err = {};
  expect(() => solanaEvents(tx, "signature", gateway)).toThrow(/failed/);
});

test("EVM signed approvals must bind exactly one complete expected message", () => {
  const abi = new Interface([
    "function approveMessages((string sourceChain,string messageId,string sourceAddress,address contractAddress,bytes32 payloadHash)[] messages,(((address signer,uint128 weight)[] signers,uint128 threshold,bytes32 nonce) signers,bytes[] signatures) proof)",
  ]);
  const m = fixture().message,
    oracle = "0x" + "12".repeat(20);
  const encode = (messages: string[][]) =>
    abi
      .encodeFunctionData("approveMessages", [
        messages,
        [[[], 1, "0x" + "00".repeat(32)], []],
      ])
      .slice(2);
  const message = [
    m.cc_id.source_chain,
    m.cc_id.message_id,
    m.source_address,
    oracle,
    "0x" + m.payload_hash,
  ];
  validateEvmApproval(encode([message]), m, oracle);
  expect(() =>
    validateEvmApproval(encode([message, message]), m, oracle),
  ).toThrow(/one EVM/);
  for (let i = 0; i < 5; i++) {
    const wrong = [...message];
    wrong[i] = i < 3 ? "wrong" : "0x" + "34".repeat(i === 3 ? 20 : 32);
    expect(() => validateEvmApproval(encode([wrong]), m, oracle)).toThrow(
      /mismatch/,
    );
  }
});

test("journal excludes simultaneous writers and releases after interruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "axelar-lock-"));
  try {
    const path = join(dir, "journal");
    await expect(
      exclusive(path, async () => {
        await expect(exclusive(path, async () => {})).rejects.toThrow(
          /lock exists/,
        );
        throw new Error("interrupted");
      }),
    ).rejects.toThrow(/interrupted/);
    expect(await exclusive(path, async () => "resumed")).toBe("resumed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("maximum source proofs fit paid and self-relay exports including consuming mode", () => {
  const payload = Buffer.alloc(320);
  Buffer.from("d1252dff", "hex").copy(payload);
  payload.writeUInt32BE(100, 68);
  payload.writeUInt16BE(148, 170);
  for (const consume of [false, true])
    for (const deliveryMode of ["Relayed", "SelfRelay"] as const) {
      const ix = axelarSubmitInstruction({
        gateway,
        gasService,
        payer,
        source: payer,
        payload,
        destinationChain: "a".repeat(20),
        recipientOracle: `0x${"09".repeat(32)}`,
        consume,
        deliveryMode,
        gasAmount: deliveryMode === "Relayed" ? 1n : 0n,
      });
      expect(
        serializedLength(transaction(ix, payer, blockhash)),
      ).toBeLessThanOrEqual(1232);
    }
});
