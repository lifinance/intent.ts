export type CoreVerifier = "wormhole" | "polymer" | (string & {});

export type IntentDeps = {
  getOracle: (
    verifier: CoreVerifier,
    chainId: bigint,
  ) => `0x${string}` | undefined;
};

export type StandardOrderValidationDeps = {
  allowedInputOracles: (
    args: Readonly<{ chainId: bigint; sameChainFill: boolean }>,
  ) => readonly `0x${string}`[] | undefined;
  /**
   * Return all oracle addresses that are valid in `output.oracle` for a given
   * output chain. For Polymer cross-chain orders, `output.oracle` is the INPUT
   * chain's oracle address (not the output chain's), so implementations must
   * return Polymer oracle addresses from ALL supported chains.
   */
  allowedOutputOracles: (
    chainId: bigint,
  ) => readonly `0x${string}`[] | undefined;
  allowedOutputSettlers: () => readonly `0x${string}`[];
};

export type OrderContainerValidationDeps = StandardOrderValidationDeps & {
  inputSettlers: readonly `0x${string}`[];
};

export type OrderValidationDeps = OrderContainerValidationDeps;
