import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  StandardOrder,
} from "../types/index";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { MultichainOrderIntent } from "./multichain";
import { StandardOrderIntent } from "./standard";

type OrderLike = StandardOrder | MultichainOrder;

type StandardOrderToIntentOptions = {
  inputSettler: `0x${string}`;
  order: StandardOrder;
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
    };
  }
  return { type: "escrow" };
}

export function isStandardOrder(order: OrderLike): order is StandardOrder {
  return "originChainId" in order && "inputs" in order;
}


export function orderToIntent(
  options: StandardOrderToIntentOptions,
): StandardOrderIntent;
export function orderToIntent(
  options: MultichainOrderToIntentOptions,
): MultichainOrderIntent;
export function orderToIntent(
  options: OrderToIntentOptions,
): StandardOrderIntent | MultichainOrderIntent;
export function orderToIntent(
  options:
    | StandardOrderToIntentOptions
    | MultichainOrderToIntentOptions
    | OrderToIntentOptions,
): StandardOrderIntent | MultichainOrderIntent {
  const { inputSettler, order } = options;
  if (isStandardOrder(order)) {
    return new StandardOrderIntent(inputSettler, order);
  }
  return new MultichainOrderIntent(
    inputSettler,
    order,
    (options as MultichainOrderToIntentOptions).lock ?? inferLock(inputSettler),
  );
}
