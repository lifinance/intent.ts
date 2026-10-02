import { createHash } from "node:crypto";
import type { JsonObject } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { calculateFee, GasPrice, type StdFee } from "@cosmjs/stargate";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import type { AxelarMessage } from "../../../src/axelar/index";
import type { HubConfig, Job } from "./source";
import type { Journal, StoredTransaction } from "./state";

export class Pending extends Error {}

export type HubReceipt = {
  code?: number;
  rawLog?: string;
  events?: readonly {
    attributes: readonly { key: string; value: string }[];
  }[];
};
/** The subset of `CosmWasmClient` the relay reads. */
export type HubQueryClient = {
  queryContractSmart(address: string, query: JsonObject): Promise<JsonObject>;
};
/** The subset of `SigningCosmWasmClient` the relay drives. */
export type HubClient = HubQueryClient & {
  getChainId(): Promise<string>;
  getHeight(): Promise<number>;
  simulate(
    sender: string,
    messages: readonly EncodeObject[],
    memo: string | undefined,
  ): Promise<number>;
  sign(
    sender: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw>;
  getTx(id: string): Promise<HubReceipt | null>;
  broadcastTx(tx: Uint8Array): Promise<HubReceipt>;
};

// Amplifier's VerificationStatus, not the separate Vote enum.
// Pinned API: packages/axelar-wasm-std/src/verification.rs at 21bdc767.
const VERIFIED = "succeeded_on_source_chain";
// `true` marks statuses that permit a replacement poll.
const VERIFICATION_STATUSES: Record<string, boolean> = {
  [VERIFIED]: false,
  failed_to_verify: true,
  not_found_on_source_chain: true,
  failed_on_source_chain: false,
  in_progress: false,
  unknown: false,
};
async function verificationStatus(
  client: HubQueryClient,
  verifier: string,
  message: AxelarMessage,
): Promise<string> {
  const response = await client.queryContractSmart(verifier, {
    messages_status: [message],
  });
  if (
    !Array.isArray(response) ||
    response.length !== 1 ||
    !response[0]?.message ||
    !sameMessage(response[0].message, message) ||
    typeof response[0].status !== "string" ||
    !Object.hasOwn(VERIFICATION_STATUSES, response[0].status)
  )
    throw new Error("Unexpected Axelar verification status response");
  if (response[0].status === "failed_on_source_chain")
    throw new Error("Axelar verified that the source transaction failed");
  return response[0].status;
}
const attr = (receipt: HubReceipt, key: string) =>
  receipt.events?.flatMap((e) => e.attributes).find((a) => a.key === key)
    ?.value;

export async function hubTransaction(
  client: HubClient,
  sender: string,
  config: HubConfig,
  journal: Journal,
  name: string,
  contract: string,
  msg: JsonObject,
): Promise<HubReceipt> {
  const lookup = async (tx: StoredTransaction) => {
    const result = await client.getTx(tx.id);
    if (result?.code)
      throw new Error(
        `Axelar hub transaction ${tx.id} failed (${result.code})`,
      );
    return result;
  };
  return journal.transaction(
    `hub:${name}`,
    async () => {
      const messages = [
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: {
            sender,
            contract,
            msg: Buffer.from(JSON.stringify(msg)),
            funds: [],
          },
        },
      ];
      const gas = await client.simulate(sender, messages, "OIF Axelar relay");
      const fee = calculateFee(
        Math.ceil(gas * 1.4),
        GasPrice.fromString(config.gasPrice),
      );
      const signed = await client.sign(
        sender,
        messages,
        fee,
        "OIF Axelar relay",
      );
      const raw = TxRaw.encode(signed).finish();
      return {
        id: createHash("sha256").update(raw).digest("hex").toUpperCase(),
        raw: Buffer.from(raw).toString("base64"),
      };
    },
    lookup,
    async (tx) => {
      const result = await client.broadcastTx(Buffer.from(tx.raw, "base64"));
      if (result.code)
        throw new Error(
          `Axelar hub transaction ${tx.id} failed (${result.code}): ${result.rawLog}`,
        );
      return result;
    },
  );
}

