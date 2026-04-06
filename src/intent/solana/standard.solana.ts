import { hexToBytes, keccak256, numberToHex, pad } from "viem";
import { serialize } from "borsh";
import type {
  MandateOutput,
  StandardSolana,
  StandardOrder,
} from "../types/index";
import type { SolanaOrderIntent } from "./types";

// -- Borsh schemas ---------------------------------------------------------- //
// Mirrors `common::types::StandardOrder` in catalyst-intent-svm.

const bytes32 = { array: { type: "u8" as const, len: 32 } };

const mandateOutputSchema = {
  struct: {
    oracle: bytes32,
    settler: bytes32,
    chain_id: bytes32,
    token: bytes32,
    amount: bytes32,
    recipient: bytes32,
    callback_data: { array: { type: "u8" as const } },
    context: { array: { type: "u8" as const } },
  },
};

// Input amount is u64 (not bytes32 like outputs) because the Solana program
// stores SPL token amounts as u64, which covers the full u64 max supply.
const mandateInputSchema = {
  struct: {
    token: bytes32,
    amount: "u64" as const,
  },
};

const standardOrderSchema = {
  struct: {
    user: bytes32,
    nonce: "u128" as const,
    origin_chain_id: "u128" as const,
    expires: "u32" as const,
    fill_deadline: "u32" as const,
    input_oracle: bytes32,
    input: mandateInputSchema,
    outputs: { array: { type: mandateOutputSchema } },
  },
};

// -- Helpers ---------------------------------------------------------------- //

// Pad a hex value to 32 bytes for Borsh encoding.
const toBytes32 = (hex: `0x${string}`) => hexToBytes(pad(hex, { size: 32 }));
const bigintToBytes32 = (value: bigint) =>
  hexToBytes(numberToHex(value, { size: 32 }));

function toBorshOutput(o: MandateOutput) {
  return {
    oracle: toBytes32(o.oracle),
    settler: toBytes32(o.settler),
    chain_id: bigintToBytes32(o.chainId),
    token: toBytes32(o.token),
    amount: bigintToBytes32(o.amount),
    recipient: toBytes32(o.recipient),
    callback_data: hexToBytes(o.callbackData),
    context: hexToBytes(o.context),
  };
}

// -- Public API ------------------------------------------------------------- //

const U32_MAX = 4_294_967_295;

export function borshEncodeSolanaOrder(order: StandardSolana): Uint8Array {
  if (order.expires > U32_MAX)
    throw new Error(`expires exceeds u32 max: ${order.expires}`);
  if (order.fillDeadline > U32_MAX)
    throw new Error(`fillDeadline exceeds u32 max: ${order.fillDeadline}`);

  const [tokenBigInt, inputAmount] = order.inputs[0];

  return serialize(standardOrderSchema, {
    user: toBytes32(order.user),
    nonce: BigInt(order.nonce),
    origin_chain_id: BigInt(order.originChainId),
    expires: order.expires,
    fill_deadline: order.fillDeadline,
    input_oracle: toBytes32(order.inputOracle),
    input: {
      token: bigintToBytes32(tokenBigInt),
      amount: BigInt(inputAmount),
    },
    outputs: order.outputs.map(toBorshOutput),
  });
}

export function computeStandardSolanaId(order: StandardSolana): `0x${string}` {
  return keccak256(borshEncodeSolanaOrder(order));
}

// -- Conversion helpers ----------------------------------------------------- //

/**
 * Converts a `StandardOrder` with a single input into a `StandardSolana`.
 * Use this when the order was constructed via the EVM path but needs to be
 * submitted to the Solana input settler (e.g. for cross-chain reconstruction).
 * Throws if the order contains zero or more than one input.
 */
export function standardOrderToSolanaOrder(
  order: StandardOrder,
): StandardSolana {
  if (order.inputs.length === 0) throw new Error("No inputs in order");
  if (order.inputs.length > 1)
    throw new Error("StandardSolana only supports a single input");
  return {
    user: order.user,
    nonce: order.nonce,
    originChainId: order.originChainId,
    expires: order.expires,
    fillDeadline: order.fillDeadline,
    inputOracle: order.inputOracle,
    inputs: [order.inputs[0]!],
    outputs: order.outputs,
  };
}

// -- Intent class ----------------------------------------------------------- //

export class StandardSolanaIntent implements SolanaOrderIntent {
  inputSettler: `0x${string}`;
  private readonly order: StandardSolana;

  constructor(inputSettler: `0x${string}`, order: StandardSolana) {
    this.inputSettler = inputSettler;
    this.order = order;
  }

  asOrder(): StandardSolana {
    return this.order;
  }

  inputChain(): bigint {
    return this.order.originChainId;
  }

  borshEncode(): Uint8Array {
    return borshEncodeSolanaOrder(this.order);
  }

  orderId(): `0x${string}` {
    return computeStandardSolanaId(this.order);
  }
}
