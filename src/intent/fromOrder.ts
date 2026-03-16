import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  SolanaStandardOrder,
  StandardOrder,
} from "../types/index";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { MultichainOrderIntent } from "./multichain";
import { StandardOrderIntent } from "./standard";
import { SolanaStandardOrderIntent } from "./solanaStandard";

type OrderLike = StandardOrder | SolanaStandardOrder | MultichainOrder;

type StandardOrderToIntentOptions = {
  inputSettler: `0x${string}`;
  order: StandardOrder;
};

type SolanaStandardOrderToIntentOptions = {
  inputSettler: `0x${string}`;
  order: SolanaStandardOrder;
};

type MultichainOrderToIntentOptions = {
  inputSettler: `0x${string}`;
  order: MultichainOrder;
  lock?: EscrowLock | CompactLock;
};

type OrderToIntentOptions = {
  inputSettler: `0x${string}`;
  order: OrderLike;
  lock?: EscrowLock | CompactLock;
};

function inferLock(inputSettler: `0x${string}`): EscrowLock | CompactLock {
  const normalized = inputSettler.toLowerCase();
  if (
    normalized === INPUT_SETTLER_COMPACT_LIFI.toLowerCase() ||
    normalized === MULTICHAIN_INPUT_SETTLER_COMPACT.toLowerCase()
  ) {
    return {
      type: "compact",
      resetPeriod: ResetPeriod.OneDay,
      allocatorId: "0",
      chain: "evm" as const,
    };
  }
  return { type: "escrow", chain: "evm" as const };
}

export function isStandardOrder(order: OrderLike): order is StandardOrder {
  return "originChainId" in order && "inputs" in order;
}

export function isSolanaStandardOrder(
  order: OrderLike,
): order is SolanaStandardOrder {
  return "originChainId" in order && "input" in order;
}

export function orderToIntent(
  options: StandardOrderToIntentOptions,
): StandardOrderIntent;
export function orderToIntent(
  options: SolanaStandardOrderToIntentOptions,
): SolanaStandardOrderIntent;
export function orderToIntent(
  options: MultichainOrderToIntentOptions,
): MultichainOrderIntent;
export function orderToIntent(
  options: OrderToIntentOptions,
): StandardOrderIntent | SolanaStandardOrderIntent | MultichainOrderIntent;
export function orderToIntent(
  options:
    | StandardOrderToIntentOptions
    | SolanaStandardOrderToIntentOptions
    | MultichainOrderToIntentOptions
    | OrderToIntentOptions,
): StandardOrderIntent | SolanaStandardOrderIntent | MultichainOrderIntent {
  const { inputSettler, order } = options;

  if (isStandardOrder(order)) return new StandardOrderIntent(inputSettler, order);
  if (isSolanaStandardOrder(order)) return new SolanaStandardOrderIntent(inputSettler, order);

  const lock = "lock" in options ? options.lock ?? inferLock(inputSettler) : inferLock(inputSettler);

  return new MultichainOrderIntent(inputSettler, order, lock);
}
