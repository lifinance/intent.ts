import type { ResetPeriod } from "../compact/idLib";

export type Lock = {
  lockTag: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  chain: "evm";
};

export type EscrowLock = {
  type: "escrow";
  chain: "evm" | "solana";
};

export type CompactLock = {
  type: "compact";
  resetPeriod: ResetPeriod;
  allocatorId: string;
  chain: "evm";
};
