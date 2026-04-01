export type CoreToken = {
  address: `0x${string}`;
  name: string;
  chainId: bigint;
  decimals: number;
  // CAIP namespace
  chain: "eip155" | "solana";
};

export type TokenContext = {
  token: CoreToken;
  amount: bigint;
};
