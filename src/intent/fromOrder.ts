import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  StandardEVM,
  StandardSolana,
  StandardOrder,
} from "../types/index";
import {
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
} from "../constants";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import { asMultichainIntent } from "./multichain";
import { asStandardIntent } from "./standard";

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

const SOLANA_CHAIN_IDS = new Set([
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
]);

export function isStandardOrder(
  order: StandardOrder | MultichainOrder,
): order is StandardOrder {
  return "originChainId" in order;
}

export function isStandardSolana(order: OrderLike): order is StandardSolana {
  return (
    "originChainId" in order &&
    SOLANA_CHAIN_IDS.has((order as StandardOrder).originChainId)
  );
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

  if (!isStandardOrder(order)) {
    const lock = "lock" in options ? options.lock : undefined;
    return asMultichainIntent({ order, inputSettler, lock });
  }

  if (isStandardSolana(order)) {
    return asStandardIntent({ namespace: "solana", order, inputSettler });
  }

  return asStandardIntent({ namespace: "eip155", order, inputSettler });
}
