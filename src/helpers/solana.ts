// --- Solana address helpers (raw Base58) --- //

import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { bytesToHex, hexToBytes, sha256 } from "viem";

/** Length of an ed25519 public key / program-derived address, in bytes. */
export const SOLANA_ADDRESS_BYTES = 32;

// The base58 codec is @scure/base's audited implementation — nothing below
// hand-rolls any encoding. Only Solana-specific semantics remain: the 32-byte
// payload length.
//
// SECURITY: unlike Tron's Base58Check (see ./tron.ts), Solana base58 is *raw*.
// There is no checksum, so a mistyped address does not fail to decode — it
// decodes to a different, equally valid 32-byte key, and funds sent there are
// unrecoverable. The 32-byte length check below is the only defence, and it
// only catches typos that change the decoded length. Never treat
// `isSolanaBase58Address(x) === true` as "this is the address the user meant":
// always render the re-encoded round trip back to the user before signing.

/**
 * Decode a Solana base58 address (public key, program id, or PDA) to its
 * 32-byte hex form.
 *
 * Throws on an invalid base58 alphabet and on any payload that is not exactly
 * 32 bytes. Note there is no checksum to verify — see the security note above.
 */
export function solanaBase58ToBytes32(base58Address: string): `0x${string}` {
  let payload: Uint8Array;
  try {
    payload = base58.decode(base58Address);
  } catch {
    throw new Error(
      `Invalid Solana address: not valid base58: ${base58Address}`,
    );
  }
  if (payload.length !== SOLANA_ADDRESS_BYTES) {
    throw new Error(
      `Invalid Solana address: expected 32-byte key, got ${payload.length} bytes`,
    );
  }
  return bytesToHex(payload);
}

/**
 * Encode a 32-byte hex value to its Solana base58 form.
 *
 * Leading zero bytes are preserved by base58's canonical `1`-per-zero-byte
 * prefix, so this round-trips `solanaBase58ToBytes32` exactly.
 */
export function bytes32ToSolanaBase58(value: `0x${string}`): string {
  const hex = value.replace(/^0x/, "");
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid address: expected 32-byte hex, got ${value}`);
  }
  return base58.encode(hexToBytes(`0x${hex}`));
}

/**
 * Whether `value` is a well-formed Solana address: valid base58 alphabet
 * decoding to exactly 32 bytes. Never throws.
 *
 * This proves the *shape* of an address, never its intent — Solana base58
 * carries no checksum, so a typo that still decodes to 32 bytes passes here.
 */
export function isSolanaBase58Address(value: string): boolean {
  try {
    solanaBase58ToBytes32(value);
    return true;
  } catch {
    return false;
  }
}

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

/**
 * Solana `Pubkey::find_program_address`: the first bump from 255 downward
 * whose `sha256(seeds || bump || programId || "ProgramDerivedAddress")` is
 * off the ed25519 curve. Returns the base58 address and its bump.
 */
export function findSolanaProgramAddress(
  seeds: readonly Uint8Array[],
  programId: string,
): [string, number] {
  const program = hexToBytes(solanaBase58ToBytes32(programId));
  if (seeds.length > 15 || seeds.some((s) => s.length > 32))
    throw new Error("Solana PDA seeds exceed 15 seeds of 32 bytes");
  for (let bump = 255; bump >= 0; bump--) {
    const preimage = new Uint8Array(
      seeds.reduce((n, s) => n + s.length, 0) + 1 + 32 + PDA_MARKER.length,
    );
    let offset = 0;
    for (const part of [...seeds, Uint8Array.of(bump), program, PDA_MARKER]) {
      preimage.set(part, offset);
      offset += part.length;
    }
    const candidate = sha256(preimage, "bytes");
    try {
      ed25519.ExtendedPoint.fromHex(candidate);
    } catch {
      return [base58.encode(candidate), bump];
    }
  }
  throw new Error("No viable Solana program address bump");
}
