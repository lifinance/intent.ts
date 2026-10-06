import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import type { AxelarMessage } from "../../../src/axelar/index";
import {
  discardRotatedProof,
  Pending,
  relayHub,
  type HubClient,
  type HubReceipt,
} from "../src/hub";
import type { HubConfig } from "../src/source";
import { Journal } from "../src/state";
import verification from "./fixtures/verification-status.json" with { type: "json" };

const responses: Record<string, { message: AxelarMessage; status: string }[]> =
  verification.responses;
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

type Poll = {
  messages: { poll_id: string; expires_at: number; finished: boolean };
};

// Response fixtures come from the pinned provider enum, independently of hub.ts.
// The fake RPC runs the real hubTransaction and disk Journal. Only chain state,
// signing and RPC are substituted; no journal or transaction method is stubbed.
async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "axelar-hub-recovery-"));
  dirs.push(dir);
  const message = structuredClone(responses.unknown![0]!.message);
  const hub: HubConfig = {
    rpcUrl: "http://localhost:26657",
    chainId: "axelar-test",
    sourceGateway: "source",
    destinationGateway: "dest",
    votingVerifier: "verifier",
    destinationProver: "prover",
    gasPrice: "0.025uaxl",
  };
  const job = { message, payload: "00", hub };
  const path = join(dir, "journal.json");
  const f = {
    status: "unknown",
    poll: null as Poll | null,
    height: 20,
    nextPoll: 0,
    routed: false,
    prepared: [] as unknown[],
    broadcasts: [] as string[],
    accepted: [] as string[],
    queries: [] as string[],
    log: [] as string[],
    receipts: new Map<string, HubReceipt>(),
    lostResponse: null as "before inclusion" | "after inclusion" | null,
    afterEndStatus: null as string | null,
    signed: true,
    nextSession: 9,
    signingWindow: 50,
    verifierSet: "set-1",
    job,
    journal: () => new Journal(path, job).load(),
    setPoll(
      status: string,
      id: number,
      {
        finished = true,
        expires = 10,
      }: { finished?: boolean; expires?: number } = {},
    ) {
      f.status = status;
      f.poll = {
        messages: { poll_id: String(id), expires_at: expires, finished },
      };
      f.nextPoll = Math.max(f.nextPoll, id);
    },
  };
  const client: HubClient = {
    getChainId: async () => hub.chainId,
    getHeight: async () => f.height,
    queryContractSmart: async (_address, query) => {
      f.queries.push(Object.keys(query)[0]!);
      if (query.outgoing_messages) {
        if (f.routed) return [message];
        throw new Error(
          `Query failed with (6): rpc error: code = Unknown desc = failed to query outgoing messages: message with ID ${message.cc_id.message_id} not found`,
        );
      }
      if (query.messages_status) return structuredClone(responses[f.status]);
      if (query.poll_by_message) return structuredClone(f.poll);
      if (query === "current_verifier_set")
        return { id: f.verifierSet, verifier_set: {} };
      if (query.proof)
        return {
          message_ids: [message.cc_id],
          status: f.signed
            ? { completed: { execute_data: "aabb" } }
            : "pending",
        };
      throw new Error("Unexpected hub query");
    },
    simulate: async () => 100000,
    sign: async (_sender, messages) => {
      const msg = JSON.parse(Buffer.from(messages[0]!.value.msg).toString());
      f.prepared.push(msg);
      f.log.push("sign");
      return {
        bodyBytes: Buffer.from(
          JSON.stringify({ msg, sequence: f.prepared.length }),
        ),
        authInfoBytes: new Uint8Array(),
        signatures: [],
      };
    },
    getTx: async (id) => {
      f.log.push(`getTx:${id}`);
      return f.receipts.get(id) ?? null;
    },
    broadcastTx: async (raw) => {
      f.broadcasts.push(Buffer.from(raw).toString("base64"));
      const loss = f.lostResponse;
      f.lostResponse = null;
      if (loss === "before inclusion")
        throw new Error("Lost broadcast response");
      const { msg } = JSON.parse(
        Buffer.from(TxRaw.decode(raw).bodyBytes).toString(),
      );
      const operation = Object.keys(msg)[0]!;
      f.accepted.push(operation);
      const attributes: { key: string; value: string }[] = [];
      if (operation === "verify_messages") {
        f.setPoll("in_progress", f.nextPoll + 1, {
          finished: false,
          expires: f.height + 10,
        });
        attributes.push({ key: "poll_id", value: f.poll!.messages.poll_id });
      } else if (operation === "end_poll") {
        expect(msg.end_poll.poll_id).toBe(f.poll!.messages.poll_id);
        f.poll!.messages.finished = true;
        if (f.afterEndStatus) f.status = f.afterEndStatus;
      } else if (operation === "route_messages") f.routed = true;
      else if (operation === "construct_proof")
        attributes.push(
          { key: "multisig_session_id", value: `"${f.nextSession++}"` },
          // The multisig contract's SigningStarted event uses plain to_string.
          { key: "expires_at", value: String(f.height + f.signingWindow) },
          { key: "verifier_set_id", value: f.verifierSet },
        );
      else throw new Error("Unexpected hub transaction");
      const result = { code: 0, events: [{ attributes }] };
      const hash = createHash("sha256").update(raw).digest("hex").toUpperCase();
      f.receipts.set(hash, result);
      if (loss === "after inclusion")
        throw new Error("Lost broadcast response");
      return result;
    },
  };
  // Every pass reloads the journal to exercise persistence across process restarts.
  const run = async () =>
    relayHub({ client, sender: "payer", job, journal: await f.journal() });
  return Object.assign(f, { client, run });
}

