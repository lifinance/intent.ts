import type {
  MultichainOrder,
  StandardSolana,
  StandardEVM,
  StandardStellar,
} from "../types/index";

export interface OrderIntent<
  TOrder extends
    | StandardEVM
    | StandardSolana
    | StandardStellar
    | MultichainOrder =
    | StandardEVM
    | StandardSolana
    | StandardStellar
    | MultichainOrder,
> {
  inputSettler: `0x${string}`;
  namespace: NAMESPACES;
  asOrder(): TOrder;
  inputChains(): bigint[];
  orderId(): `0x${string}`;
}

export type NAMESPACES = "eip155" | "solana" | "bitcoin" | "tron" | "stellar";
