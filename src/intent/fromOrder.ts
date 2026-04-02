import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  StandardEVM,
  StandardSolana,
  StandardOrder,
} from "../types/index";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { MultichainOrderIntent } from "./multichain";
import { StandardEVMIntent } from "./standard";
import { StandardSolanaIntent } from "./solanaStandard";

type OrderLike = StandardOrder | MultichainOrder;

type StandardEVMToIntentOptions = {
  inputSettler: `0x${string}`;
  order: StandardEVM;
};

type StandardSolanaToIntentOptions = {
  inputSettler: `0x${string}`;
  order: StandardSolana;
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

const SOLANA_CHAIN_IDS = new Set([
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
]);

export function isStandardOrder(order: StandardOrder | MultichainOrder): order is StandardOrder {
  return "originChainId" in order;
}

export function isStandardSolana(order: OrderLike): order is StandardSolana {
  return "originChainId" in order && "inputs" in order && SOLANA_CHAIN_IDS.has((order as StandardOrder).originChainId);
}

function resolveStandardToIntent(order: StandardOrder, inputSettler: `0x${string}`): StandardEVMIntent | StandardSolanaIntent {
  if (isStandardSolana(order)) {
    return new StandardSolanaIntent(inputSettler, order);
  }
  return new StandardEVMIntent(inputSettler, order);
}

export function orderToIntent(
  options: StandardEVMToIntentOptions,
): StandardEVMIntent;
export function orderToIntent(
  options: StandardSolanaToIntentOptions,
): StandardSolanaIntent;
export function orderToIntent(
  options: MultichainOrderToIntentOptions,
): MultichainOrderIntent;
export function orderToIntent(
  options: OrderToIntentOptions,
): StandardEVMIntent | StandardSolanaIntent | MultichainOrderIntent;
export function orderToIntent(
  options:
    | StandardEVMToIntentOptions
    | StandardSolanaToIntentOptions
    | MultichainOrderToIntentOptions
    | OrderToIntentOptions,
): StandardEVMIntent | StandardSolanaIntent | MultichainOrderIntent {
  const { inputSettler, order } = options;

  if (isStandardOrder(order)) {
    return resolveStandardToIntent(order, inputSettler);
  }

  const lock = "lock" in options ? options.lock ?? inferLock(inputSettler) : inferLock(inputSettler);

  return new MultichainOrderIntent(inputSettler, order as MultichainOrder, lock);
}
