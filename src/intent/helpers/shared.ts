import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  SOLANA_INPUT_SETTLER_ESCROW_PROGRAMS,
  SOLANA_INPUT_SETTLER_PROGRAMS,
  SOLANA_OUTPUT_SETTLER_PDAS,
  SOLANA_POLYMER_ORACLE_PROGRAMS,
  SOLANA_POLYMER_ORACLES,
  TRON_INPUT_SETTLER_PROGRAMS,
  TRON_OUTPUT_SETTLERS,
} from "../../constants";
import type { CompactLock, EscrowLock } from "../../types";

export const ONE_MINUTE = 60;
export const ONE_HOUR = 60 * ONE_MINUTE;
export const ONE_DAY = 24 * ONE_HOUR;

export function selectAllBut<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1, arr.length)];
}

/** Returns the input settler escrow **PDA** for the given Solana chain ID. Throws for undeployed networks (testnet). */
export function inputSettlerForSolana(chainId: bigint): `0x${string}` {
  const settler = SOLANA_INPUT_SETTLER_PROGRAMS[chainId.toString()];
  if (!settler) throw new Error(`Unsupported Solana chain id: ${chainId}`);
  return settler;
}

/** Returns the input settler escrow **program id** (for building instructions) for the given Solana chain ID. Throws for undeployed networks. */
export function inputSettlerProgramForSolana(chainId: bigint): `0x${string}` {
  const program = SOLANA_INPUT_SETTLER_ESCROW_PROGRAMS[chainId.toString()];
  if (!program) throw new Error(`Unsupported Solana chain id: ${chainId}`);
  return program;
}

/** Returns the output settler **PDA** for the given Solana chain ID — the value `MandateOutput.settler` must hold. Throws for undeployed networks. */
export function outputSettlerForSolana(chainId: bigint): `0x${string}` {
  const settler = SOLANA_OUTPUT_SETTLER_PDAS[chainId.toString()];
  if (!settler) throw new Error(`Unsupported Solana chain id: ${chainId}`);
  return settler;
}

/**
 * Returns the Polymer oracle **PDA** for the given Solana chain ID — the value
 * `StandardSolana.inputOracle` must hold when Solana is the INPUT chain.
 *
 * Not interchangeable with {@link polymerOracleProgramForSolana}.
 */
export function polymerOracleForSolana(chainId: bigint): `0x${string}` {
  const oracle = SOLANA_POLYMER_ORACLES[chainId.toString()];
  if (!oracle) throw new Error(`Unsupported Solana chain id: ${chainId}`);
  return oracle;
}

/**
 * Returns the Polymer **program id** for the given Solana chain ID — the value
 * `MandateOutput.oracle` must hold when Solana is the OUTPUT chain.
 *
 * `oracle_polymer::submit` compares the fill's LocalAttestation consumer
 * against its own program id, so a PDA here makes the fill unprovable.
 */
export function polymerOracleProgramForSolana(chainId: bigint): `0x${string}` {
  const oracle = SOLANA_POLYMER_ORACLE_PROGRAMS[chainId.toString()];
  if (!oracle) throw new Error(`Unsupported Solana chain id: ${chainId}`);
  return oracle;
}

export function inputSettlerForTron(chainId: bigint): `0x${string}` {
  const settler = TRON_INPUT_SETTLER_PROGRAMS[chainId.toString()];
  if (!settler) throw new Error(`Unsupported Tron chain id: ${chainId}`);
  return settler;
}

/** Returns the deployed output settler address for the given Tron chain ID. Throws for undeployed networks. */
export function outputSettlerForTron(chainId: bigint): `0x${string}` {
  const settler = TRON_OUTPUT_SETTLERS[chainId.toString()];
  if (!settler) throw new Error(`Unsupported Tron chain id: ${chainId}`);
  return settler;
}

export function inputSettlerForLock(
  lock: EscrowLock | CompactLock,
  multichain: boolean,
) {
  if (lock.type === "compact" && multichain === false)
    return INPUT_SETTLER_COMPACT_LIFI;
  if (lock.type === "compact" && multichain === true)
    return MULTICHAIN_INPUT_SETTLER_COMPACT;
  if (lock.type === "escrow" && multichain === false)
    return INPUT_SETTLER_ESCROW_LIFI;
  if (lock.type === "escrow" && multichain === true)
    return MULTICHAIN_INPUT_SETTLER_ESCROW;

  throw new Error(
    `Not supported | multichain: ${multichain}, type: ${lock.type}`,
  );
}
