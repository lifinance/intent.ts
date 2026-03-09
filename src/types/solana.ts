import type { CoreVerifier } from "../deps";
import type { MandateOutput } from "./mandate";
import type { TokenContext } from "./token";

export type SolanaStandardOrder = {
  user: `0x${string}`;        // solana pubkey as bytes32
  nonce: bigint;
  originChainId: bigint;      // Solana chain ID (e.g. 1151111081099712 for devnet)
  expires: number;
  fillDeadline: number;
  inputOracle: `0x${string}`; // Solana oracle PDA as bytes32
  input: {
    token: `0x${string}`;     // SPL mint as bytes32
    amount: bigint;
  };
  outputs: MandateOutput[];
};

export type CreateSolanaIntentOptions = {
  account: `0x${string}`;      // solana pubkey as bytes32
  inputToken: TokenContext;     // single SPL token input
  outputTokens: TokenContext[];
  verifier: CoreVerifier;
  exclusiveFor?: `0x${string}`;
  outputRecipient?: `0x${string}`; // EVM recipient (defaults to user bytes32)
};
