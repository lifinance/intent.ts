import { concat, hexToBytes, keccak256, numberToHex, toBytes } from "viem";
import type { MandateOutput, StandardStellar } from "../../types/index";
import { networkIdForStellar } from "../helpers/shared";
import type { OrderIntent } from "../types";

// -- ScVal XDR -------------------------------------------------------------- //
// Mirrors the Soroban `#[contracttype]` encoding of intent-soroban's `Order`,
// `MandateOutput` and `Solve` (structs are ScMaps keyed by field symbols, in
// symbol order). Byte parity is pinned by tests/vectors/stellarClientOrder.json.

const SCV_U32 = 3;
const SCV_U256 = 11;
const SCV_BYTES = 13;
const SCV_SYMBOL = 15;
const SCV_VEC = 16;
const SCV_MAP = 17;
const SCV_ADDRESS = 18;
const SC_ADDRESS_ACCOUNT = 0;
const SC_ADDRESS_CONTRACT = 1;
const PUBLIC_KEY_ED25519 = 0;

const U32_MAX = 4_294_967_295;
const I128_MAX = 2n ** 127n - 1n;
const U256_LIMIT = 2n ** 256n;
const MAX_ENTRIES = 4;
const MAX_DATA_BYTES = 256;

const ORDER_DOMAIN = toBytes("OIF.Stellar.Order.v1");

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

/** XDR variable opaque: length prefix, data, zero padding to 4 bytes. */
function opaque(data: Uint8Array): Uint8Array {
  return concat([
    u32(data.length),
    data,
    new Uint8Array((4 - (data.length % 4)) % 4),
  ]);
}

function bytes32(value: `0x${string}` | bigint, field: string): Uint8Array {
  if (typeof value === "bigint") {
    if (value < 0n || value >= U256_LIMIT)
      throw new Error(`${field} does not fit in 32 bytes: ${value}`);
    return hexToBytes(numberToHex(value, { size: 32 }));
  }
  const bytes = hexToBytes(value);
  if (bytes.length !== 32)
    throw new Error(`${field} must be exactly 32 bytes, got ${value}`);
  return bytes;
}

function scU32(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX)
    throw new Error(`${field} exceeds u32 max: ${value}`);
  return concat([u32(SCV_U32), u32(value)]);
}

const scU256 = (value: bigint, field: string) =>
  concat([u32(SCV_U256), bytes32(value, field)]);

function scBytes(value: `0x${string}`, field: string): Uint8Array {
  const data = hexToBytes(value);
  if (data.length > MAX_DATA_BYTES)
    throw new Error(`${field} exceeds ${MAX_DATA_BYTES} bytes`);
  return concat([u32(SCV_BYTES), opaque(data)]);
}

const scBytes32 = (value: `0x${string}` | bigint, field: string) =>
  concat([u32(SCV_BYTES), opaque(bytes32(value, field))]);

const scContract = (id: `0x${string}` | bigint, field: string) =>
  concat([u32(SCV_ADDRESS), u32(SC_ADDRESS_CONTRACT), bytes32(id, field)]);

const scVec = (items: Uint8Array[]) =>
  concat([u32(SCV_VEC), u32(1), u32(items.length), ...items]);

/** Struct as ScMap; Soroban requires keys in ascending symbol order. */
function scStruct(fields: Record<string, Uint8Array>): Uint8Array {
  const keys = Object.keys(fields).sort();
  return concat([
    u32(SCV_MAP),
    u32(1),
    u32(keys.length),
    ...keys.flatMap((key) => [
      concat([u32(SCV_SYMBOL), opaque(toBytes(key))]),
      fields[key]!,
    ]),
  ]);
}

function checkCount(count: number, field: string): void {
  if (count < 1 || count > MAX_ENTRIES)
    throw new Error(
      `Stellar orders take 1 to ${MAX_ENTRIES} ${field}, got ${count}`,
    );
}

// -- Public API ------------------------------------------------------------- //

