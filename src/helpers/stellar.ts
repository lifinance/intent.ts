// --- Stellar address helpers (strkey) --- //

import { base32nopad } from "@scure/base";
import { bytesToHex, concat, hexToBytes, keccak256, toBytes } from "viem";

/** Strkey version byte of an ed25519 account (`G…`). */
const VERSION_ACCOUNT = 6 << 3;
/** Strkey version byte of a contract (`C…`). */
const VERSION_CONTRACT = 2 << 3;

const ADDRESS_COMMITMENT_DOMAIN = toBytes("OIF.Stellar.Address.v1");

/** CRC16-XModem (init 0, poly 0x1021), as used by the strkey checksum. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function decodeStrkey(strkey: string): { version: number; key: Uint8Array } {
  const invalid = () => new Error(`Invalid Stellar address: ${strkey}`);
  if (strkey.length !== 56) throw invalid();
  let raw: Uint8Array;
  try {
    raw = base32nopad.decode(strkey);
  } catch {
    throw invalid();
  }
  if (raw.length !== 35) throw invalid();
  const version = raw[0]!;
  if (version !== VERSION_ACCOUNT && version !== VERSION_CONTRACT)
    throw invalid();
  const checksum = crc16(raw.subarray(0, 33));
  if (raw[33] !== (checksum & 0xff) || raw[34] !== checksum >> 8)
    throw invalid();
  return { version, key: raw.slice(1, 33) };
}

function encodeStrkey(version: number, bytes32: `0x${string}`): string {
  const key = hexToBytes(bytes32);
  if (key.length !== 32)
    throw new Error(`Invalid Stellar key: expected 32 bytes, got ${bytes32}`);
  const raw = new Uint8Array(35);
  raw[0] = version;
  raw.set(key, 1);
  const checksum = crc16(raw.subarray(0, 33));
  raw[33] = checksum & 0xff;
  raw[34] = checksum >> 8;
  return base32nopad.encode(raw);
}

/**
 * Decode a Stellar account (`G…`) or contract (`C…`) strkey to its raw
 * 32-byte key. Verifies length, version byte and CRC16 checksum.
 */
export function stellarStrkeyToBytes32(strkey: string): `0x${string}` {
  return bytesToHex(decodeStrkey(strkey).key);
}

/** Encode a raw 32-byte ed25519 key as a Stellar account strkey (`G…`). */
export function bytes32ToStellarAccount(bytes32: `0x${string}`): string {
  return encodeStrkey(VERSION_ACCOUNT, bytes32);
}

/** Encode a raw 32-byte contract id as a Stellar contract strkey (`C…`). */
export function bytes32ToStellarContract(bytes32: `0x${string}`): string {
  return encodeStrkey(VERSION_CONTRACT, bytes32);
}

function isVersion(value: string, version: number): boolean {
  try {
    return decodeStrkey(value).version === version;
  } catch {
    return false;
  }
}

/** Whether `value` is a valid Stellar account strkey (`G…`). Never throws. */
export function isStellarAccount(value: string): boolean {
  return isVersion(value, VERSION_ACCOUNT);
}

/** Whether `value` is a valid Stellar contract strkey (`C…`). Never throws. */
export function isStellarContract(value: string): boolean {
  return isVersion(value, VERSION_CONTRACT);
}

/**
 * OIF address commitment of a Stellar address:
 * `keccak256("OIF.Stellar.Address.v1" ‖ XDR(ScVal::Address))`.
 * This is the 32-byte solver identity a Stellar escrow checks on `finalise`.
 */
export function stellarAddressCommitment(strkey: string): `0x${string}` {
  const { version, key } = decodeStrkey(strkey);
  const scAddress =
    version === VERSION_ACCOUNT
      ? concat(["0x00000012", "0x00000000", "0x00000000", bytesToHex(key)])
      : concat(["0x00000012", "0x00000001", bytesToHex(key)]);
  return keccak256(concat([ADDRESS_COMMITMENT_DOMAIN, hexToBytes(scAddress)]));
}
