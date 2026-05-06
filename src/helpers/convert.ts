// --- Type conversion helpers --- //

import { checksumAddress } from "viem";

export function toBigIntWithDecimals(value: number, decimals: number): bigint {
  // Convert number to string in full precision
  const [intPart, decPart = ""] = value.toString().split(".");
  const normalizedInt = (intPart ?? "0").replace(/^(-?)0+(?=\d)/, "$1");

  // Take up to `decimals` digits of the decimal part
  const truncatedDec = decPart.slice(0, decimals);

  // Pad the decimal part to ensure we have exactly `decimals` digits
  const paddedDec = truncatedDec.padEnd(decimals, "0");

  // Remove leading zeros from intPart just in case
  // Combine parts
  const combined = (normalizedInt + paddedDec).replace(".", "");

  return BigInt(combined);
}

export function addressToBytes32(address: `0x${string}`): `0x${string}` {
  if (address.length === 66) return address;
  // Accept a 42-char EVM address or an already-padded 66-char bytes32 value.
  if (address.length !== 42) {
    throw new Error(`Invalid address length: ${address.length}`);
  }
  return `0x${address.replace("0x", "").padStart(64, "0")}`;
}

export function bytes32ToAddress(bytes: `0x${string}`): `0x${string}` {
  if (bytes.length != 66 && bytes.length != 64) {
    throw new Error(`Invalid bytes length: ${bytes.length}`);
  }
  return `0x${bytes.replace("0x", "").slice(24, 64)}`;
}

export function idToToken(id: `0x${string}` | bigint): `0x${string}` {
  if (typeof id === "string" && id.indexOf("0x") != 0) {
    id = BigInt(id);
  }
  if (typeof id === "bigint") {
    // Convert bigint to hex string and pad it to 64 characters.
    id = `0x${id.toString(16).padStart(64, "0")}`;
  }
  // Remove the first 12 bytes (24 hex characters) and keep the last 20 bytes (40 hex characters).
  return checksumAddress(bytes32ToAddress(id));
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function tronBase58ToHex(base58Address: string): `0x${string}` {
  let result = 0n;
  for (const char of base58Address) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid Base58 character: ${char}`);
    result = result * 58n + BigInt(idx);
  }
  const hex = result.toString(16);
  const padded = hex.length % 2 ? "0" + hex : hex;
  // Strip 1-byte network prefix (41) and 4-byte checksum (8 hex chars)
  const rawAddress = padded.slice(2, padded.length - 8);
  if (rawAddress.length !== 40) {
    throw new Error(
      `Invalid Tron address: expected 20-byte address, got ${rawAddress.length / 2} bytes`,
    );
  }
  return `0x${rawAddress}`;
}

export function trunc(
  value: `0x${string}`,
  length: number = 6,
): `0x${string}...${string}` {
  return `0x${value.replace("0x", "").slice(0, length)}...${value
    .replace("0x", "")
    .slice(-length)}`;
}
