export type Namespace = "eip155" | "solana";

export type CoreToken = {
  address: `0x${string}`;
  name: string;
  chainId: bigint;
  decimals: number;
  // CAIP namespace
  chainNamespace: Namespace;
};

export type TokenContext = {
  token: CoreToken;
  amount: bigint;
};
