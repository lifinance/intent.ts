import type { MultichainOrder, SolanaStandardOrder, StandardOrder } from "../types/index";

export interface OrderIntentCommon<
  TOrder extends StandardOrder | SolanaStandardOrder | MultichainOrder =
    | StandardOrder
    | SolanaStandardOrder
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  asOrder(): TOrder;
  inputChains(): bigint[];
  orderId(): `0x${string}`;
}
