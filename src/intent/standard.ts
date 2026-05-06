import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import type { StandardOrder, StandardSolana, StandardEVM } from "../types";
import type { NAMESPACES } from "./types";

type StandardIntentReturn<N extends NAMESPACES> = N extends "solana"
  ? StandardSolanaIntent
  : N extends "eip155" | "tron"
    ? StandardEVMIntent
    : never;

export function asStandardIntent<N extends NAMESPACES>(arg: {
  namespace: N;
  order: StandardOrder;
  inputSettler: `0x${string}`;
}): StandardIntentReturn<N> {
  const { namespace, order, inputSettler } = arg;

  if (namespace === "solana")
    return new StandardSolanaIntent(
      inputSettler,
      order as StandardSolana,
    ) as StandardIntentReturn<N>;

  if (namespace === "eip155" || namespace === "tron")
    return new StandardEVMIntent(
      inputSettler,
      order as StandardEVM,
      namespace,
    ) as StandardIntentReturn<N>;

  throw new Error("Namespace not found");
}
