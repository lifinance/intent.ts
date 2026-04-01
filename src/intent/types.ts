import type { MultichainOrder, SolanaStandardOrder, StandardOrder } from "../types/index";

export interface OrderIntentCommon<
  TOrder extends StandardOrder | SolanaStandardOrder | MultichainOrder =
    | StandardOrder
    | SolanaStandardOrder
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  asOrder(): TOrder;
  orderId(): `0x${string}`;
}

export interface EvmOrderIntent<
  TOrder extends StandardOrder | MultichainOrder =
    | StandardOrder
    | MultichainOrder,
> extends OrderIntentCommon<TOrder> {
  compactClaimHash(): `0x${string}`;
  inputChains(): bigint[];
}

export interface SolanaOrderIntent extends OrderIntentCommon<SolanaStandardOrder> {
  borshEncode(): Uint8Array;
  inputChain(): bigint;
}
