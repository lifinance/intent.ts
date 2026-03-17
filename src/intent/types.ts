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
  compactClaimHash?(): `0x${string}`;
}


// export interface BaseOrderIntent<
//   TOrder extends StandardOrder | SolanaStandardOrder | MultichainOrder =
//     | StandardOrder
//     | SolanaStandardOrder
//     | MultichainOrder,
// > {
//   inputSettler: `0x${string}`;
//   asOrder(): TOrder;
//   orderId(): `0x${string}`;
// }

// export interface EvmOrderIntent<
//   TOrder extends StandardOrder | MultichainOrder =
//     | StandardOrder
//     | MultichainOrder,
// > extends BaseOrderIntent<TOrder> {
//   compactClaimHash(): `0x${string}`;
//   inputChains(): bigint[];
// }

// export interface SolanaOrderIntent<
//   TOrder extends SolanaStandardOrder = SolanaStandardOrder,
// > extends BaseOrderIntent<TOrder> {
//   inputChain(): MandateInput;
// }
