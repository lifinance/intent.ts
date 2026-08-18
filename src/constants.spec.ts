import { describe, expect, it } from "bun:test";
import { concat, hexToBytes, sha256, stringToBytes } from "viem";
import {
  SOLANA_CHAIN_ID_PDA,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_INPUT_SETTLER_ESCROW_PDA,
  SOLANA_INPUT_SETTLER_ESCROW_PROGRAM,
  SOLANA_INPUT_SETTLER_PROGRAMS,
  SOLANA_INTENTS_PROTOCOL_PROGRAM,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_OUTPUT_SETTLER_PDA,
  SOLANA_OUTPUT_SETTLER_PDAS,
  SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM,
  SOLANA_POLYMER_ORACLE_PDA,
  SOLANA_POLYMER_ORACLE_PROGRAM,
  SOLANA_POLYMER_ORACLE_PROGRAMS,
  SOLANA_POLYMER_ORACLES,
  SOLANA_TESTNET_CHAIN_ID,
} from "./constants";
import { bytes32ToSolanaBase58 } from "./helpers/solana";
import {
  ADDRESS_ZERO,
  BYTES32_ZERO,
  COMPACT,
  COIN_FILLER,
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  TRON_MAINNET_CHAIN_ID,
  TRON_MAINNET_INPUT_SETTLER,
  TRON_MAINNET_LEGACY_INPUT_SETTLER,
  TRON_MAINNET_LEGACY_OUTPUT_SETTLER,
  TRON_MAINNET_OUTPUT_SETTLER,
  TRON_MAINNET_POLYMER_ORACLE,
  TRON_INPUT_SETTLER_PROGRAMS,
  TRON_OUTPUT_SETTLERS,
  TRON_POLYMER_ORACLES,
  TRON_LEGACY_INPUT_SETTLERS,
  TRON_LEGACY_OUTPUT_SETTLERS,
} from "./constants";
import { hexToTronBase58 } from "./helpers/tron";

