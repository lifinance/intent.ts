import type { CoreVerifier } from "../deps";
import type { CompactLock, EscrowLock } from "./lock";
import type { TokenContext } from "./token";

type CreateIntentOptionsBase = {
  exclusiveFor?: `0x${string}`;
  inputTokens: TokenContext[];
  outputTokens: TokenContext[];
  verifier: CoreVerifier;
  /** The wallet address submitting the intent. Used as the default output recipient. */
  account: `0x${string}`;
  /**
   * Override the address that receives output tokens on the destination chain.
   * Defaults to `account` when omitted.
   * For Solana outputs this must be the recipient's Solana public key encoded
   * as a bytes32 hex string via `solanaAddressToBytes32`.
   */
  outputRecipient?: `0x${string}`;
  /**
   * Override the order expiry, in seconds from creation time.
   * Defaults to 48 hours. Should be greater than or equal to `fillDeadline`.
   */
  expiry?: number;
  /**
   * Override the fill deadline, in seconds from creation time.
   * Defaults to 44 hours. Should be less than or equal to `expiry`.
   */
  fillDeadline?: number;
};

export type CreateIntentOptionsEscrow = CreateIntentOptionsBase & {
  lock: EscrowLock;
};

export type CreateIntentOptionsCompact = CreateIntentOptionsBase & {
  lock: CompactLock;
};

export type CreateIntentOptions =
  | CreateIntentOptionsEscrow
  | CreateIntentOptionsCompact;