/** ScVal XDR of an intent-soroban `MandateOutput`. */
export function encodeStellarMandateOutput(output: MandateOutput): Uint8Array {
  return scStruct({
    amount: scU256(BigInt(output.amount), "output amount"),
    callback_data: scBytes(output.callbackData, "callbackData"),
    chain_id: scU256(BigInt(output.chainId), "output chainId"),
    context: scBytes(output.context, "context"),
    oracle: scBytes32(output.oracle, "output oracle"),
    recipient: scBytes32(output.recipient, "output recipient"),
    settler: scBytes32(output.settler, "output settler"),
    token: scBytes32(output.token, "output token"),
  });
}

/** ScVal XDR of an intent-soroban `Order`. */
export function encodeStellarOrder(order: StandardStellar): Uint8Array {
  checkCount(order.inputs.length, "inputs");
  checkCount(order.outputs.length, "outputs");
  return scStruct({
    expires: scU32(Number(order.expires), "expires"),
    fill_deadline: scU32(Number(order.fillDeadline), "fillDeadline"),
    input_oracle: scContract(order.inputOracle, "inputOracle"),
    inputs: scVec(
      order.inputs.map(([token, amount]) => {
        const value = BigInt(amount);
        if (value < 1n || value > I128_MAX)
          throw new Error(`Input amount must be in 1..2^127-1, got ${value}`);
        return scStruct({
          amount: scU256(value, "input amount"),
          token: scContract(BigInt(token), "input token"),
        });
      }),
    ),
    nonce: scBytes32(BigInt(order.nonce), "nonce"),
    origin_chain: scU256(BigInt(order.originChainId), "originChainId"),
    outputs: scVec(order.outputs.map(encodeStellarMandateOutput)),
    user: concat([
      u32(SCV_ADDRESS),
      u32(SC_ADDRESS_ACCOUNT),
      u32(PUBLIC_KEY_ED25519),
      bytes32(order.user, "user"),
    ]),
  });
}

/** ScVal XDR of the `solves` argument of the escrow's `finalise`. */
export function encodeStellarSolves(
  solves: { solver: `0x${string}`; timestamp: number }[],
): Uint8Array {
  return scVec(
    solves.map(({ solver, timestamp }) =>
      scStruct({
        solver: scBytes32(solver, "solver"),
        timestamp: scU32(Number(timestamp), "timestamp"),
      }),
    ),
  );
}

/**
 * `keccak256("OIF.Stellar.Order.v1" ‖ networkId ‖ escrow ‖ XDR(order))`, the
 * id the InputEscrow at `inputSettler` assigns on the given network.
 */
export function stellarOrderId(
  networkId: `0x${string}`,
  inputSettler: `0x${string}`,
  order: StandardStellar,
): `0x${string}` {
  return keccak256(
    concat([
      ORDER_DOMAIN,
      bytes32(networkId, "networkId"),
      bytes32(inputSettler, "inputSettler"),
      encodeStellarOrder(order),
    ]),
  );
}

export function computeStandardStellarId(
  inputSettler: `0x${string}`,
  order: StandardStellar,
): `0x${string}` {
  return stellarOrderId(
    networkIdForStellar(BigInt(order.originChainId)),
    inputSettler,
    order,
  );
}

// -- Intent class ----------------------------------------------------------- //

export class StandardStellarIntent implements OrderIntent<StandardStellar> {
  inputSettler: `0x${string}`;
  readonly namespace = "stellar" as const;
  private readonly order: StandardStellar;

  constructor(inputSettler: `0x${string}`, order: StandardStellar) {
    this.inputSettler = inputSettler;
    this.order = order;
  }

  asOrder(): StandardStellar {
    return this.order;
  }

  inputChains(): [bigint] {
    return [BigInt(this.order.originChainId)];
  }

  xdr(): Uint8Array {
    return encodeStellarOrder(this.order);
  }

  orderId(): `0x${string}` {
    return computeStandardStellarId(this.inputSettler, this.order);
  }
}
