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

  it("writes little-endian integers and u32-length-prefixed strings", () => {
    expect(new BorshWriter().u32(0x01020304).finish()).toEqual(
      Uint8Array.of(0x04, 0x03, 0x02, 0x01),
    );
    expect(new BorshWriter().u64(0x0102030405060708n).finish()).toEqual(
      Uint8Array.of(0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01),
    );
    expect(new BorshWriter().u128(0x0102n).finish()).toEqual(
      Uint8Array.of(0x02, 0x01, ...Array(14).fill(0)),
    );
    expect(new BorshWriter().string("é").finish()).toEqual(
      Uint8Array.of(2, 0, 0, 0, 0xc3, 0xa9),
    );
  });

  it("reads a hand-written little-endian buffer", () => {
    const r = new BorshReader(
      Uint8Array.of(
        ...[0x04, 0x03, 0x02, 0x01],
        ...[0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01],
        ...[0x02, 0x01, ...Array(14).fill(0)],
        ...[2, 0, 0, 0, 0x68, 0x69],
      ),
    );
    expect([r.u32(), r.u64(), r.u128(), r.string()]).toEqual([
      0x01020304,
      0x0102030405060708n,
      0x0102n,
      "hi",
    ]);
    r.finish();
  });

  it("keeps a leading UTF-8 BOM like Rust String::from_utf8", () => {
    expect(
      new BorshReader(
        Uint8Array.of(4, 0, 0, 0, 0xef, 0xbb, 0xbf, 0x41),
      ).string(),
    ).toBe("\uFEFFA");
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
