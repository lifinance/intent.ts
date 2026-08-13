import {
  COIN_FILLER,
  SOLANA_OUTPUT_SETTLER_PDA,
  SOLANA_POLYMER_ORACLE_PROGRAM,
} from "../src/constants";
import { addressToBytes32 } from "../src/helpers/convert";
import type {
  MandateOutput,
  MultichainOrder,
  StandardEVM,
  StandardSolana,
} from "../src/types";

export const CHAIN_ID_ETHEREUM = 1n;
export const CHAIN_ID_ARBITRUM = 42161n;
export const CHAIN_ID_BASE = 8453n;

export const TEST_POLYMER_ORACLE =
  "0x0000003E06000007A224AeE90052fA6bb46d43C9" as const;

export const TEST_USER = "0x1111111111111111111111111111111111111111" as const;
export const TEST_NOW_SECONDS = 1_700_000_000;

export const b32 = (nibble: string) =>
  `0x${nibble.repeat(64)}` as `0x${string}`;

export function makeMandateOutput(
  chainId: bigint = CHAIN_ID_ARBITRUM,
  amount: bigint = 1n,
  overrides: Partial<MandateOutput> = {},
): MandateOutput {
  return {
    oracle: addressToBytes32(COIN_FILLER),
    settler: addressToBytes32(COIN_FILLER),
    chainId,
    token: b32("3"),
    amount,
    recipient: b32("4"),
    callbackData: "0x",
    context: "0x",
    ...overrides,
  };
}

export function makeStandardEvm(
  overrides: Partial<StandardEVM> = {},
): StandardEVM {
  return {
    user: TEST_USER,
    nonce: 1n,
    originChainId: CHAIN_ID_ETHEREUM,
    expires: TEST_NOW_SECONDS + 1000,
    fillDeadline: TEST_NOW_SECONDS + 900,
    inputOracle: TEST_POLYMER_ORACLE,
    inputs: [[1n, 1n]],
    outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM)],
    ...overrides,
  };
}

export const CHAIN_ID_SOLANA_DEVNET = 1151111081099712n;
export const CHAIN_ID_SOLANA_MAINNET = 1151111081099710n;

export function makeStandardSolana(
  overrides: Partial<StandardSolana> = {},
): StandardSolana {
  return {
    user: TEST_USER,
    nonce: 1n,
    originChainId: CHAIN_ID_SOLANA_DEVNET,
    expires: TEST_NOW_SECONDS + 1000,
    fillDeadline: TEST_NOW_SECONDS + 900,
    // Deliberately an EVM-shaped oracle so the golden encoding vectors in
    // src/intent/solana/standard.solana.spec.ts stay stable. A real Solana
    // input order carries the Polymer oracle PDA (SOLANA_POLYMER_ORACLE_PDA);
    // the specs that care pass it explicitly.
    inputOracle: TEST_POLYMER_ORACLE,
    inputs: [[BigInt(b32("a")), 1_000_000n]],
    outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM)],
    ...overrides,
  };
}

/**
 * A MandateOutput on a Solana chain, with the two values that are easy to get
 * backwards already correct: `oracle` is the Polymer PROGRAM ID, `settler` is
 * the output settler PDA.
 */
export function makeSolanaMandateOutput(
  chainId = CHAIN_ID_SOLANA_DEVNET,
  amount = 1n,
  overrides: Partial<MandateOutput> = {},
): MandateOutput {
  return {
    ...makeMandateOutput(chainId, amount),
    oracle: SOLANA_POLYMER_ORACLE_PROGRAM,
    settler: SOLANA_OUTPUT_SETTLER_PDA,
    ...overrides,
  };
}

export const CHAIN_ID_TRON_MAINNET = 728126428n;

export function makeStandardTron(
  overrides: Partial<StandardEVM> = {},
): StandardEVM {
  return {
    user: TEST_USER,
    nonce: 1n,
    originChainId: CHAIN_ID_TRON_MAINNET,
    expires: TEST_NOW_SECONDS + 1000,
    fillDeadline: TEST_NOW_SECONDS + 900,
    inputOracle: TEST_POLYMER_ORACLE,
    inputs: [[1n, 1_000_000n]],
    outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM)],
    ...overrides,
  };
}

export function makeMultichainOrder(
  overrides: Partial<MultichainOrder> = {},
): MultichainOrder {
  return {
    user: TEST_USER,
    nonce: 2n,
    expires: TEST_NOW_SECONDS + 1000,
    fillDeadline: TEST_NOW_SECONDS + 900,
    inputOracle: TEST_POLYMER_ORACLE,
    outputs: [makeMandateOutput(CHAIN_ID_BASE, 2n)],
    inputs: [
      { chainId: CHAIN_ID_ETHEREUM, inputs: [[1n, 1n]] },
      { chainId: CHAIN_ID_ARBITRUM, inputs: [[2n, 2n]] },
    ],
    ...overrides,
  };
}
