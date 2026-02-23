import type { CoreVerifier } from "../deps";
import type { CompactLock, EscrowLock } from "./lock";
import type { TokenContext } from "./token";

type CreateIntentOptionsBase = {
  exclusiveFor: `0x${string}`;
  inputTokens: TokenContext[];
  outputTokens: TokenContext[];
  verifier: CoreVerifier;
  account: `0x${string}`;
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
