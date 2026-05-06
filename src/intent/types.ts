import type {
  MultichainOrder,
  StandardSolana,
  StandardEVM,
  StandardTron,
} from "../types/index";

export interface OrderIntent<
  TOrder extends
    | StandardEVM
    | StandardSolana
    | StandardTron
    | MultichainOrder =
    | StandardEVM
    | StandardSolana
    | StandardTron
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  namespace: NAMESPACES;
  asOrder(): TOrder;
  inputChains(): bigint[];
  orderId(): `0x${string}`;
}

export type NAMESPACES = "eip155" | "solana" | "bitcoin" | "tron";
