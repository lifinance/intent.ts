import type {
  CompactLock,
  EscrowLock,
  MultichainOrder,
  StandardOrder,
} from "../types/index";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import { asMultichainIntent } from "./multichain";
import { asStandardIntent } from "./standard";

type OrderToIntentOptions =
  | { namespace: "solana"; inputSettler: `0x${string}`; order: StandardOrder }
  | {
      namespace: "eip155";
      inputSettler: `0x${string}`;
      order: StandardOrder | MultichainOrder;
      lock?: EscrowLock | CompactLock;
    };

export function orderToIntent(options: {
  namespace: "solana";
  inputSettler: `0x${string}`;
  order: StandardOrder;
}): StandardSolanaIntent;
export function orderToIntent(options: {
  namespace: "eip155";
  inputSettler: `0x${string}`;
  order: StandardOrder;
}): StandardEVMIntent;
export function orderToIntent(options: {
  namespace: "eip155";
  inputSettler: `0x${string}`;
  order: MultichainOrder;
  lock?: EscrowLock | CompactLock;
}): MultichainOrderIntent;
export function orderToIntent(
  options: OrderToIntentOptions,
): StandardEVMIntent | StandardSolanaIntent | MultichainOrderIntent {
  const { namespace, inputSettler, order } = options;

  if (namespace === "solana") {
    return asStandardIntent({ namespace, order, inputSettler });
  }

  if ("originChainId" in order) {
    return asStandardIntent({ namespace, order, inputSettler });
  }

  return asMultichainIntent({ order, inputSettler, lock: options.lock });
}
