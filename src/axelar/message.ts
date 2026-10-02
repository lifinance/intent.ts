import { base58 } from "@scure/base";
import { keccak256 } from "viem";
import { BorshWriter, type Hex, bytes32, concat, pubkey, utf8 } from "./bytes";

/** Axelar GMP message as returned by Amplifier APIs (snake_case wire names). */
export type AxelarMessage = {
  cc_id: { source_chain: string; message_id: string };
  source_address: string;
  destination_chain: string;
  destination_address: string;
  /** 32-byte keccak of the payload, hex with optional `0x`. */
  payload_hash: string;
};

export type AxelarAddressKind = "evm" | "stellar" | "solana";
export type AxelarRouteKind = Exclude<AxelarAddressKind, "solana">;

/** Axelar `ChainNameRaw::MAX_LEN`. */
export const AXELAR_MAX_CHAIN_NAME = 20;

// udigest 0.2 unambiguous encoding, as derived for `solana_axelar_std::Message`:
// every leaf and list is postfixed by its u32-BE length, LEN_32 and its kind.
const LEN_32 = 5;
const LIST = 1;
const LEAF = 3;
function suffix(length: number, kind: number): Uint8Array {
  const out = new Uint8Array(6);
  new DataView(out.buffer).setUint32(0, length);
  out[4] = LEN_32;
  out[5] = kind;
  return out;
}
const leaf = (bytes: Uint8Array) => concat(bytes, suffix(bytes.length, LEAF));
function struct(fields: [string, Uint8Array][]): Uint8Array {
  return concat(
    ...fields.flatMap(([name, value]) => [leaf(utf8.encode(name)), value]),
    suffix(2 * fields.length, LIST),
  );
}

/** Byte-level payload hash; rejects non-32-byte values. */
export const messagePayloadHash = (m: AxelarMessage) =>
  bytes32(m.payload_hash, "payload_hash");

/** `solana_axelar_std::Message::hash` (keccak of the udigest encoding). */
export function axelarMessageHash(m: AxelarMessage): Hex {
  const hash = messagePayloadHash(m);
  const array = concat(
    ...[...hash].map((b) =>
      leaf(b === 0 ? new Uint8Array() : Uint8Array.of(b)),
    ),
    suffix(hash.length, LIST),
  );
  return keccak256(
    struct([
      [
        "cc_id",
        struct([
          ["chain", leaf(utf8.encode(m.cc_id.source_chain))],
          ["id", leaf(utf8.encode(m.cc_id.message_id))],
        ]),
      ],
      ["source_address", leaf(utf8.encode(m.source_address))],
      ["destination_chain", leaf(utf8.encode(m.destination_chain))],
      ["destination_address", leaf(utf8.encode(m.destination_address))],
      ["payload_hash", array],
    ]),
  );
}

/**
 * Solana gateway command ID: `keccak(source_chain || "-" || message_id)`.
 * EVM Amplifier gateways join with `_` instead; do not reuse this for them.
 */
export function axelarCommandId(m: AxelarMessage): Hex {
  return keccak256(
    utf8.encode(`${m.cc_id.source_chain}-${m.cc_id.message_id}`),
  );
}

/** Gateway string bounds enforced by `Message::check_bounds` (UTF-8 bytes). */
export function checkMessageBounds(m: AxelarMessage): void {
  for (const [value, max] of [
    [m.cc_id.source_chain, AXELAR_MAX_CHAIN_NAME],
    [m.cc_id.message_id, 128],
    [m.source_address, 56],
    [m.destination_chain, AXELAR_MAX_CHAIN_NAME],
    [m.destination_address, 44],
  ] as const) {
    const length = utf8.encode(value).length;
    if (length === 0 || length > max)
      throw new Error("Axelar message field outside gateway bounds");
  }
}

/** Borsh `Message` (gateway and oracle instruction argument layout). */
export function writeMessage(w: BorshWriter, m: AxelarMessage): BorshWriter {
  return w
    .string(m.cc_id.source_chain)
    .string(m.cc_id.message_id)
    .string(m.source_address)
    .string(m.destination_chain)
    .string(m.destination_address)
    .raw(messagePayloadHash(m));
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Strict Axelar transport address → 32-byte OIF identifier, matching
 * `oracle_axelar::address::decode`: lowercase-or-mixed `0x` + 40 hex for EVM
 * (left-padded), canonical Stellar contract strkey, canonical base58 for Solana.
 */
export function decodeAxelarAddress(
  value: string,
  kind: AxelarAddressKind,
): Uint8Array {
  const out = new Uint8Array(32);
  if (kind === "solana") {
    const key = pubkey(value);
    if (base58.encode(key) !== value)
      throw new Error("Non-canonical Solana address");
    out.set(key);
  } else if (kind === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value))
      throw new Error("Invalid EVM address");
    for (let i = 0; i < 20; i++)
      out[12 + i] = parseInt(value.slice(2 + 2 * i, 4 + 2 * i), 16);
  } else {
    if (value.length !== 56)
      throw new Error("Invalid Stellar contract address");
    const raw = new Uint8Array(35);
    let acc = 0;
    let bits = 0;
    let j = 0;
    for (const c of value) {
      const digit = BASE32.indexOf(c);
      if (digit < 0) throw new Error("Invalid Stellar contract address");
      acc = ((acc << 5) | digit) & 0xffff;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        raw[j++] = (acc >> bits) & 0xff;
      }
    }
    const checksum = crc16(raw.subarray(0, 33));
    if (
      raw[0] !== 16 ||
      raw[33] !== (checksum & 0xff) ||
      raw[34] !== checksum >> 8
    )
      throw new Error("Invalid Stellar contract address");
    out.set(raw.subarray(1, 33));
  }
  return out;
}
