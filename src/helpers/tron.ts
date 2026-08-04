// --- Tron address helpers (Base58Check) --- //

import { sha256 } from "viem";

/** Version byte prefixing every Tron mainnet address payload. */
export const TRON_ADDRESS_PREFIX = 0x41;

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_INDEX = new Map<string, number>(
  [...BASE58_ALPHABET].map((c, i) => [c, i]),
);

function base58DecodeBytes(value: string): Uint8Array {
  // Little-endian byte accumulator.
  const bytes: number[] = [];
  for (const char of value) {
    const idx = BASE58_INDEX.get(char);
    if (idx === undefined) throw new Error(`Invalid Base58 character: ${char}`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1' characters encode leading zero bytes.
  let leadingZeros = 0;
  for (const char of value) {
    if (char !== "1") break;
    leadingZeros++;
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[leadingZeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

function base58EncodeBytes(bytes: Uint8Array): string {
  // Little-endian base58 digit accumulator.
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]!];
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

function checksumOf(payload: Uint8Array): Uint8Array {
  const first = sha256(bytesToHex(payload), "bytes");
  return sha256(bytesToHex(first), "bytes").slice(0, 4);
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
  const decoded = base58DecodeBytes(base58Address);
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
  return base58EncodeBytes(payload);
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
