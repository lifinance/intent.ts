import { keccak256 } from "viem";
import type { MandateOutput, SolanaStandardOrder, StandardOrder } from "../types";

// -- Borsh encoding helpers ------------------------------------------------- //

function hexToBytes(hex: `0x${string}`, size?: number): Uint8Array {
  const raw = hex.replace("0x", "");
  const padded = size ? raw.padStart(size * 2, "0") : raw;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bigintToBeBytes(value: bigint | number, size: number): Uint8Array {
  const v = BigInt(value);
  return hexToBytes(
    `0x${v.toString(16).padStart(size * 2, "0")}`,
    size,
  );
}

function u32LE(value: number | bigint): Uint8Array {
  const v = Number(value);
  const buf = new Uint8Array(4);
  buf[0] = v & 0xff;
  buf[1] = (v >>> 8) & 0xff;
  buf[2] = (v >>> 16) & 0xff;
  buf[3] = (v >>> 24) & 0xff;
  return buf;
}

function u64LE(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) buf[i] = Number((v >> BigInt(i * 8)) & 0xffn);
  return buf;
}

function u128LE(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  const buf = new Uint8Array(16);
  for (let i = 0; i < 16; i++)
    buf[i] = Number((v >> BigInt(i * 8)) & 0xffn);
  return buf;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function borshEncodeOutput(o: MandateOutput): Uint8Array {
  const cbData =
    o.callbackData === "0x" ? new Uint8Array(0) : hexToBytes(o.callbackData);
  const ctx = o.context === "0x" ? new Uint8Array(0) : hexToBytes(o.context);
  return concat(
    hexToBytes(o.oracle, 32),
    hexToBytes(o.settler, 32),
    bigintToBeBytes(o.chainId, 32),
    hexToBytes(o.token, 32),
    bigintToBeBytes(o.amount, 32),
    hexToBytes(o.recipient, 32),
    u32LE(cbData.length),
    cbData,
    u32LE(ctx.length),
    ctx,
  );
}

/**
 * Borsh-encode a SolanaStandardOrder exactly as the on-chain Anchor program does.
 * Field layout mirrors `common::types::StandardOrder` in catalyst-intent-svm.
 */
export function borshEncodeSolanaOrder(
  order: SolanaStandardOrder,
): Uint8Array {
  const outputs = order.outputs.map(borshEncodeOutput);
  return concat(
    hexToBytes(order.user, 32),
    u128LE(order.nonce),
    u128LE(order.originChainId),
    u32LE(order.expires),
    u32LE(order.fillDeadline),
    hexToBytes(order.inputOracle, 32),
    hexToBytes(order.input.token, 32),
    u64LE(order.input.amount),
    u32LE(order.outputs.length),
    ...outputs,
  );
}

export function computeSolanaStandardOrderId(
  order: SolanaStandardOrder,
): `0x${string}` {
  return keccak256(borshEncodeSolanaOrder(order));
}

// -- Conversion helpers ----------------------------------------------------- //

/**
 * Convert a StandardOrder with a 32-byte user (Solana-origin) back to a
 * SolanaStandardOrder so we can compute the correct Borsh-based order ID.
 * The API normalises Solana orders into StandardOrder shape (inputs array).
 */
export function standardOrderToSolanaOrder(
  order: StandardOrder,
): SolanaStandardOrder {
  const [firstInput] = order.inputs;
  if (!firstInput) throw new Error("No inputs in order");
  const [tokenBigInt, amount] = firstInput;
  return {
    user: order.user,
    nonce: order.nonce,
    originChainId: order.originChainId,
    expires: order.expires,
    fillDeadline: order.fillDeadline,
    inputOracle: order.inputOracle,
    input: {
      token: `0x${tokenBigInt.toString(16).padStart(64, "0")}`,
      amount,
    },
    outputs: order.outputs,
  };
}

/**
 * Convert a SolanaStandardOrder to a StandardOrder for storage in OrderContainer.
 */
export function solanaOrderToStandardOrder(
  order: SolanaStandardOrder,
): StandardOrder {
  return {
    user: order.user,
    nonce: order.nonce,
    originChainId: order.originChainId,
    expires: order.expires,
    fillDeadline: order.fillDeadline,
    inputOracle: order.inputOracle,
    inputs: [[BigInt(order.input.token), order.input.amount]],
    outputs: order.outputs,
  };
}

// -- Intent class ----------------------------------------------------------- //

export class SolanaStandardOrderIntent {
  private readonly _order: SolanaStandardOrder;

  constructor(order: SolanaStandardOrder) {
    this._order = order;
  }

  asOrder(): SolanaStandardOrder {
    return this._order;
  }

  orderId(): `0x${string}` {
    return computeSolanaStandardOrderId(this._order);
  }
}
