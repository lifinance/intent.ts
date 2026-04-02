import type { MandateOutput } from "./mandate";
import type { NoSignature, Signature } from "./signature";

export type StandardEVM = {
  user: `0x${string}`;
  nonce: bigint;
  originChainId: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [bigint, bigint][];
  outputs: MandateOutput[];
};

export type StandardSolana = {
  user: `0x${string}`;
  nonce: bigint;
  originChainId: bigint;
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`;
  inputs: [[bigint, bigint]];
  outputs: MandateOutput[];
};

export type StandardOrder = StandardEVM | StandardSolana;

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