// One bounded pass. Return Pending while independent Axelar verifiers/signers work.
// Running again reconciles on-chain state and the durable signed transaction journal.
export async function relayHub({
  client,
  sender,
  job,
  journal,
}: {
  client: HubClient;
  sender: string;
  job: Pick<Job, "hub" | "message" | "payload">;
  journal: Journal;
}): Promise<string> {
  const h = job.hub,
    message = job.message,
    ids = [message.cc_id];
  if ((await client.getChainId()) !== h.chainId)
    throw new Error("Axelar RPC chain mismatch");
  const execute = (name: string, address: string, msg: JsonObject) =>
    hubTransaction(client, sender, h, journal, name, address, msg);
  const verify = (name: string) =>
    execute(name, h.sourceGateway, { verify_messages: [message] });
  // Reconcile a saved request before a newer failed poll can cause a fresh
  // signature. A lost response may hide either inclusion or a pending broadcast.
  if (journal.state.pendingVerification) {
    const name = journal.state.pendingVerification;
    if (journal.state.transactions[`hub:${name}`]) await verify(name);
    delete journal.state.pendingVerification;
    await journal.save();
  }
  const requestVerification = async (previousPoll?: string): Promise<never> => {
    const name =
      previousPoll === undefined
        ? "verify:initial"
        : `verify:after:${previousPoll}`;
    journal.state.pendingVerification = name;
    await journal.save();
    await verify(name);
    delete journal.state.pendingVerification;
    await journal.save();
    // At most one new verification request per pass. The next pass reads the
    // provider's current poll; repeated/stale responses reuse this signed request.
    throw new Pending(
      "Verification requested; waiting for Axelar verifier votes",
    );
  };
  let routed: AxelarMessage[];
  try {
    routed = await client.queryContractSmart(h.destinationGateway, {
      outgoing_messages: ids,
    });
  } catch (e) {
    if (!/message.*not found|not found.*message/i.test((e as Error).message))
      throw e;
    routed = [];
  }
  if (routed[0]) {
    if (
      JSON.stringify(routed[0]) !== JSON.stringify(message) &&
      !sameMessage(routed[0], message)
    )
      throw new Error("Routed message mismatch");
  } else {
    let status = await verificationStatus(client, h.votingVerifier, message);
    if (status !== VERIFIED) {
      // Discover an existing poll, including one created by another relayer.
      const poll = await client.queryContractSmart(h.votingVerifier, {
        poll_by_message: { message },
      });
      if (!poll) {
        if (status === "unknown") await requestVerification();
        throw new Pending("Waiting for Axelar verification poll state");
      }
      const p = poll.messages;
      if (
        !p ||
        typeof p.poll_id !== "string" ||
        !/^\d+$/.test(p.poll_id) ||
        !Number.isSafeInteger(p.expires_at) ||
        p.expires_at < 0 ||
        typeof p.finished !== "boolean"
      )
        throw new Error("Unexpected verification poll response");
      if (!p.finished && (await client.getHeight()) >= p.expires_at) {
        await execute(`end-poll:${p.poll_id}`, h.votingVerifier, {
          end_poll: { poll_id: p.poll_id },
        });
      }
      // Consensus may have arrived since the first query, including before
      // expiry. The provider also permits retrying a NotFound consensus early.
      status = await verificationStatus(client, h.votingVerifier, message);
      if (VERIFICATION_STATUSES[status]) await requestVerification(p.poll_id);
      if (status !== VERIFIED)
        throw new Pending(`Waiting for Axelar verification poll ${p.poll_id}`);
    }
    await execute("route", h.sourceGateway, { route_messages: [message] });
  }
  // Each construct_proof starts a new signing session under the prover's current
  // verifier set. The request name is journaled before signing so a restart
  // reconciles the same transaction instead of reusing an older session's receipt.
  const constructProof = async () => {
    const name = journal.state.proofRequest ?? "construct";
    const value = h.fullMessagePayloads
      ? { message_ids: ids, full_message_payloads: [job.payload] }
      : ids;
    const receipt = await execute(name, h.destinationProver, {
      construct_proof: value,
    });
    // The prover's IntoEvent derive JSON-encodes fields, so the attribute is `"<id>"`.
    const number = (key: string) =>
      attr(receipt, key)
        ?.match(/^(?:"(\d+)"|(\d+))$/)
        ?.slice(1)
        .find(Boolean);
    const sessionId = number("multisig_session_id");
    if (!sessionId)
      throw new Error(
        "Missing Axelar multisig session ID in transaction receipt",
      );
    const expiresAt = Number(number("expires_at"));
    if (!Number.isSafeInteger(expiresAt))
      throw new Error(
        "Missing Axelar signing session expiry in transaction receipt",
      );
    // The multisig contract's SigningStarted event names the signing verifier set.
    const verifierSet = attr(receipt, "verifier_set_id");
    if (!verifierSet)
      throw new Error(
        "Missing Axelar signing verifier set in transaction receipt",
      );
    journal.state.sessionId = sessionId;
    journal.state.sessionExpiresAt = expiresAt;
    journal.state.sessionVerifierSet = verifierSet;
    await journal.save();
  };
  if (!journal.state.sessionId) await constructProof();
  const proof = await client.queryContractSmart(h.destinationProver, {
    proof: { multisig_session_id: journal.state.sessionId },
  });
  if (
    proof.message_ids?.length !== 1 ||
    !sameId(proof.message_ids[0], message.cc_id)
  )
    throw new Error("Signed proof references a different message");
  const data = proof.status?.completed?.execute_data;
  if (!data) {
    // The multisig contract rejects signatures once height > expires_at, so an
    // incomplete session is dead. That includes a session stuck on a rotated-out
    // verifier set; the replacement session signs with the current set.
    if ((await client.getHeight()) > journal.state.sessionExpiresAt!) {
      const expired = journal.state.sessionId;
      journal.state.proofRequest = `construct:after:${expired}`;
      delete journal.state.sessionId;
      delete journal.state.sessionExpiresAt;
      delete journal.state.sessionVerifierSet;
      await journal.save();
      await constructProof();
      throw new Pending(
        `Axelar signing session ${expired} expired; waiting for session ${journal.state.sessionId}`,
      );
    }
    throw new Pending(
      `Waiting for Axelar signing session ${journal.state.sessionId}`,
    );
  }
  if (typeof data !== "string" || !/^(?:[a-fA-F0-9]{2})+$/.test(data))
    throw new Error("Invalid signed execution data");
  journal.state.executeData = data;
  await journal.save();
  return data;
}

