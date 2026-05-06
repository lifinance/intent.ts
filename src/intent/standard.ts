import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import { StandardTronIntent } from "./tron/standard.tron";
import type {
  StandardOrder,
  StandardSolana,
  StandardEVM,
  StandardTron,
} from "../types";
import type { NAMESPACES } from "./types";

type StandardIntentReturn<N extends NAMESPACES> = N extends "solana"
  ? StandardSolanaIntent
  : N extends "tron"
    ? StandardTronIntent
    : N extends "eip155"
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

  if (namespace === "tron")
    return new StandardTronIntent(
      inputSettler,
      order as StandardTron,
    ) as StandardIntentReturn<N>;

  if (namespace === "eip155")
    return new StandardEVMIntent(
      inputSettler,
      order as StandardEVM,
    ) as StandardIntentReturn<N>;

  throw new Error("Namespace not found");
}
