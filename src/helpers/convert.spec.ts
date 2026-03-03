import { describe, expect, it } from "bun:test";
import {
  addressToBytes32,
  bytes32ToAddress,
  idToToken,
  toBigIntWithDecimals,
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
});
