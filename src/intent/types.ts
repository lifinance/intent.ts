import type {
  MultichainOrder,
  StandardSolana,
  StandardEVM,
} from "../types/index";

export interface OrderIntent<
  TOrder extends StandardEVM | StandardSolana | MultichainOrder =
    | StandardEVM
    | StandardSolana
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  namespace: NAMESPACES;
  asOrder(): TOrder;
  inputChains(): bigint[];
  orderId(): `0x${string}`;
}

export type NAMESPACES = "eip155" | "solana" | "bitcoin";
