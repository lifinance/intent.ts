import type { MandateOutput } from "./mandate";
import type { NoSignature, Signature } from "./signature";

export type EVMOrder = {
  user: `0x${string}`;
  nonce: bigint;
  originChainId: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [bigint, bigint][];
  outputs: MandateOutput[];
};

export type SolanaOrder = {
  user: `0x${string}`;
  nonce: bigint;
  originChainId: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [[bigint, bigint]];
  outputs: MandateOutput[];
};

/**
 * Order escrowed by the intent-soroban InputEscrow. `user` is the 32-byte
 * ed25519 key of a Stellar account (`G…`); `inputOracle` and each input token
 * are raw 32-byte contract ids (`C…`), tokens carried as uint like EVM ids.
 */
export type StellarOrder = {
  user: `0x${string}`;
  nonce: bigint;
  originChainId: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [bigint, bigint][];
  outputs: MandateOutput[];
};

export type StandardOrder = SolanaOrder | EVMOrder | StellarOrder;

export type StandardEVM = EVMOrder;
export type StandardSolana = SolanaOrder;
export type StandardStellar = StellarOrder;

export type MultichainOrderComponent = {
  user: `0x${string}`;
  nonce: bigint;
  chainIdField: bigint;
  chainIndex: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [bigint, bigint][];
  outputs: MandateOutput[];
  additionalChains: `0x${string}`[];
};

export type MultichainOrder = {
  user: `0x${string}`;
  nonce: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  outputs: MandateOutput[];
  inputs: { chainId: bigint; inputs: [bigint, bigint][] }[];
};

export type OrderContainer = {
  inputSettler: `0x${string}`;
  order: StandardOrder | MultichainOrder;
  sponsorSignature: Signature | NoSignature;
  allocatorSignature: Signature | NoSignature;
};
