// Off-chain builders for the Solana `oracle_axelar` program and the pinned
// Axelar 1.1.1 gateway / gas-service ABI. Pure: no keys, RPC or broadcast.
// Byte-for-byte parity with the reference builder in lifi-intent-svm
// (`axelar_litesvm/src/client_vectors.rs`) is enforced by
// tests/vectors/axelarClientVectors.json.
import { bytesToHex, keccak256, sha256 } from "viem";
import { findSolanaProgramAddress } from "../helpers/solana";
import {
  BorshReader,
  BorshWriter,
  type Bytes,
  type Hex,
  bytes32,
  concat,
  equal,
  pubkey,
  toBytes,
  u128Le,
  utf8,
} from "./bytes";
import {
  AXELAR_MAX_CHAIN_NAME,
  type AxelarAddressKind,
  type AxelarMessage,
  type AxelarRouteKind,
  axelarMessageHash,
  axelarCommandId,
  checkMessageBounds,
  decodeAxelarAddress,
  messagePayloadHash,
  writeMessage,
} from "./message";
import { base58 } from "@scure/base";

export type { Hex, Bytes } from "./bytes";
export {
  AXELAR_MAX_CHAIN_NAME,
  type AxelarAddressKind,
  type AxelarMessage,
  type AxelarRouteKind,
  axelarCommandId,
  axelarMessageHash,
  decodeAxelarAddress,
} from "./message";
export { findSolanaProgramAddress } from "../helpers/solana";

export const AXELAR_ORACLE_PROGRAM =
  "FHMjUtWovj3KvMea62D2api8HaJy8oGye4UFzsGKZHvw";
export const INTENTS_PROTOCOL_PROGRAM =
  "LiFixdGLT5CMdLsHBvaijTXpPy4Uux9Y53SXkuR4HaK";
/** Largest single OIF proof an Axelar message to or from Solana carries. */
export const AXELAR_MAX_PROOF_BYTES = 320;

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const FILL_MAGIC = Uint8Array.of(0xd1, 0x25, 0x2d, 0xff);
const NOT_FILLED_MAGIC = Uint8Array.of(0x83, 0x0c, 0x1e, 0x1c);

export type AxelarDeliveryMode = "Relayed" | "SelfRelay";
export type AxelarAccountMeta = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};
export type AxelarInstruction = {
  programId: string;
  keys: AxelarAccountMeta[];
  data: Hex;
};
/** One resumable transaction; `account` is the state that proves it landed. */
export type AxelarStep = {
  name: string;
  kind: "session" | "signature" | "approved" | "executed" | "proof";
  account: string;
  position?: number;
  instruction: AxelarInstruction;
};

/** Anchor discriminator: first 8 bytes of `sha256("<namespace>:<name>")`. */
export function anchorDiscriminator(
  namespace: string,
  name: string,
): Uint8Array {
  return sha256(utf8.encode(`${namespace}:${name}`), "bytes").subarray(0, 8);
}

const pda = (program: string, ...seeds: (string | Uint8Array)[]) =>
  findSolanaProgramAddress(
    seeds.map((s) => (typeof s === "string" ? utf8.encode(s) : s)),
    program,
  )[0];
const ro = (key: string): AxelarAccountMeta => ({
  pubkey: key,
  isSigner: false,
  isWritable: false,
});
const rw = (key: string): AxelarAccountMeta => ({
  pubkey: key,
  isSigner: false,
  isWritable: true,
});
const payer = (key: string): AxelarAccountMeta => ({
  pubkey: key,
  isSigner: true,
  isWritable: true,
});
function instruction(
  programId: string,
  name: string,
  keys: AxelarAccountMeta[],
  args: BorshWriter,
): AxelarInstruction {
  return {
    programId,
    keys,
    data: bytesToHex(
      concat(anchorDiscriminator("global", name), args.finish()),
    ),
  };
}

/** Configuration PDA: the Solana oracle identity remote chains address and the input-oracle id. */
export const axelarConfigAddress = () => pda(AXELAR_ORACLE_PROGRAM, "axelar");

/** Route PDA for an Axelar chain name; names map after ASCII lowercasing. */
export function axelarRouteAddress(name: string): string {
  return pda(
    AXELAR_ORACLE_PROGRAM,
    "route",
    name.replace(/[A-Z]/g, (c) => c.toLowerCase()),
  );
}

