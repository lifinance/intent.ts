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

// Canonical Solana deployment. Source of truth: catalyst-intent-svm
// Anchor.toml, whose [programs.mainnet] and [programs.devnet] sections are
// IDENTICAL — the LiFi vanity program ids are deployed at the same addresses
// on both clusters. State PDAs derive from (program id, seed) alone, so they
// too are cluster-independent; only the *contents* of the ChainId PDA differ
// (1151111081099710 on mainnet, 1151111081099712 on devnet).
//
// constants.spec.ts re-derives every PDA from its program id, seed and
// canonical bump, and asserts the base58 form of every value below.
//
// IMPORTANT — a program id and its state PDA are NOT interchangeable, and
// three different values all get called "the Solana Polymer oracle":
//
//   MandateOutput.settler       -> output settler PDA
//                                  (output_settler_base/src/base.rs:122)
//   MandateOutput.oracle        -> polymer PROGRAM ID
//                                  (oracle_polymer/src/instructions/submit.rs:71)
//   StandardSolana.inputOracle  -> polymer oracle PDA
//                                  (oracle_polymer/src/instructions/receive_attest.rs:142)
//
// Getting these backwards yields an order that fills and can then never be
// proven — the tokens move before the failure surfaces.
//
// Do NOT use these constants directly — go through `inputSettlerForSolana`,
// `outputSettlerForSolana`, `polymerOracleForSolana` and
// `polymerOracleProgramForSolana`, which throw for undeployed networks.

// --- program ids (cluster-independent) --- //

// intents_protocol: LiFixdGLT5CMdLsHBvaijTXpPy4Uux9Y53SXkuR4HaK
export const SOLANA_INTENTS_PROTOCOL_PROGRAM =
  "0x050cae668656471e02181ee1e6c52ee00a779ca7c481a04fb0e2ab9085f5c304" as const;
// input_settler_escrow: LiFiRp8RM7nJUZyUYC9FPPpDr7sAy5XPfBN6ABzBgT7
export const SOLANA_INPUT_SETTLER_ESCROW_PROGRAM =
  "0x050cae5ad286a6a6227a55fd650d63a3eccc866d6c293c94b87839e5cb6dba86" as const;
// output_settler_simple: LiFiEDFjz5x1jJe9gSXNDHQW4dWt4yLXdp2VN4EiQUt
export const SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM =
  "0x050cae566a93270d66dbfe1915b80dc06e4a80178992592b3d8f51e888d0afe5" as const;
// polymer (crate oracle_polymer): LiFiBtfyPT1DnTHTAeZ2rwr5RgMrThwA5kt7KGT5nBV
export const SOLANA_POLYMER_ORACLE_PROGRAM =
  "0x050cae5588f8d907500199177ab1239f61b8557af2ffacd5defed0070b858ad4" as const;

// --- state PDAs (cluster-independent) --- //

// ChainId, seeds ["chain_id"] under intents_protocol, bump 255:
// BkEw3WHFvJR9a5deUcwPLJ79yK3r9YGdQ61TehFXzAQ
export const SOLANA_CHAIN_ID_PDA =
  "0x02c0b32f8be4a5319a95cca17bd05eba48e7195ce52f1608723b51e575457df5" as const;
// InputSettlerEscrowAccount, seeds ["input_settler_escrow"], bump 253:
// Cj3mSoPJtgi5bubC9rLz8oM1DuXoJj97RMw1uC6ev9zm
export const SOLANA_INPUT_SETTLER_ESCROW_PDA =
  "0xae3613f974fc9cd94682bbff7bd7f229697616c5b6fdb6e0c16d1f02607242ae" as const;
// OutputSettlerSimpleAccount, seeds ["output_settler_simple"], bump 255:
// DHShHmVkTwCzUzAQbCu4GDqJmursuDscNR6o4hTBgeRy
export const SOLANA_OUTPUT_SETTLER_PDA =
  "0xb68296ce230150bb20190a46eb26a198b05bec8fc7f0fa893d690cf531fa9e54" as const;
// OraclePolymer, seeds ["polymer"], bump 253:
// 49zLKETMq34CUC2E2wL1xvv6uN2AUgyhjVX221mjE3Rw
export const SOLANA_POLYMER_ORACLE_PDA =
  "0x2ee088ace4ac030d2266e50d829feeac73d1acb13e5825ef835d6f3318804796" as const;

// --- per-cluster aliases --- //
// Mainnet and devnet share one deployment (see the provenance note above), so
// these are equal by construction rather than by copy-paste. Testnet is
// undeployed.

export const SOLANA_MAINNET_INPUT_SETTLER_ESCROW =
  SOLANA_INPUT_SETTLER_ESCROW_PDA;
const SOLANA_TESTNET_INPUT_SETTLER_ESCROW = undefined;
export const SOLANA_DEVNET_INPUT_SETTLER_ESCROW =
  SOLANA_INPUT_SETTLER_ESCROW_PDA;

export const SOLANA_MAINNET_OUTPUT_SETTLER_PDA = SOLANA_OUTPUT_SETTLER_PDA;
const SOLANA_TESTNET_OUTPUT_SETTLER_PDA = undefined;
export const SOLANA_DEVNET_OUTPUT_SETTLER_PDA = SOLANA_OUTPUT_SETTLER_PDA;

// --- registries, keyed by stringified chain id --- //

// NOTE: this registry has always held the escrow *PDA*, not a program id,
// despite its name. The name is preserved because it is public API; use
// SOLANA_INPUT_SETTLER_ESCROW_PROGRAMS when you need the callable program.
export const SOLANA_INPUT_SETTLER_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_INPUT_SETTLER_ESCROW,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_INPUT_SETTLER_ESCROW,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
};

export const SOLANA_INPUT_SETTLER_ESCROW_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_INPUT_SETTLER_ESCROW_PROGRAM,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: undefined,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_INPUT_SETTLER_ESCROW_PROGRAM,
};

export const SOLANA_OUTPUT_SETTLER_PDAS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_MAINNET_OUTPUT_SETTLER_PDA,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: SOLANA_TESTNET_OUTPUT_SETTLER_PDA,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_DEVNET_OUTPUT_SETTLER_PDA,
};

export const SOLANA_OUTPUT_SETTLER_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: undefined,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM,
};

// The value `StandardSolana.inputOracle` must hold when Solana is the INPUT
// chain. Mirrors TRON_POLYMER_ORACLES in role, not in kind: Tron's single
// value plays both the input- and output-oracle role, Solana's does not.
export const SOLANA_POLYMER_ORACLES: Record<string, `0x${string}` | undefined> =
  {
    [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_POLYMER_ORACLE_PDA,
    [SOLANA_TESTNET_CHAIN_ID.toString()]: undefined,
    [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_POLYMER_ORACLE_PDA,
  };

// The value `MandateOutput.oracle` must hold when Solana is the OUTPUT chain.
// NOT the same as SOLANA_POLYMER_ORACLES above.
export const SOLANA_POLYMER_ORACLE_PROGRAMS: Record<
  string,
  `0x${string}` | undefined
> = {
  [SOLANA_MAINNET_CHAIN_ID.toString()]: SOLANA_POLYMER_ORACLE_PROGRAM,
  [SOLANA_TESTNET_CHAIN_ID.toString()]: undefined,
  [SOLANA_DEVNET_CHAIN_ID.toString()]: SOLANA_POLYMER_ORACLE_PROGRAM,
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
