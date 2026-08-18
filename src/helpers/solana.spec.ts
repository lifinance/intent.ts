import { describe, expect, it } from "bun:test";

import {
  SOLANA_ADDRESS_BYTES,
  bytes32ToSolanaBase58,
  isSolanaBase58Address,
  solanaBase58ToBytes32,
} from "./solana";

// Canonical deployment addresses (catalyst-intent-svm/Anchor.toml) plus two
// well-known mainnet accounts. These double as the provenance record for the
// constants in ../constants.ts.
const VECTORS: [string, `0x${string}`][] = [
  [
    "LiFixdGLT5CMdLsHBvaijTXpPy4Uux9Y53SXkuR4HaK",
    "0x050cae668656471e02181ee1e6c52ee00a779ca7c481a04fb0e2ab9085f5c304",
  ],
  [
    "LiFiRp8RM7nJUZyUYC9FPPpDr7sAy5XPfBN6ABzBgT7",
    "0x050cae5ad286a6a6227a55fd650d63a3eccc866d6c293c94b87839e5cb6dba86",
  ],
  [
    "LiFiEDFjz5x1jJe9gSXNDHQW4dWt4yLXdp2VN4EiQUt",
    "0x050cae566a93270d66dbfe1915b80dc06e4a80178992592b3d8f51e888d0afe5",
  ],
  [
    "LiFiBtfyPT1DnTHTAeZ2rwr5RgMrThwA5kt7KGT5nBV",
    "0x050cae5588f8d907500199177ab1239f61b8557af2ffacd5defed0070b858ad4",
  ],
  [
    "BkEw3WHFvJR9a5deUcwPLJ79yK3r9YGdQ61TehFXzAQ",
    "0x02c0b32f8be4a5319a95cca17bd05eba48e7195ce52f1608723b51e575457df5",
  ],
  [
    "Cj3mSoPJtgi5bubC9rLz8oM1DuXoJj97RMw1uC6ev9zm",
    "0xae3613f974fc9cd94682bbff7bd7f229697616c5b6fdb6e0c16d1f02607242ae",
  ],
  [
    "DHShHmVkTwCzUzAQbCu4GDqJmursuDscNR6o4hTBgeRy",
    "0xb68296ce230150bb20190a46eb26a198b05bec8fc7f0fa893d690cf531fa9e54",
  ],
  [
    "49zLKETMq34CUC2E2wL1xvv6uN2AUgyhjVX221mjE3Rw",
    "0x2ee088ace4ac030d2266e50d829feeac73d1acb13e5825ef835d6f3318804796",
  ],
  // USDC mainnet mint
  [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61",
  ],
  // SPL Token program
  [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9",
  ],
];

// A key whose first byte is zero. Base58 encodes each leading zero byte as a
// literal "1", so this is the case a naive bignum-only codec silently corrupts.
const LEADING_ZERO_BASE58 = "1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE";
const LEADING_ZERO_HEX =
  "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" as const;

describe("solanaBase58ToBytes32", () => {
  it.each(VECTORS)("decodes %s", (base58Address, expected) => {
    expect(solanaBase58ToBytes32(base58Address)).toBe(expected);
  });

  it("preserves leading zero bytes", () => {
    expect(solanaBase58ToBytes32(LEADING_ZERO_BASE58)).toBe(LEADING_ZERO_HEX);
  });

  it("rejects a payload shorter than 32 bytes", () => {
    // 31 "1" characters decode to 31 zero bytes. (32 of them would be the
    // System Program address, which is a legitimate 32-byte key.)
    expect(() =>
      solanaBase58ToBytes32("1111111111111111111111111111111"),
    ).toThrow("32-byte key");
  });

  it("accepts the all-zero System Program address", () => {
    expect(solanaBase58ToBytes32("11111111111111111111111111111111")).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("rejects a payload longer than 32 bytes", () => {
    expect(() =>
      solanaBase58ToBytes32(
        "111111111111111111111111111111111111111111111111111111111111111111",
      ),
    ).toThrow("32-byte key");
  });

  it.each(["0", "O", "I", "l", "+", "/", " "])(
    "rejects the out-of-alphabet character %p",
    (bad) => {
      expect(() =>
        solanaBase58ToBytes32(
          `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt${bad}`,
        ),
      ).toThrow("Invalid Solana address");
    },
  );

  it("rejects an empty string", () => {
    expect(() => solanaBase58ToBytes32("")).toThrow("32-byte key");
  });

  it("rejects an EVM hex address", () => {
    expect(() =>
      solanaBase58ToBytes32("0x75220B7600c300005038432a0000f308e0000068"),
    ).toThrow("Invalid Solana address");
  });
});

describe("bytes32ToSolanaBase58", () => {
  it.each(VECTORS)("encodes back to %s", (expected, hex) => {
    expect(bytes32ToSolanaBase58(hex)).toBe(expected);
  });

  it("preserves leading zero bytes", () => {
    expect(bytes32ToSolanaBase58(LEADING_ZERO_HEX)).toBe(LEADING_ZERO_BASE58);
  });

  it("rejects a 20-byte EVM address", () => {
    expect(() =>
      bytes32ToSolanaBase58("0x75220B7600c300005038432a0000f308e0000068"),
    ).toThrow("32-byte hex");
  });

  it("rejects non-hex input", () => {
    expect(() =>
      bytes32ToSolanaBase58(
        "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
      ),
    ).toThrow("32-byte hex");
  });
});

describe("round trip", () => {
  it.each(VECTORS)("%s survives both directions", (base58Address, hex) => {
    expect(bytes32ToSolanaBase58(solanaBase58ToBytes32(base58Address))).toBe(
      base58Address,
    );
    expect(solanaBase58ToBytes32(bytes32ToSolanaBase58(hex))).toBe(hex);
  });
});

describe("isSolanaBase58Address", () => {
  it.each(VECTORS)("accepts %s", (base58Address) => {
    expect(isSolanaBase58Address(base58Address)).toBe(true);
  });

  it("rejects a Tron Base58Check address", () => {
    expect(isSolanaBase58Address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(
      false,
    );
  });

  it("rejects an EVM address", () => {
    expect(
      isSolanaBase58Address("0x75220B7600c300005038432a0000f308e0000068"),
    ).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSolanaBase58Address("")).toBe(false);
  });

  it("accepts a typo that still decodes to 32 bytes", () => {
    // Documents the absence of a checksum: unlike Tron's Base58Check, a
    // single-character mutation produces a *valid, different* key rather than
    // an error. This is why callers must round-trip and display the address
    // before signing — see the security note in ./solana.ts.
    const [valid] = VECTORS[0]!;
    const typo = `${valid.slice(0, -1)}${valid.at(-1) === "K" ? "L" : "K"}`;
    expect(typo).not.toBe(valid);
    expect(isSolanaBase58Address(typo)).toBe(true);
    expect(solanaBase58ToBytes32(typo)).not.toBe(VECTORS[0]![1]);
  });
});

describe("SOLANA_ADDRESS_BYTES", () => {
  it("is 32", () => {
    expect(SOLANA_ADDRESS_BYTES).toBe(32);
  });
});