const KINDS: readonly AxelarAddressKind[] = ["evm", "stellar", "solana"];

function account(data: Bytes, name: string): BorshReader {
  const bytes = toBytes(data);
  if (
    bytes.length < 8 ||
    !equal(bytes.subarray(0, 8), anchorDiscriminator("account", name))
  )
    throw new Error(`Not an ${name} account`);
  const reader = new BorshReader(bytes);
  reader.take(8);
  return reader;
}

/** Decodes `AxelarConfig` account data (trailing allocation padding is ignored, as Anchor does). */
export function decodeAxelarConfig(data: Bytes) {
  const r = account(data, "AxelarConfig");
  r.u8();
  return {
    owner: base58.encode(r.take(32)),
    chainId: r.u128(),
    chainName: r.string(),
    gateway: base58.encode(r.take(32)),
    gasService: base58.encode(r.take(32)),
  };
}

export function decodeAxelarRoute(data: Bytes) {
  const r = account(data, "AxelarRoute");
  r.u8();
  const name = r.string();
  const chainId = r.u128();
  const kind = KINDS[r.u8()];
  if (!kind) throw new Error("Unknown Axelar address kind");
  return { name, chainId, kind };
}

/** `initialize`: one-time configuration by the program upgrade authority, who becomes the mapping owner. */
export function axelarInitializeInstruction(a: {
  payer: string;
  gateway: string;
  gasService: string;
  chainName: string;
}): AxelarInstruction {
  const program = AXELAR_ORACLE_PROGRAM;
  return instruction(
    program,
    "initialize",
    [
      payer(a.payer),
      ro(program),
      ro(pda(UPGRADEABLE_LOADER, pubkey(program))),
      rw(axelarConfigAddress()),
      ro(pda(INTENTS_PROTOCOL_PROGRAM, "chain_id")),
      ro(a.gateway),
      ro(a.gasService),
      ro(INTENTS_PROTOCOL_PROGRAM),
      ro(SYSTEM_PROGRAM),
    ],
    new BorshWriter().string(a.chainName),
  );
}

/** Owner-only, set-once `set_chain_mapping`; existing names and chain IDs cannot be remapped. */
export function axelarSetChainMappingInstruction(a: {
  owner: string;
  name: string;
  chainId: bigint;
  kind: AxelarRouteKind;
}): AxelarInstruction {
  // Borsh `AddressKind` index; untyped callers may still pass "solana" (-1 here).
  const kind = KINDS.slice(0, 2).indexOf(a.kind);
  if (kind < 0) throw new Error("Remote route must be evm or stellar");
  if (!/^[a-z0-9-]+$/.test(a.name) || a.name.length > AXELAR_MAX_CHAIN_NAME)
    throw new Error("Axelar chain name must be 1-20 bytes of a-z, 0-9 or '-'");
  if (a.chainId <= 0n) throw new Error("Chain ID must be a nonzero u128");
  const program = AXELAR_ORACLE_PROGRAM;
  return instruction(
    program,
    "set_chain_mapping",
    [
      payer(a.owner),
      ro(axelarConfigAddress()),
      rw(axelarRouteAddress(a.name)),
      rw(pda(program, "route-chain", u128Le(a.chainId))),
      ro(SYSTEM_PROGRAM),
    ],
    new BorshWriter().string(a.name).u128(a.chainId).u8(kind),
  );
}

/** Gas-service `add_gas` top-up for an already submitted Solana-source message. */
export function axelarFundInstruction(a: {
  payer: string;
  gasService: string;
  messageId: string;
  amount: bigint;
}): AxelarInstruction {
  if (a.amount <= 0n) throw new Error("Funding amount must be positive");
  return instruction(
    a.gasService,
    "add_gas",
    [
      payer(a.payer),
      rw(pda(a.gasService, "gas-service")),
      ro(SYSTEM_PROGRAM),
      ro(pda(a.gasService, "__event_authority")),
      ro(a.gasService),
    ],
    new BorshWriter().string(a.messageId).u64(a.amount).raw(pubkey(a.payer)),
  );
}