const transactions = async (f: { journal: () => Promise<Journal> }) =>
  Object.keys((await f.journal()).state.transactions);

for (const finished of [false, true]) {
  test(`verified message routes immediately with finished=${finished}`, async () => {
    const f = await harness();
    f.setPoll("succeeded_on_source_chain", 1, { finished, expires: 30 });
    expect(await f.run()).toBe("aabb");
    expect(f.accepted).toEqual(["route_messages", "construct_proof"]);
    expect(f.queries).not.toContain("poll_by_message");
  });
}

test("success observed after ending an expired poll routes in the same pass", async () => {
  const f = await harness();
  f.setPoll("in_progress", 1, { finished: false });
  f.afterEndStatus = "succeeded_on_source_chain";
  expect(await f.run()).toBe("aabb");
  expect(f.accepted).toEqual(["end_poll", "route_messages", "construct_proof"]);
});

for (const status of ["failed_to_verify", "not_found_on_source_chain"]) {
  test(`${status} starts a replacement poll once, then routes after success`, async () => {
    const f = await harness();
    f.setPoll(status, 1);
    await expect(f.run()).rejects.toBeInstanceOf(Pending);
    expect(f.accepted).toEqual(["verify_messages"]);
    expect(await transactions(f)).toEqual(["hub:verify:after:1"]);
    // Restart while poll 2 is active: neither a second fee nor a new signature.
    await expect(f.run()).rejects.toBeInstanceOf(Pending);
    expect(f.prepared.length).toBe(1);
    expect(f.broadcasts.length).toBe(1);
    f.setPoll("succeeded_on_source_chain", 2);
    expect(await f.run()).toBe("aabb");
    expect(f.accepted).toEqual([
      "verify_messages",
      "route_messages",
      "construct_proof",
    ]);
  });
}