describe("constants", () => {
  it("exports canonical zero constants", () => {
    expect(ADDRESS_ZERO).toBe("0x0000000000000000000000000000000000000000");
    expect(BYTES32_ZERO).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("exports address-like constants", () => {
    const addresses = [
      COMPACT,
      COIN_FILLER,
      INPUT_SETTLER_COMPACT_LIFI,
      INPUT_SETTLER_ESCROW_LIFI,
      MULTICHAIN_INPUT_SETTLER_ESCROW,
      MULTICHAIN_INPUT_SETTLER_COMPACT,
    ];
    for (const address of addresses) {
      expect(address.startsWith("0x")).toBe(true);
      expect(address).toHaveLength(42);
    }
  });

  it("evm constants point at the 2026-08-04 deployment, not the superseded one", () => {
    // Verified on-chain: both are CREATE2 deployments from
    // 0x4e59b44847b379578588920cA78FbF26c0B4956C, verified on ethereum as
    // OutputSettlerSimple and InputSettlerEscrowLIFI respectively.
    expect(COIN_FILLER).toBe("0x75220B7600c300005038432a0000f308e0000068");
    expect(INPUT_SETTLER_ESCROW_LIFI).toBe(
      "0x00fC00edbe7C003b006f870068c548940000223e",
    );
    // Must not regress to the superseded pre-2026-08 deployment.
    expect(COIN_FILLER).not.toBe("0x0000000000eC36B683C2E6AC89e9A75989C22a2e");
    expect(INPUT_SETTLER_ESCROW_LIFI).not.toBe(
      "0x000025c3226C00B2Cdc200005a1600509f4e00C0",
    );
  });

  it("tron constants match the canonical deployment (checksum-proving base58 round trip)", () => {
    // lifi-oif deployments/tron.json — hexToTronBase58 recomputes the
    // Base58Check checksum, so these assertions prove the hex constants.
    expect(hexToTronBase58(TRON_MAINNET_INPUT_SETTLER)).toBe(
      "TRV3PsTLRiWpY6sWi5UAvB7Tacb2FLtCNq",
    );
    expect(hexToTronBase58(TRON_MAINNET_OUTPUT_SETTLER)).toBe(
      "TLwJhhq7fExHWdJQfMnsSY7VcreipmhLRm",
    );
    expect(hexToTronBase58(TRON_MAINNET_POLYMER_ORACLE)).toBe(
      "TPXQkHcGwEdH4Ss8kT4cDxgXt3L4n4zSHJ",
    );
    expect(hexToTronBase58(TRON_MAINNET_LEGACY_INPUT_SETTLER)).toBe(
      "TXmVLCXzrhzmeCfchDPTmFF6Qe7rg3H7Kk",
    );
    expect(hexToTronBase58(TRON_MAINNET_LEGACY_OUTPUT_SETTLER)).toBe(
      "THWDD3umarircbqo8jXxVazbpJnE25VjhN",
    );
  });

  it("tron registries are keyed by the tron chain id", () => {
    const key = TRON_MAINNET_CHAIN_ID.toString();
    expect(TRON_INPUT_SETTLER_PROGRAMS[key]).toBe(TRON_MAINNET_INPUT_SETTLER);
    expect(TRON_OUTPUT_SETTLERS[key]).toBe(TRON_MAINNET_OUTPUT_SETTLER);
    expect(TRON_POLYMER_ORACLES[key]).toBe(TRON_MAINNET_POLYMER_ORACLE);
    expect(TRON_LEGACY_INPUT_SETTLERS[key]).toEqual([
      TRON_MAINNET_LEGACY_INPUT_SETTLER,
    ]);
    expect(TRON_LEGACY_OUTPUT_SETTLERS[key]).toEqual([
      TRON_MAINNET_LEGACY_OUTPUT_SETTLER,
    ]);
    // Canonical and legacy must never alias each other.
    expect(TRON_MAINNET_INPUT_SETTLER).not.toBe(
      TRON_MAINNET_LEGACY_INPUT_SETTLER,
    );
    expect(TRON_MAINNET_OUTPUT_SETTLER).not.toBe(
      TRON_MAINNET_LEGACY_OUTPUT_SETTLER,
    );
  });
});

describe("solana constants", () => {
  it("match the canonical deployment (base58 round trip)", () => {
    // catalyst-intent-svm Anchor.toml [programs.mainnet]/[programs.devnet].
    expect(bytes32ToSolanaBase58(SOLANA_INTENTS_PROTOCOL_PROGRAM)).toBe(
      "LiFixdGLT5CMdLsHBvaijTXpPy4Uux9Y53SXkuR4HaK",
    );
    expect(bytes32ToSolanaBase58(SOLANA_INPUT_SETTLER_ESCROW_PROGRAM)).toBe(
      "LiFiRp8RM7nJUZyUYC9FPPpDr7sAy5XPfBN6ABzBgT7",
    );
    expect(bytes32ToSolanaBase58(SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM)).toBe(
      "LiFiEDFjz5x1jJe9gSXNDHQW4dWt4yLXdp2VN4EiQUt",
    );
    expect(bytes32ToSolanaBase58(SOLANA_POLYMER_ORACLE_PROGRAM)).toBe(
      "LiFiBtfyPT1DnTHTAeZ2rwr5RgMrThwA5kt7KGT5nBV",
    );
    expect(bytes32ToSolanaBase58(SOLANA_CHAIN_ID_PDA)).toBe(
      "BkEw3WHFvJR9a5deUcwPLJ79yK3r9YGdQ61TehFXzAQ",
    );
    expect(bytes32ToSolanaBase58(SOLANA_INPUT_SETTLER_ESCROW_PDA)).toBe(
      "Cj3mSoPJtgi5bubC9rLz8oM1DuXoJj97RMw1uC6ev9zm",
    );
    expect(bytes32ToSolanaBase58(SOLANA_OUTPUT_SETTLER_PDA)).toBe(
      "DHShHmVkTwCzUzAQbCu4GDqJmursuDscNR6o4hTBgeRy",
    );
    expect(bytes32ToSolanaBase58(SOLANA_POLYMER_ORACLE_PDA)).toBe(
      "49zLKETMq34CUC2E2wL1xvv6uN2AUgyhjVX221mjE3Rw",
    );
  });

  it("derives every PDA from its program id, seed and canonical bump", () => {
    // create_program_address = sha256(seed ‖ bump ‖ programId ‖ marker), with
    // the result required to be off the ed25519 curve. The bumps below are the
    // canonical (highest valid) bumps, found once with findProgramAddressSync
    // and pinned here — so this proves the PDA↔(program, seed, bump) relation
    // without pulling in an ed25519 implementation just to re-search for them.
    const PDA_MARKER = stringToBytes("ProgramDerivedAddress");
    const createProgramAddress = (
      seed: string,
      programId: `0x${string}`,
      bump: number,
    ) =>
      sha256(
        concat([
          stringToBytes(seed),
          new Uint8Array([bump]),
          hexToBytes(programId),
          PDA_MARKER,
        ]),
      );

    expect(
      createProgramAddress("chain_id", SOLANA_INTENTS_PROTOCOL_PROGRAM, 255),
    ).toBe(SOLANA_CHAIN_ID_PDA);
    expect(
      createProgramAddress(
        "input_settler_escrow",
        SOLANA_INPUT_SETTLER_ESCROW_PROGRAM,
        253,
      ),
    ).toBe(SOLANA_INPUT_SETTLER_ESCROW_PDA);
    expect(
      createProgramAddress(
        "output_settler_simple",
        SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM,
        255,
      ),
    ).toBe(SOLANA_OUTPUT_SETTLER_PDA);
    expect(
      createProgramAddress("polymer", SOLANA_POLYMER_ORACLE_PROGRAM, 253),
    ).toBe(SOLANA_POLYMER_ORACLE_PDA);
  });

  it("must not regress to the pre-vanity-key deployment", () => {
    // catalyst-intent-svm 21fc982 rotated every program id to the LiFi vanity
    // keys. The values below are the PDAs under the OLD program ids
    // (input_settler_escrow Amx9xngT…, output_settler_simple ELEtkk6a…).
    // They are correctly-shaped and correctly-derived, which is exactly why
    // they went unnoticed — an order carrying them can never be filled.
    expect(SOLANA_INPUT_SETTLER_ESCROW_PDA).not.toBe(
      "0x0cb3931fa2bfb2296eb48e6f431df4ab41dc084c068b39f7e1f125604252611c",
    );
    expect(SOLANA_OUTPUT_SETTLER_PDA).not.toBe(
      "0x57e93c230b75ab3ad76e89157ae3ce486fbe4ae4c4ac120882ccf2fdfb88a8bf",
    );
    expect(SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM).not.toBe(
      "0x142f560983db838c0e95fcc4f345050ce9888822c45c34e6b75efffeb5e0a961",
    );
  });

  it("keeps program ids and state PDAs distinct", () => {
    // The two failure modes this guards: putting the Polymer PDA in
    // MandateOutput.oracle (submit rejects the fill's attestation), and
    // putting the Polymer program id in StandardSolana.inputOracle (finalise
    // cannot find the attestation).
    expect(SOLANA_POLYMER_ORACLE_PROGRAM).not.toBe(SOLANA_POLYMER_ORACLE_PDA);
    expect(SOLANA_OUTPUT_SETTLER_SIMPLE_PROGRAM).not.toBe(
      SOLANA_OUTPUT_SETTLER_PDA,
    );
    expect(SOLANA_INPUT_SETTLER_ESCROW_PROGRAM).not.toBe(
      SOLANA_INPUT_SETTLER_ESCROW_PDA,
    );
  });

  it("registries are keyed by chain id, with testnet undeployed", () => {
    const mainnet = SOLANA_MAINNET_CHAIN_ID.toString();
    const devnet = SOLANA_DEVNET_CHAIN_ID.toString();
    const testnet = SOLANA_TESTNET_CHAIN_ID.toString();

    expect(SOLANA_INPUT_SETTLER_PROGRAMS[mainnet]).toBe(
      SOLANA_INPUT_SETTLER_ESCROW_PDA,
    );
    expect(SOLANA_OUTPUT_SETTLER_PDAS[mainnet]).toBe(SOLANA_OUTPUT_SETTLER_PDA);
    expect(SOLANA_POLYMER_ORACLES[mainnet]).toBe(SOLANA_POLYMER_ORACLE_PDA);
    expect(SOLANA_POLYMER_ORACLE_PROGRAMS[mainnet]).toBe(
      SOLANA_POLYMER_ORACLE_PROGRAM,
    );

    for (const registry of [
      SOLANA_INPUT_SETTLER_PROGRAMS,
      SOLANA_OUTPUT_SETTLER_PDAS,
      SOLANA_POLYMER_ORACLES,
      SOLANA_POLYMER_ORACLE_PROGRAMS,
    ]) {
      // Mainnet and devnet share one deployment (Anchor.toml), so equality
      // here is by construction — assert it so a future divergence is loud.
      expect(registry[devnet]).toBe(registry[mainnet]);
      expect(registry[testnet]).toBeUndefined();
    }
  });
});
