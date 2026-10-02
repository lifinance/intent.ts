import { describe, expect, it } from "bun:test";
import { BorshReader, BorshWriter, toBytes } from "./bytes";

describe("toBytes", () => {
  it("accepts prefixed and bare hex and rejects malformed input", () => {
    expect(toBytes("0x0aff")).toEqual(Uint8Array.of(10, 255));
    expect(toBytes("0aff")).toEqual(Uint8Array.of(10, 255));
    expect(() => toBytes("0xabc")).toThrow();
    expect(() => toBytes("0xzz")).toThrow();
  });
});

describe("Borsh", () => {
  it("round-trips little-endian integers and length-prefixed strings", () => {
    const max = (1n << 128n) - 1n;
    const r = new BorshReader(
      new BorshWriter()
        .u8(7)
        .u32(0x01020304)
        .u64(5n)
        .u128(max)
        .string("é")
        .finish(),
    );
    expect([r.u8(), r.u32(), r.u64(), r.u128(), r.string()]).toEqual([
      7,
      0x01020304,
      5n,
      max,
      "é",
    ]);
    r.finish();
  });

  it("rejects overflow, truncation, invalid UTF-8 and trailing bytes", () => {
    expect(() => new BorshWriter().u64(1n << 64n)).toThrow();
    expect(() => new BorshReader(Uint8Array.of(1, 0)).u32()).toThrow();
    expect(() =>
      new BorshReader(Uint8Array.of(1, 0, 0, 0, 0xff)).string(),
    ).toThrow();
    const r = new BorshReader(Uint8Array.of(1, 2));
    r.u8();
    expect(() => r.finish()).toThrow();
  });
});