test("successive no-consensus polls get separate attempts, at most one new poll per pass", async () => {
  const f = await harness();
  await expect(f.run()).rejects.toBeInstanceOf(Pending); // Initial verification creates poll 1.
  for (const id of [1, 2]) {
    f.setPoll("failed_to_verify", id, { finished: false });
    await expect(f.run()).rejects.toBeInstanceOf(Pending); // End the expired poll and replace it.
    expect(f.accepted.filter((op) => op === "verify_messages").length).toBe(
      id + 1,
    );
    const signed = f.prepared.length;
    await expect(f.run()).rejects.toBeInstanceOf(Pending); // Active poll: wait.
    expect(f.prepared.length).toBe(signed);
  }
  expect(await transactions(f)).toEqual([
    "hub:verify:initial",
    "hub:end-poll:1",
    "hub:verify:after:1",
    "hub:end-poll:2",
    "hub:verify:after:2",
  ]);
  f.setPoll("succeeded_on_source_chain", 3);
  expect(await f.run()).toBe("aabb");
});

test("a NotFound consensus can be retried before poll expiry, as the provider permits", async () => {
  const f = await harness();
  f.setPoll("not_found_on_source_chain", 1, { finished: false, expires: 30 });
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  expect(f.accepted).toEqual(["verify_messages"]);
});

test("a failed source transaction is terminal and spends no further fees", async () => {
  const f = await harness();
  f.setPoll("failed_on_source_chain", 1);
  await expect(f.run()).rejects.toThrow(/source transaction failed/);
  expect(f.prepared).toEqual([]);
});

test("unknown provider status values and mismatched messages cannot initiate spending", async () => {
  const f = await harness();
  const query = f.client.queryContractSmart;
  for (const change of [
    (r: { status: string }[]) => {
      r[0]!.status = "succeeded_on_chain"; // The original Vote/VerificationStatus mix-up.
    },
    (r: { message: AxelarMessage }[]) => {
      r[0]!.message.payload_hash = "00".repeat(32);
    },
  ]) {
    f.client.queryContractSmart = async (address, msg) => {
      const result = await query(address, msg);
      if (msg.messages_status) change(result);
      return result;
    };
    await expect(f.run()).rejects.toThrow(
      /Unexpected Axelar verification status response/,
    );
  }
  expect(f.prepared).toEqual([]);
});

test("a repeated failed-poll response reuses the confirmed request without another payment", async () => {
  const f = await harness();
  f.setPoll("failed_to_verify", 7);
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  f.setPoll("failed_to_verify", 7); // Delayed RPC view of the preceding poll.
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  expect(f.prepared.length).toBe(1);
  expect(f.broadcasts.length).toBe(1);
});

test("a lost included response is reconciled before retrying a newer failed poll", async () => {
  const f = await harness();
  f.setPoll("failed_to_verify", 7);
  f.lostResponse = "after inclusion";
  await expect(f.run()).rejects.toThrow(/Lost broadcast response/);
  expect((await f.journal()).state.pendingVerification).toBe("verify:after:7");
  f.setPoll("failed_to_verify", 8); // Poll 8 finishes before the caller restarts.
  const [included] = f.receipts.keys();
  f.log.length = 0;
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  // The included verify:after:7 is looked up before verify:after:8 is signed.
  expect(f.log.indexOf(`getTx:${included}`)).toBeGreaterThanOrEqual(0);
  expect(f.log.indexOf(`getTx:${included}`)).toBeLessThan(
    f.log.indexOf("sign"),
  );
  expect(f.prepared.length).toBe(2);
  expect(f.broadcasts.length).toBe(2);
  expect(await transactions(f)).toEqual([
    "hub:verify:after:7",
    "hub:verify:after:8",
  ]);
  expect((await f.journal()).state.pendingVerification).toBeUndefined();
});