/** `oracle_base::decode_payload_commitment`: the local-attestation key of a fill or not-filled proof. */
function payloadCommitment(payload: Uint8Array): Uint8Array {
  const magic = payload.subarray(0, 4);
  if (equal(magic, FILL_MAGIC) && payload.length >= 172)
    return keccak256(
      concat(payload.subarray(0, 68), payload.subarray(72)),
      "bytes",
    );
  if (equal(magic, NOT_FILLED_MAGIC) && payload.length >= 140)
    return keccak256(payload, "bytes");
  throw new Error("Payload is not a fill or not-filled description");
}

/**
 * `submit` (non-consuming, default) or `submit_consume` (closes the source local
 * attestation; `payer` must be its recorded rent recipient). `Relayed` requires a
 * positive gas payment; `SelfRelay` requires exactly zero.
 */
export function axelarSubmitInstruction(a: {
  payer: string;
  gateway: string;
  gasService: string;
  source: string;
  destinationChain: string;
  recipientOracle: Hex;
  payload: Bytes;
  gasAmount: bigint;
  deliveryMode: AxelarDeliveryMode;
  consume?: boolean;
}): AxelarInstruction {
  const program = AXELAR_ORACLE_PROGRAM;
  const payload = toBytes(a.payload);
  if (payload.length > AXELAR_MAX_PROOF_BYTES)
    throw new Error("Proof exceeds 320 bytes");
  if (a.deliveryMode !== "Relayed" && a.deliveryMode !== "SelfRelay")
    throw new Error("Unknown delivery mode");
  if ((a.gasAmount === 0n) !== (a.deliveryMode === "SelfRelay"))
    throw new Error("Relayed needs positive gas; SelfRelay needs zero");
  const local = pda(
    INTENTS_PROTOCOL_PROGRAM,
    "local_attestation",
    pubkey(a.source),
    pubkey(program),
    payloadCommitment(payload),
  );
  const keys = [
    payer(a.payer),
    ro(axelarConfigAddress()),
    ro(axelarRouteAddress(a.destinationChain)),
    ro(program),
    ro(pda(program, "gtw-call-contract")),
    ro(a.gateway),
    ro(pda(a.gateway, "gateway")),
    ro(pda(a.gateway, "__event_authority")),
    ro(a.gasService),
    rw(pda(a.gasService, "gas-service")),
    ro(pda(a.gasService, "__event_authority")),
    ro(SYSTEM_PROGRAM),
    ...(a.consume
      ? [
          ro(pda(program, "local_consumer")),
          ro(INTENTS_PROTOCOL_PROGRAM),
          rw(local),
          rw(a.payer),
        ]
      : [ro(local)]),
  ];
  return instruction(
    program,
    a.consume ? "submit_consume" : "submit",
    keys,
    new BorshWriter()
      .string(a.destinationChain)
      .raw(bytes32(a.recipientOracle, "recipientOracle"))
      .raw(pubkey(a.source))
      .bytes(payload)
      .u64(a.gasAmount)
      .u8(a.deliveryMode === "Relayed" ? 0 : 1),
  );
}

function readMessage(r: BorshReader): AxelarMessage {
  return {
    cc_id: { source_chain: r.string(), message_id: r.string() },
    source_address: r.string(),
    destination_chain: r.string(),
    destination_address: r.string(),
    payload_hash: bytesToHex(r.take(32)),
  };
}

/**
 * Gateway approval transactions for a prover `execute_data` (Borsh `ExecuteData`).
 * Refuses rotations, batches and approvals for any other message so a substituted
 * prover response cannot make the caller relay unrelated gateway state.
 */
