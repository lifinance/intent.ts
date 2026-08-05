import { describe, expect, it } from "bun:test";
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
