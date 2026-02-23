import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  StandardOrder,
} from "../types";
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
  lock: EscrowLock | CompactLock;
};

export function isStandardOrder(order: OrderLike): order is StandardOrder {
  return "originChainId" in order;
}

export function orderToIntent(
  options: StandardOrderToIntentOptions,
): StandardOrderIntent;
export function orderToIntent(
  options: MultichainOrderToIntentOptions,
): MultichainOrderIntent;
export function orderToIntent(
  options: StandardOrderToIntentOptions | MultichainOrderToIntentOptions,
): StandardOrderIntent | MultichainOrderIntent {
  const { inputSettler, order } = options;
  if (isStandardOrder(order)) {
    return new StandardOrderIntent(inputSettler, order);
  }
  return new MultichainOrderIntent(
    inputSettler,
    order,
    (options as MultichainOrderToIntentOptions).lock,
  );
}