test("an ambiguous unconfirmed request keeps its signed bytes even if another relayer changes the poll", async () => {
  const f = await harness();
  f.setPoll("failed_to_verify", 7);
  f.lostResponse = "before inclusion";
  await expect(f.run()).rejects.toThrow(/Lost broadcast response/);
  f.setPoll("failed_to_verify", 8); // A different actor created and ended poll 8.
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  expect(f.prepared.length).toBe(1);
  expect(f.broadcasts.length).toBe(2);
  expect(f.broadcasts[0]).toBe(f.broadcasts[1]!);
  expect(await transactions(f)).toEqual(["hub:verify:after:7"]);
  expect(f.accepted).toEqual(["verify_messages"]);
});

test("failed simulation creates no signed attempt to replay after another actor starts a poll", async () => {
  const f = await harness();
  f.client.simulate = async () => {
    throw new Error("Fee balance unavailable");
  };
  await expect(f.run()).rejects.toThrow(/Fee balance unavailable/);
  f.setPoll("in_progress", 1, { finished: false, expires: 30 });
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  expect(f.prepared).toEqual([]);
  expect((await f.journal()).state.pendingVerification).toBeUndefined();
});

test("an unsigned session waits until expires_at, then one replacement session signs", async () => {
  const f = await harness();
  f.setPoll("succeeded_on_source_chain", 1, { expires: 30 });
  f.signed = false;
  await expect(f.run()).rejects.toThrow(/Waiting for Axelar signing session 9/);
  f.height = 70; // expires_at: signatures are still accepted at this height.
  await expect(f.run()).rejects.toThrow(/Waiting for Axelar signing session 9/);
  f.height = 71;
  await expect(f.run()).rejects.toThrow(
    /session 9 expired; waiting for session 10/,
  );
  await expect(f.run()).rejects.toThrow(
    /Waiting for Axelar signing session 10/,
  );
  f.signed = true;
  expect(await f.run()).toBe("aabb");
  expect(f.accepted).toEqual([
    "route_messages",
    "construct_proof",
    "construct_proof",
  ]);
  expect(await transactions(f)).toEqual([
    "hub:route",
    "hub:construct",
    "hub:construct:after:9",
  ]);
});

test("a lost replacement-session response resumes the same signed request", async () => {
  const f = await harness();
  f.setPoll("succeeded_on_source_chain", 1, { expires: 30 });
  f.signed = false;
  await expect(f.run()).rejects.toBeInstanceOf(Pending);
  f.height = 71;
  f.lostResponse = "after inclusion";
  await expect(f.run()).rejects.toThrow(/Lost broadcast response/);
  await expect(f.run()).rejects.toThrow(
    /Waiting for Axelar signing session 10/,
  );
  expect(f.prepared.length).toBe(3);
  expect(f.broadcasts.length).toBe(3);
  expect(f.accepted).toEqual([
    "route_messages",
    "construct_proof",
    "construct_proof",
  ]);
});

test("a completed proof from a rotated-out verifier set is discarded and re-signed by the current set", async () => {
  const f = await harness();
  f.setPoll("succeeded_on_source_chain", 1, { expires: 30 });
  expect(await f.run()).toBe("aabb");
  const discard = async () =>
    discardRotatedProof({
      client: f.client,
      job: f.job,
      journal: await f.journal(),
    });
  // The set has not rotated: the approval failure is not the proof's fault; keep it.
  expect(await discard()).toBe(false);
  expect((await f.journal()).state.executeData).toBe("aabb");
  f.verifierSet = "set-2";
  expect(await discard()).toBe(true);
  const state = (await f.journal()).state;
  expect(state.executeData).toBeUndefined();
  expect(state.sessionId).toBeUndefined();
  expect(await f.run()).toBe("aabb");
  expect(f.accepted).toEqual([
    "route_messages",
    "construct_proof",
    "construct_proof",
  ]);
  const renewed = await f.journal();
  expect(renewed.state.sessionId).toBe("10");
  expect(renewed.state.sessionVerifierSet).toBe("set-2");
  expect(Object.keys(renewed.state.transactions)).toEqual([
    "hub:route",
    "hub:construct",
    "hub:construct:after:9",
  ]);
});
