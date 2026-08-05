export const ADDRESS_ZERO =
  "0x0000000000000000000000000000000000000000" as const;
export const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const COMPACT = "0x00000000000000171ede64904551eeDF3C6C9788" as const;
// OutputSettlerSimple, 2026-08-04 EVM deployment. CREATE2 from
// 0x4e59b44847b379578588920cA78FbF26c0B4956C, so the address is identical on
// every mainnet chain (verified on ethereum, base, arbitrum).
export const COIN_FILLER =
  "0x75220B7600c300005038432a0000f308e0000068" as const;

export const INPUT_SETTLER_COMPACT_LIFI =
  "0x0000000000cd5f7fDEc90a03a31F79E5Fbc6A9Cf" as const;
// InputSettlerEscrowLIFI, same 2026-08-04 deployment as COIN_FILLER above.
export const INPUT_SETTLER_ESCROW_LIFI =
  "0x00fC00edbe7C003b006f870068c548940000223e" as const;
export const MULTICHAIN_INPUT_SETTLER_ESCROW =
  "0xb912b4c38ab54b94D45Ac001484dEBcbb519Bc2B" as const;
export const MULTICHAIN_INPUT_SETTLER_COMPACT =
  "0x1fccC0807F25A58eB531a0B5b4bf3dCE88808Ed7" as const;

// Solana config

export const SOLANA_MAINNET_CHAIN_ID = 1151111081099710n;
export const SOLANA_TESTNET_CHAIN_ID = 1151111081099711n;
export const SOLANA_DEVNET_CHAIN_ID = 1151111081099712n;

// Do NOT use these constants directly — always go through
// `inputSettlerForSolana(chainId)` which throws for undeployed networks.
export const SOLANA_MAINNET_INPUT_SETTLER_ESCROW =
  "0x0cb3931fa2bfb2296eb48e6f431df4ab41dc084c068b39f7e1f125604252611c" as const;
const SOLANA_TESTNET_INPUT_SETTLER_ESCROW = undefined;
export const SOLANA_DEVNET_INPUT_SETTLER_ESCROW =
  "0x0cb3931fa2bfb2296eb48e6f431df4ab41dc084c068b39f7e1f125604252611c" as const;

export const SOLANA_INPUT_SETTLER_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_INPUT_SETTLER_ESCROW,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_INPUT_SETTLER_ESCROW,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
};

// Do NOT use these constants directly — always go through
// `SOLANA_OUTPUT_SETTLER_PDAS[chainId]` which is guarded in buildMandateOutputs.
// Mainnet output settler program: 0x142f560983db838c0e95fcc4f345050ce9888822c45c34e6b75efffeb5e0a961
export const SOLANA_MAINNET_OUTPUT_SETTLER_PDA =
  "0x57e93c230b75ab3ad76e89157ae3ce486fbe4ae4c4ac120882ccf2fdfb88a8bf" as const;
const SOLANA_TESTNET_OUTPUT_SETTLER_PDA = undefined;
export const SOLANA_DEVNET_OUTPUT_SETTLER_PDA =
  "0x57e93c230b75ab3ad76e89157ae3ce486fbe4ae4c4ac120882ccf2fdfb88a8bf" as const;

export const SOLANA_OUTPUT_SETTLER_PDAS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_OUTPUT_SETTLER_PDA,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_OUTPUT_SETTLER_PDA,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_OUTPUT_SETTLER_PDA,
};

// Tron config

export const TRON_MAINNET_CHAIN_ID = 728126428n;

// Canonical Tron mainnet deployment (lifi-oif deployments/tron.json).
// Do NOT use these constants directly — always go through
// `inputSettlerForTron(chainId)` / `outputSettlerForTron(chainId)`,
// which throw for undeployed networks.
// InputSettlerEscrowLIFITron: TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCNq
export const TRON_MAINNET_INPUT_SETTLER =
  "0xaa2e58aa1a4107dc8cc7ef41b97be90b25b5b842" as const;
// OutputSettlerSimple: TLwJhhq7fExHWdJQfMnsSY7VcreipmhLRm
export const TRON_MAINNET_OUTPUT_SETTLER =
  "0x784d4f7b6e99b22d923ec99edbe2e11b38ceac93" as const;
// PolymerOracleMapped: TPXQkHcGwEdH4Ss8kT4cDxgXt3L4n4zSHJ
export const TRON_MAINNET_POLYMER_ORACLE =
  "0x94b0c01e26aff5a6a0fd767afe0e3ca0f8b34e3d" as const;

// Pre-2026-08 deployment, superseded by the canonical addresses above (its
// `open` is nonpayable — no native TRX inputs). Kept so consumers can keep
// reading and finalising orders opened against it; never used by builders.
// TXmVLCXzrhzmeCfchDPTmFF6Qe7rg3H7Kk
export const TRON_MAINNET_LEGACY_INPUT_SETTLER =
  "0xef1b684567bfcbabb19d01a84bc3f218081b1536" as const;
// THWDD3umarircbqo8jXxVazbpJnE25VjhN
export const TRON_MAINNET_LEGACY_OUTPUT_SETTLER =
  "0x52a5f2a94125ef11673f86104e2ce3f86ece2c25" as const;
// TCeNWukZUoTSrgWZEMpn9X8C5NtV8Rsy6c
export const TRON_MAINNET_LEGACY_POLYMER_ORACLE =
  "0x1d586aa1bd8ea3fda890057bad5a7d373886dbc1" as const;

export const TRON_INPUT_SETTLER_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: TRON_MAINNET_INPUT_SETTLER,
};

export const TRON_OUTPUT_SETTLERS: Record<string, `0x${string}` | undefined> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: TRON_MAINNET_OUTPUT_SETTLER,
};

export const TRON_POLYMER_ORACLES: Record<string, `0x${string}` | undefined> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: TRON_MAINNET_POLYMER_ORACLE,
};

export const TRON_LEGACY_INPUT_SETTLERS: Record<
  string,
  readonly `0x${string}`[] | undefined
> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: [TRON_MAINNET_LEGACY_INPUT_SETTLER],
};

export const TRON_LEGACY_OUTPUT_SETTLERS: Record<
  string,
  readonly `0x${string}`[] | undefined
> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: [TRON_MAINNET_LEGACY_OUTPUT_SETTLER],
};

export const TRON_LEGACY_POLYMER_ORACLES: Record<
  string,
  readonly `0x${string}`[] | undefined
> = {
  [TRON_MAINNET_CHAIN_ID.toString()]: [TRON_MAINNET_LEGACY_POLYMER_ORACLE],
};
