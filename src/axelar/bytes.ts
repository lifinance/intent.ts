import { base58 } from "@scure/base";
import { hexToBytes } from "viem";

export type Hex = `0x${string}`;
export type Bytes = Hex | Uint8Array;

export const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Accepts raw bytes or even-length hex with an optional `0x` prefix. */
export function toBytes(value: Bytes | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex))
    throw new Error(`Invalid hex bytes: ${value}`);
  return hexToBytes(`0x${hex}`);
}

export function bytes32(value: Bytes | string, label: string): Uint8Array {
  const bytes = toBytes(value);
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return bytes;
}

export function pubkey(value: string, label = "Solana address"): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  if (bytes.length !== 32) throw new Error(`Invalid ${label}: ${value}`);
  return bytes;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function uintLe(value: bigint, size: number, label: string): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(8 * size))
    throw new Error(`${label} exceeds u${8 * size}`);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++)
    out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
  return out;
}

/** Borsh serializer for the fixed set of types used by the Axelar ABIs. */
export class BorshWriter {
  private readonly parts: Uint8Array[] = [];
  raw(bytes: Uint8Array): this {
    this.parts.push(bytes);
    return this;
  }
  u8(value: number): this {
    return this.raw(uintLe(BigInt(value), 1, "u8"));
  }
  u32(value: number): this {
    return this.raw(uintLe(BigInt(value), 4, "u32"));
  }
  u64(value: bigint): this {
    return this.raw(uintLe(value, 8, "u64"));
  }
  u128(value: bigint): this {
    return this.raw(uintLe(value, 16, "u128"));
  }
  bytes(value: Uint8Array): this {
    return this.u32(value.length).raw(value);
  }
  string(value: string): this {
    return this.bytes(utf8.encode(value));
  }
  finish(): Uint8Array {
    return concat(...this.parts);
  }
}

export const u128Le = (value: bigint): Uint8Array => uintLe(value, 16, "u128");

/** Strict Borsh reader; `finish` rejects trailing bytes as `borsh::from_slice` does. */
export class BorshReader {
  offset = 0;
  constructor(readonly data: Uint8Array) {}
  take(n: number): Uint8Array {
    if (n < 0 || this.offset + n > this.data.length)
      throw new Error("Truncated Borsh data");
    const out = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  private uint(size: number): bigint {
    const b = this.take(size);
    let value = 0n;
    for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(b[i]!);
    return value;
  }
  u8(): number {
    return Number(this.uint(1));
  }
  u16(): number {
    return Number(this.uint(2));
  }
  u32(): number {
    return Number(this.uint(4));
  }
  u64(): bigint {
    return this.uint(8);
  }
  u128(): bigint {
    return this.uint(16);
  }
  bytes(): Uint8Array {
    return this.take(this.u32());
  }
  string(): string {
    return strictUtf8.decode(this.bytes());
  }
  finish(): void {
    if (this.offset !== this.data.length)
      throw new Error("Trailing Borsh bytes");
  }
}
