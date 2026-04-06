export const ADDRESS_ZERO =
  "0x0000000000000000000000000000000000000000" as const;
export const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const COMPACT = "0x00000000000000171ede64904551eeDF3C6C9788" as const;
export const COIN_FILLER =
  "0x0000000000eC36B683C2E6AC89e9A75989C22a2e" as const;

export const INPUT_SETTLER_COMPACT_LIFI =
  "0x0000000000cd5f7fDEc90a03a31F79E5Fbc6A9Cf" as const;
export const INPUT_SETTLER_ESCROW_LIFI =
  "0x000025c3226C00B2Cdc200005a1600509f4e00C0" as const;
export const MULTICHAIN_INPUT_SETTLER_ESCROW =
  "0xb912b4c38ab54b94D45Ac001484dEBcbb519Bc2B" as const;
export const MULTICHAIN_INPUT_SETTLER_COMPACT =
  "0x1fccC0807F25A58eB531a0B5b4bf3dCE88808Ed7" as const;


// Solana config

export const SOLANA_MAINNET_CHAIN_ID = 1151111081099710n;
export const SOLANA_TESTNET_CHAIN_ID = 1151111081099711n;
export const SOLANA_DEVNET_CHAIN_ID = 1151111081099712n;

// TODO: fill in mainnet and testnet input settler programs once deployed.
// Do NOT use these constants directly — always go through
// `inputSettlerForSolana(chainId)` which throws for undeployed networks.
const SOLANA_MAINNET_INPUT_SETTLER_ESCROW = undefined;
const SOLANA_TESTNET_INPUT_SETTLER_ESCROW = undefined;
export const SOLANA_DEVNET_INPUT_SETTLER_ESCROW =
  "0x4186c46d62fb033aace3a262def7efbbef0591b8e98732bcd62edbbc0916da57" as const;

export const SOLANA_INPUT_SETTLER_PROGRAMS: Record<string, `0x${string}` | undefined> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_INPUT_SETTLER_ESCROW,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_INPUT_SETTLER_ESCROW,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
};

// TODO: fill in mainnet and testnet output settler PDAs once deployed.
// Do NOT use these constants directly — always go through
// `SOLANA_OUTPUT_SETTLER_PDAS[chainId]` which is guarded in buildMandateOutputs.
const SOLANA_MAINNET_OUTPUT_SETTLER_PDA = undefined;
const SOLANA_TESTNET_OUTPUT_SETTLER_PDA = undefined;
export const SOLANA_DEVNET_OUTPUT_SETTLER_PDA =
  "0xabb04f05c412a4892f8c93efa4eda9f360ba8b5c8342bed51207c7a4fdd036d6" as const;

export const SOLANA_OUTPUT_SETTLER_PDAS: Record<string, `0x${string}` | undefined> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_OUTPUT_SETTLER_PDA,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_OUTPUT_SETTLER_PDA,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_OUTPUT_SETTLER_PDA,
};