export function axelarApprovalSteps(a: {
  payer: string;
  gateway: string;
  message: AxelarMessage;
  executeData: Bytes;
}): { messageHash: Hex; payloadHash: Hex; steps: AxelarStep[] } {
  checkMessageBounds(a.message);
  const messageHash = axelarMessageHash(a.message);
  const r = new BorshReader(toBytes(a.executeData));
  const signingRoot = r.take(32);
  const signatures: Uint8Array[] = [];
  const positions: number[] = [];
  for (let i = r.u32(); i > 0; i--) {
    const start = r.offset;
    const signature = Uint8Array.from(r.take(65));
    r.take(8 + 16 + 33 + 16);
    positions.push(r.u16());
    r.take(2 + 32);
    r.bytes();
    if (r.u8() !== 0) throw new Error("Signature is not for message approval");
    // Gateway expects recovery IDs 0/1; provers may emit Ethereum-style 27/28.
    if (signature[64]! >= 27) signature[64] = signature[64]! - 27;
    signatures.push(concat(signature, r.data.subarray(start + 65, r.offset)));
  }
  const root = r.take(32);
  if (r.u8() !== 1) throw new Error("Message approval required");
  if (r.u32() !== 1) throw new Error("Expected exactly one approved message");
  const start = r.offset;
  const approved = readMessage(r);
  r.take(2 + 2 + 32);
  r.bytes();
  const merklized = r.data.subarray(start, r.offset);
  r.finish();
  if (axelarMessageHash(approved) !== messageHash)
    throw new Error("Signed approval is for a different message");
  if (signatures.length === 0) throw new Error("No verifier signatures");
  const g = a.gateway;
  const gatewayRoot = pda(g, "gateway");
  const tracker = pda(g, "ver-set-tracker", signingRoot);
  const session = pda(g, "gtw-sig-verif", root, Uint8Array.of(0), signingRoot);
  const incoming = pda(
    g,
    "incoming message",
    toBytes(axelarCommandId(a.message)),
  );
  const steps: AxelarStep[] = [
    {
      name: "initialize-session",
      kind: "session",
      account: session,
      instruction: instruction(
        g,
        "initialize_payload_verification_session",
        [
          payer(a.payer),
          ro(gatewayRoot),
          rw(session),
          ro(tracker),
          ro(SYSTEM_PROGRAM),
        ],
        new BorshWriter().raw(root).u8(0),
      ),
    },
    ...signatures.map((info, i): AxelarStep => {
      const position = positions[i]!;
      if (position >= 256)
        throw new Error("Verifier position exceeds session bitmap");
      return {
        name: `signature-${position}`,
        kind: "signature",
        account: session,
        position,
        instruction: instruction(
          g,
          "verify_signature",
          [ro(gatewayRoot), rw(session), ro(tracker)],
          new BorshWriter().raw(root).raw(info),
        ),
      };
    }),
    {
      name: "approve-message",
      kind: "approved",
      account: incoming,
      instruction: instruction(
        g,
        "approve_message",
        [
          ro(gatewayRoot),
          payer(a.payer),
          ro(session),
          rw(incoming),
          ro(SYSTEM_PROGRAM),
          ro(pda(g, "__event_authority")),
          ro(g),
        ],
        new BorshWriter().raw(merklized).raw(root),
      ),
    },
  ];
  return {
    messageHash,
    payloadHash: bytesToHex(messagePayloadHash(a.message)),
    steps,
  };
}

/** `common::encoding::decode_message`: application and per-payload hashes; rejects trailing bytes. */
function decodeOifMessage(payload: Uint8Array): {
  application: Uint8Array;
  hashes: Uint8Array[];
} {
  if (payload.length < 34) throw new Error("Malformed OIF message");
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const hashes: Uint8Array[] = [];
  let offset = 34;
  for (let i = view.getUint16(32); i > 0; i--) {
    if (offset + 2 > payload.length) throw new Error("Malformed OIF message");
    const size = view.getUint16(offset);
    offset += 2;
    if (offset + size > payload.length)
      throw new Error("Malformed OIF message");
    hashes.push(keccak256(payload.subarray(offset, offset + size), "bytes"));
    offset += size;
  }
  if (offset !== payload.length) throw new Error("Malformed OIF message");
  return { application: payload.subarray(0, 32), hashes };
}

export type AxelarReceivePlan = {
  messageHash: Hex;
  payloadHash: Hex;
  /** Gateway `IncomingMessage` PDA (approved, then executed). */
  incoming: string;
  /** Protocol attestation PDA created by `register_proof`. */
  proof: string;
  config: string;
  protocol: string;
  /** `[execute (kind "executed"), register (kind "proof")]`. */
  steps: AxelarStep[];
};

/**
 * Destination transactions for an approved Solana-bound message: permissionless
 * `execute`, then caller-funded `register_proof` (the standard executor cannot pay
 * its rent, so settlement after paid relaying still needs this step).
 */
