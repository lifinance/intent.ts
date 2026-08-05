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
   * Return all oracle addresses that are valid in `output.oracle` for the
   * given output. For Polymer cross-chain orders, `output.oracle` is the
   * INPUT chain's oracle address (not the output chain's) — implementations
   * should correlate against `inputChainId`/`inputOracle` rather than
   * returning a union of every chain's oracle. For same-chain fills the
   * oracle is the output chain's own settler — return it explicitly
   * (`COIN_FILLER` for EVM chains); nothing is accepted implicitly.
   */
  allowedOutputOracles: (
    args: Readonly<{
      inputChainId: bigint;
      inputOracle: `0x${string}`;
      outputChainId: bigint;
      sameChainFill: boolean;
    }>,
  ) => readonly `0x${string}`[] | undefined;
  /**
   * Return the output settler addresses valid on that specific chain.
   * Returning a settler for the wrong chain or namespace (e.g. the Tron
   * settler on an EVM chain) is a funds-safety bug in the consumer: solvers
   * grant token approvals to whatever address passes this check.
   */
  allowedOutputSettlers: (chainId: bigint) => readonly `0x${string}`[];
  /**
   * Whether outputs with a zero token (the contracts' encoding for the
   * chain's native asset) are supported on the given chain. Defaults to
   * rejecting native outputs when omitted.
   */
  supportsNativeOutput?: (chainId: bigint) => boolean;
};

export type OrderContainerValidationDeps = StandardOrderValidationDeps & {
  inputSettlers: readonly `0x${string}`[];
};

export type OrderValidationDeps = OrderContainerValidationDeps;
