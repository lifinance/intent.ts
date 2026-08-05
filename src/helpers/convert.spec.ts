import { describe, expect, it } from "bun:test";
import {
  addressToBytes32,
  bytes32ToAddress,
  idToToken,
  toBigIntWithDecimals,
  tronBase58ToHex,
  trunc,
} from "./convert";

describe("convert helpers", () => {
  it("converts decimal numbers to bigint with truncation", () => {
    expect(toBigIntWithDecimals(1.2345, 2)).toBe(123n);
    expect(toBigIntWithDecimals(1, 4)).toBe(10000n);
    expect(toBigIntWithDecimals(-0.5, 3)).toBe(-500n);
  });

  it("converts address and bytes32 back and forth", () => {
    const address = "0x1111111111111111111111111111111111111111" as const;
    const bytes = addressToBytes32(address);
    expect(bytes).toHaveLength(66);
    expect(bytes.endsWith(address.slice(2))).toBe(true);
    expect(bytes32ToAddress(bytes)).toBe(address);
  });

  it("passes through an already-padded bytes32 address unchanged", () => {
    const bytes32 =
      "0x0000000000000000000000001111111111111111111111111111111111111111" as const;
    expect(addressToBytes32(bytes32)).toBe(bytes32);
  });

  it("throws for invalid address and bytes lengths", () => {
    expect(() => addressToBytes32("0x1234" as `0x${string}`)).toThrow(
      "Invalid address length",
    );
    expect(() => bytes32ToAddress("0x1234" as `0x${string}`)).toThrow(
      "Invalid bytes length",
    );
  });

  it("extracts token addresses from lock ids", () => {
    const expected = "0x0000000000000000000000000000000000000001";
    expect(idToToken(1n).toLowerCase()).toBe(expected);
    expect(
      idToToken(`0x${"00".repeat(31)}01` as `0x${string}`).toLowerCase(),
    ).toBe(expected);
  });

  it("truncates long hex values for display", () => {
    const value = `0x${"a".repeat(40)}` as `0x${string}`;
    expect(trunc(value)).toBe("0xaaaaaa...aaaaaa");
    expect(trunc(value, 4)).toBe("0xaaaa...aaaa");
  });

  describe("tronBase58ToHex", () => {
    it("converts known Tron Base58 addresses to hex", () => {
      expect(tronBase58ToHex("TXmVLCXzrhzmeCfchDPTmFF6Qe7rg3H7Kk")).toBe(
        "0xef1b684567bfcbabb19d01a84bc3f218081b1536",
      );
      expect(tronBase58ToHex("THWDD3umarircbqo8jXxVazbpJnE25VjhN")).toBe(
        "0x52a5f2a94125ef11673f86104e2ce3f86ece2c25",
      );
    });

    it("throws for invalid Base58 characters", () => {
      expect(() => tronBase58ToHex("T0OOinvalid")).toThrow(
        "Invalid Base58 character",
      );
    });
  });
});