// A completed proof stays valid only while the destination gateway retains its
// signer set. After a failed approval, discard a proof whose set the prover has
// rotated away from; the next relay pass signs a new session with the current set.
export async function discardRotatedProof({
  client,
  job,
  journal,
}: {
  client: HubQueryClient;
  job: Pick<Job, "hub">;
  journal: Journal;
}): Promise<boolean> {
  const signed = journal.state.sessionVerifierSet;
  if (!signed) return false;
  // A unit QueryMsg variant serializes as its bare snake_case name.
  const current = await client.queryContractSmart(
    job.hub.destinationProver,
    "current_verifier_set",
  );
  if (!current?.id || current.id === signed) return false;
  journal.state.proofRequest = `construct:after:${journal.state.sessionId}`;
  delete journal.state.sessionId;
  delete journal.state.sessionExpiresAt;
  delete journal.state.sessionVerifierSet;
  delete journal.state.executeData;
  await journal.save();
  return true;
}

type CrossChainId = AxelarMessage["cc_id"];
const sameId = (a: CrossChainId, b: CrossChainId) =>
  a.source_chain === b.source_chain && a.message_id === b.message_id;
export const sameMessage = (a: AxelarMessage, b: AxelarMessage) =>
  sameId(a.cc_id, b.cc_id) &&
  (
    [
      "source_address",
      "destination_chain",
      "destination_address",
      "payload_hash",
    ] as const
  ).every((k) => a[k] === b[k]);
