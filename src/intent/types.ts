import type { MultichainOrder, StandardSolana, StandardEVM } from "../types/index";

export interface OrderIntentCommon<
  TOrder extends StandardEVM | StandardSolana | MultichainOrder =
    | StandardEVM
    | StandardSolana
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  asOrder(): TOrder;
  orderId(): `0x${string}`;
}

export interface EvmOrderIntent<
  TOrder extends StandardEVM | MultichainOrder =
    | StandardEVM
    | MultichainOrder,
> extends OrderIntentCommon<TOrder> {
  compactClaimHash(): `0x${string}`;
  inputChains(): bigint[];
}

export interface SolanaOrderIntent extends OrderIntentCommon<StandardSolana> {
  borshEncode(): Uint8Array;
  inputChain(): bigint;
}
