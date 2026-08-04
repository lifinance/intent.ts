// --- Tron address helpers (Base58Check) --- //

import { createBase58check } from "@scure/base";
import { bytesToHex, hexToBytes, sha256 } from "viem";

/** Version byte prefixing every Tron mainnet address payload. */
export const TRON_ADDRESS_PREFIX = 0x41;

// The complete Base58Check envelope (base58 codec + double-sha256 checksum
// verification) is @scure/base's audited implementation — nothing below
// hand-rolls any encoding or hashing. Only Tron-specific semantics remain:
// the 21-byte payload length and the 0x41 version byte.
const base58check = createBase58check((data: Uint8Array) =>
  sha256(data, "bytes"),
);

/**
 * Decode a Tron Base58Check address to its 20-byte hex form.
 *
 * `@scure/base` verifies the 4-byte double-sha256 checksum (throws
 * "Invalid checksum" on any corruption — a mistyped address must never
 * silently decode to a different 20-byte address); this function then
 * asserts the Tron envelope: 21-byte payload with the `0x41` prefix.
 */
export function tronBase58ToHex(base58Address: string): `0x${string}` {
  const payload = base58check.decode(base58Address);
  if (payload.length !== 21) {
    throw new Error(
      `Invalid Tron address: expected 21-byte payload, got ${payload.length} bytes`,
    );
  }
  if (payload[0] !== TRON_ADDRESS_PREFIX) {
    throw new Error(
      `Invalid Tron address prefix: expected 0x41, got 0x${payload[0]!.toString(16).padStart(2, "0")}`,
    );
  }
  return bytesToHex(payload.slice(1));
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
  const payload = new Uint8Array(21);
  payload[0] = TRON_ADDRESS_PREFIX;
  payload.set(hexToBytes(`0x${hex}`), 1);
  return base58check.encode(payload);
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