export function axelarReceiveSteps(a: {
  payer: string;
  gateway: string;
  message: AxelarMessage;
  payload: Bytes;
  sourceChainId: bigint;
  sourceKind: AxelarRouteKind;
}): AxelarReceivePlan {
  const m = a.message;
  checkMessageBounds(m);
  const program = AXELAR_ORACLE_PROGRAM;
  if (m.destination_address !== program)
    throw new Error("Message is not for the Axelar oracle");
  const envelope = toBytes(a.payload);
  const payloadHash = messagePayloadHash(m);
  if (!equal(keccak256(envelope, "bytes"), payloadHash))
    throw new Error("Payload hash mismatch");
  const config = axelarConfigAddress();
  const length =
    envelope.length >= 42
      ? new DataView(envelope.buffer, envelope.byteOffset).getUint32(1, true)
      : -1;
  if (
    envelope.length !== length + 42 ||
    length < 36 ||
    length > 36 + AXELAR_MAX_PROOF_BYTES
  )
    throw new Error("Malformed Solana executable envelope");
  const payload = envelope.subarray(5, 5 + length);
  const expected = new BorshWriter()
    .u8(0)
    .bytes(payload)
    .u32(1)
    .raw(pubkey(config))
    .u8(0)
    .finish();
  if (!equal(envelope, expected))
    throw new Error("Malformed Solana executable envelope");
  const { application, hashes } = decodeOifMessage(payload);
  if (hashes.length !== 1)
    throw new Error("Expected exactly one proof per Axelar message");
  if (a.sourceChainId <= 0n)
    throw new Error("Source chain ID must be a nonzero u128");
  if (a.sourceKind !== "evm" && a.sourceKind !== "stellar")
    throw new Error("Remote route must be evm or stellar");
  const sender = decodeAxelarAddress(m.source_address, a.sourceKind);
  const command = toBytes(axelarCommandId(m));
  const g = a.gateway;
  const incoming = pda(g, "incoming message", command);
  const proof = pda(
    INTENTS_PROTOCOL_PROGRAM,
    "attestation",
    pubkey(config),
    u128Le(a.sourceChainId),
    sender,
    application,
    hashes[0]!,
  );
  const steps: AxelarStep[] = [
    {
      name: "execute",
      kind: "executed",
      account: incoming,
      instruction: instruction(
        program,
        "execute",
        [
          rw(incoming),
          ro(pda(program, "gtw-validate-msg", command)),
          ro(pda(g, "gateway")),
          ro(pda(g, "__event_authority")),
          ro(g),
          ro(config),
        ],
        writeMessage(new BorshWriter(), m).bytes(payload).u8(0),
      ),
    },
    {
      name: "register",
      kind: "proof",
      account: proof,
      instruction: instruction(
        program,
        "register_proof",
        [
          payer(a.payer),
          ro(config),
          ro(axelarRouteAddress(m.cc_id.source_chain)),
          ro(incoming),
          rw(proof),
          ro(INTENTS_PROTOCOL_PROGRAM),
          ro(SYSTEM_PROGRAM),
        ],
        writeMessage(new BorshWriter(), m).bytes(payload),
      ),
    },
  ];
  return {
    messageHash: axelarMessageHash(m),
    payloadHash: bytesToHex(payloadHash),
    incoming,
    proof,
    config,
    protocol: INTENTS_PROTOCOL_PROGRAM,
    steps,
  };
}

/**
 * Pre-funding admission for orders whose proofs travel over Axelar to or from
 * Solana: one proof of at most 320 bytes per message and nonzero u128 chain IDs.
 */
export function checkSolanaAxelarAdmission(a: {
  callbackBytes?: number;
  contextBytes?: number;
  sourceChainId?: bigint;
  destinationChainId?: bigint;
}): { fillBytes: number; notFilledBytes: number } {
  const { callbackBytes = 0, contextBytes = 0 } = a;
  for (const id of [a.sourceChainId, a.destinationChainId])
    if (id !== undefined && (id <= 0n || id >= 1n << 128n))
      throw new Error("Solana route requires chain IDs fitting nonzero u128");
  if (
    ![callbackBytes, contextBytes].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    172 + callbackBytes + contextBytes > AXELAR_MAX_PROOF_BYTES
  )
    throw new Error("Solana route fill proof exceeds 320 bytes");
  return {
    fillBytes: 172 + callbackBytes + contextBytes,
    notFilledBytes: 140 + callbackBytes + contextBytes,
  };
}
