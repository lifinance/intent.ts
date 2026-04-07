import { MultichainOrderIntent } from "./evm/multichain.evm";
import type { CompactLock, EscrowLock, MultichainOrder } from "../types";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";

export function inferLock(
  inputSettler: `0x${string}`,
): EscrowLock | CompactLock {
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

export function asMultichainIntent(arg: {
  order: MultichainOrder;
  inputSettler: `0x${string}`;
  lock?: EscrowLock | CompactLock;
}): MultichainOrderIntent {
  const { order, inputSettler, lock } = arg;
  return new MultichainOrderIntent(
    inputSettler,
    order,
    lock ?? inferLock(inputSettler),
  );
}
