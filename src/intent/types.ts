import type { MultichainOrder, StandardOrder } from "../types";

export interface OrderIntentCommon<
  TOrder extends StandardOrder | MultichainOrder =
    | StandardOrder
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  asOrder(): TOrder;
  inputChains(): bigint[];
  orderId(): `0x${string}`;
  compactClaimHash(): `0x${string}`;
}
