import { hexToBytes, keccak256, numberToHex, pad } from "viem";
import { serialize } from "borsh";
import type {
  MandateOutput,
  SolanaStandardOrder,
  StandardOrder,
} from "../types/index";
import type { OrderIntentCommon } from "./types";

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

// Ensure the 32-bytes
const toBytes32 = (hex: `0x${string}`) => hexToBytes(pad(hex, { size: 32 }));
const bigintToBytes32 = (value: bigint) => hexToBytes(numberToHex(value, { size: 32 }));

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

export function borshEncodeSolanaOrder(
  order: SolanaStandardOrder,
): Uint8Array {
  return serialize(standardOrderSchema, {
    user: toBytes32(order.user),
    nonce: BigInt(order.nonce),
    origin_chain_id: BigInt(order.originChainId),
    expires: Number(order.expires),
    fill_deadline: Number(order.fillDeadline),
    input_oracle: toBytes32(order.inputOracle),
    input: {
      token: toBytes32(order.input.token),
      amount: BigInt(order.input.amount),
    },
    outputs: order.outputs.map(toBorshOutput),
  });
}

export function computeSolanaStandardOrderId(
  order: SolanaStandardOrder,
): `0x${string}` {
  return keccak256(borshEncodeSolanaOrder(order));
}

// -- Conversion helpers ----------------------------------------------------- //

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
      token: numberToHex(tokenBigInt, { size: 32 }),
      amount,
    },
    outputs: order.outputs,
  };
}


// -- Intent class ----------------------------------------------------------- //

export class SolanaStandardOrderIntent
  implements OrderIntentCommon<SolanaStandardOrder>
{
  inputSettler: `0x${string}`;
  private readonly order: SolanaStandardOrder;

  constructor(inputSettler: `0x${string}`, order: SolanaStandardOrder) {
    this.inputSettler = inputSettler;
    this.order = order;
  }

  asOrder(): SolanaStandardOrder {
    return this.order;
  }

  inputChains(): bigint[] {
    return [this.order.originChainId];
  }

  orderId(): `0x${string}` {
    return computeSolanaStandardOrderId(this.order);
  }
}
