// --- Tron address helpers (Base58Check) --- //

import { base58 } from "@scure/base";
import { sha256 } from "viem";

/** Version byte prefixing every Tron mainnet address payload. */
export const TRON_ADDRESS_PREFIX = 0x41;

// Kept only to name the offending character in errors — the codec itself is
// @scure/base's audited base58 implementation.
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Uint8Array {
  try {
    return base58.decode(value);
  } catch {
    const invalid = [...value].find((char) => !BASE58_ALPHABET.includes(char));
    throw new Error(`Invalid Base58 character: ${invalid ?? "?"}`);
  }
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

function checksumOf(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload, "bytes"), "bytes").slice(0, 4);
}

/**
 * Decode a Tron Base58Check address to its 20-byte hex form.
 *
 * Verifies the full Base58Check envelope: 25-byte payload, `0x41` network
 * prefix, and the 4-byte double-sha256 checksum. Throws on any mismatch —
 * a corrupted or mistyped address must never silently decode to a
 * different 20-byte address.
 */
export function tronBase58ToHex(base58Address: string): `0x${string}` {
  const decoded = decodeBase58(base58Address);
  if (decoded.length !== 25) {
    throw new Error(
      `Invalid Tron address: expected 25-byte payload, got ${decoded.length} bytes`,
    );
  }
  if (decoded[0] !== TRON_ADDRESS_PREFIX) {
    throw new Error(
      `Invalid Tron address prefix: expected 0x41, got 0x${decoded[0]!.toString(16).padStart(2, "0")}`,
    );
  }
  const body = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expected = checksumOf(body);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error("Invalid Tron address checksum");
    }
  }
  return bytesToHex(body.slice(1));
}

/**
 * Encode a 20-byte hex address to Tron Base58Check (`T…`) form, with the
 * `0x41` prefix and 4-byte double-sha256 checksum appended.
 */
export function hexToTronBase58(address: `0x${string}`): string {
  const hex = address.replace(/^0x/, "");
  if (hex.length !== 40 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid address: expected 20-byte hex, got ${address}`);
  }
  const body = new Uint8Array(21);
  body[0] = TRON_ADDRESS_PREFIX;
  for (let i = 0; i < 20; i++) {
    body[i + 1] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  const checksum = checksumOf(body);
  const payload = new Uint8Array(25);
  payload.set(body);
  payload.set(checksum, 21);
  return base58.encode(payload);
}

/**
 * Whether `value` is a fully valid Tron mainnet address: length, alphabet,
 * `T` prefix, `0x41` version byte, and Base58Check checksum. Never throws.
 */
export function isTronBase58Address(value: string): boolean {
  if (value.length !== 34 || !value.startsWith("T")) return false;
  try {
    tronBase58ToHex(value);
    return true;
  } catch {
    return false;
  }
}
