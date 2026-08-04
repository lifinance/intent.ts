import { describe, expect, it } from "bun:test";
import { createBase58check } from "@scure/base";
import { sha256 } from "viem";
import {
  TRON_ADDRESS_PREFIX,
  hexToTronBase58,
  isTronBase58Address,
  tronBase58ToHex,
} from "./tron";

const base58check = createBase58check((data: Uint8Array) =>
  sha256(data, "bytes"),
);

// Known-good vectors: canonical + legacy Tron deployments and Tron USDT/USDC.
const VECTORS: [string, `0x${string}`][] = [
  [
    "TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCNq",
    "0xaa2e58aa1a4107dc8cc7ef41b97be90b25b5b842",
  ],
  [
    "TLwJhhq7fExHWdJQfMnsSY7VcreipmhLRm",
    "0x784d4f7b6e99b22d923ec99edbe2e11b38ceac93",
  ],
  [
    "TPXQkHcGwEdH4Ss8kT4cDxgXt3L4n4zSHJ",
    "0x94b0c01e26aff5a6a0fd767afe0e3ca0f8b34e3d",
  ],
  [
    "TXmVLCXzrhzmeCfchDPTmFF6Qe7rg3H7Kk",
    "0xef1b684567bfcbabb19d01a84bc3f218081b1536",
  ],
  [
    "THWDD3umarircbqo8jXxVazbpJnE25VjhN",
    "0x52a5f2a94125ef11673f86104e2ce3f86ece2c25",
  ],
  [
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    "0xa614f803b6fd780986a42c78ec9c7f77e6ded13c",
  ],
];

describe("tronBase58ToHex", () => {
  it("decodes known addresses", () => {
    for (const [base58, hex] of VECTORS) {
      expect(tronBase58ToHex(base58)).toBe(hex);
    }
  });

  it("throws on checksum corruption (single-character typo)", () => {
    for (const [base58] of VECTORS) {
      const last = base58.at(-1)!;
      const swapped = last === "k" ? "m" : "k";
      expect(() => tronBase58ToHex(base58.slice(0, -1) + swapped)).toThrow(
        "checksum",
      );
      const mid = base58[17] === "a" ? "b" : "a";
      expect(() =>
        tronBase58ToHex(base58.slice(0, 17) + mid + base58.slice(18)),
      ).toThrow();
    }
  });

  it("throws on invalid Base58 characters", () => {
    for (const char of ["0", "O", "I", "l", "+", " "]) {
      expect(() =>
        tronBase58ToHex(`TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCN${char}`),
      ).toThrow("Unknown letter");
    }
  });

  it("throws on truncated or empty input (checksum cannot verify)", () => {
    expect(() => tronBase58ToHex("TRV3Ps")).toThrow("checksum");
    expect(() => tronBase58ToHex("")).toThrow("checksum");
  });

  it("throws on a valid-checksum payload of the wrong length", () => {
    // 0x41 prefix + only 19 body bytes, correctly checksummed.
    const short = base58check.encode(
      new Uint8Array([TRON_ADDRESS_PREFIX, ...new Array(19).fill(7)]),
    );
    expect(() => tronBase58ToHex(short)).toThrow("21-byte payload");
  });

  it("throws on wrong version prefix", () => {
    // A Bitcoin P2PKH address is valid Base58Check with version 0x00.
    expect(() => tronBase58ToHex("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toThrow(
      "prefix",
    );
  });
});

describe("hexToTronBase58", () => {
  it("encodes known addresses", () => {
    for (const [base58, hex] of VECTORS) {
      expect(hexToTronBase58(hex)).toBe(base58);
    }
  });

  it("round-trips both directions", () => {
    for (const [base58, hex] of VECTORS) {
      expect(hexToTronBase58(tronBase58ToHex(base58))).toBe(base58);
      expect(tronBase58ToHex(hexToTronBase58(hex))).toBe(hex);
    }
  });

  it("handles leading zero bytes in the address body", () => {
    const zeroLead = "0x00000000000000000000000000000000000000ff" as const;
    const encoded = hexToTronBase58(zeroLead);
    expect(tronBase58ToHex(encoded)).toBe(zeroLead);
  });

  it("rejects malformed hex input", () => {
    expect(() => hexToTronBase58("0x1234" as `0x${string}`)).toThrow(
      "20-byte hex",
    );
    expect(() =>
      hexToTronBase58("0xzz2e58aa1a4107dc8cc7ef41b97be90b25b5b842"),
    ).toThrow("20-byte hex");
  });
});

describe("isTronBase58Address", () => {
  it("accepts all known-good vectors", () => {
    for (const [base58] of VECTORS) {
      expect(isTronBase58Address(base58)).toBe(true);
    }
  });

  it("rejects corruption and malformed values without throwing", () => {
    expect(isTronBase58Address("TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCNk")).toBe(
      false,
    ); // checksum typo
    expect(isTronBase58Address("")).toBe(false);
    expect(isTronBase58Address("short")).toBe(false);
    expect(
      isTronBase58Address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    ).toBe(false);
    expect(isTronBase58Address("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(
      false,
    ); // valid Base58Check, wrong version + length
    expect(isTronBase58Address("TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCN0")).toBe(
      false,
    ); // invalid alphabet char
  });
});

describe("TRON_ADDRESS_PREFIX", () => {
  it("is 0x41", () => {
    expect(TRON_ADDRESS_PREFIX).toBe(0x41);
  });
});
