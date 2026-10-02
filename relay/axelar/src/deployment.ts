import { PublicKey } from "@solana/web3.js";
import {
  AXELAR_ORACLE_PROGRAM,
  axelarConfigAddress,
  axelarInitializeInstruction,
  axelarSetChainMappingInstruction,
  type AxelarInstruction,
} from "../../../src/axelar/index";

/** Untrusted JSON route entry; numeric chain IDs are rejected unless safe integers. */
export type ChainRoute = {
  name: string;
  chainId: string | number;
  kind: string;
};
export type DeploymentManifest = {
  platform: string;
  oracle: string;
  gateway: string;
  gasService: string;
  chainId: string | number;
  chainName: string;
  rpcUrl: string;
  routes: ChainRoute[];
};
export type Deployment = {
  program: string;
  inputOracle: string;
  outputOracle: string;
  owner: string;
  initialize: AxelarInstruction;
  mappings: AxelarInstruction[];
  finalization: string[];
};

// Axelar ChainNameRaw: at most 20 bytes. Mappings use the lowercase form.
const CHAIN_NAME = /^[a-z0-9-]{1,20}$/;

function uint128(value: string | number): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Use decimal strings for large chain IDs");
  if (!/^[0-9]+$/.test(String(value)))
    throw new Error("Expected decimal chain ID");
  const n = BigInt(value);
  if (n <= 0n || n >= 1n << 128n)
    throw new Error("Chain ID must fit nonzero u128");
  return n;
}

// Owner-only, set-once mapping instruction. Existing names and chain IDs cannot be remapped.
export function chainMapping(
  route: ChainRoute,
  owner: string,
): AxelarInstruction {
  new PublicKey(owner);
  if (
    typeof route.name !== "string" ||
    !CHAIN_NAME.test(route.name) ||
    (route.kind !== "evm" && route.kind !== "stellar")
  )
    throw new Error("Invalid Axelar chain mapping");
  return axelarSetChainMappingInstruction({
    owner,
    name: route.name,
    chainId: uint128(route.chainId),
    kind: route.kind,
  });
}

export function deployment(
  manifest: DeploymentManifest,
  payer: string,
): Deployment {
  const m = structuredClone(manifest);
  if (m.platform !== "solana" || m.oracle !== AXELAR_ORACLE_PROGRAM)
    throw new Error("Manifest must use the compiled Axelar program ID");
  new PublicKey(m.gateway);
  new PublicKey(m.gasService);
  new PublicKey(payer);
  if (typeof m.chainName !== "string" || !CHAIN_NAME.test(m.chainName))
    throw new Error("Invalid local chain name");
  const local = uint128(m.chainId);
  if (!Array.isArray(m.routes)) throw new Error("Expected route list");
  const ids = new Set([local]),
    names = new Set([m.chainName]);
  for (const r of m.routes) {
    if (
      typeof r.name !== "string" ||
      !CHAIN_NAME.test(r.name) ||
      names.has(r.name) ||
      ids.has(uint128(r.chainId))
    )
      throw new Error("Invalid or duplicate route");
    ids.add(uint128(r.chainId));
    names.add(r.name);
  }
  return {
    program: AXELAR_ORACLE_PROGRAM,
    inputOracle: axelarConfigAddress(),
    outputOracle: AXELAR_ORACLE_PROGRAM,
    owner: payer,
    initialize: axelarInitializeInstruction({
      payer,
      gateway: m.gateway,
      gasService: m.gasService,
      chainName: m.chainName,
    }),
    mappings: m.routes.map((r) => chainMapping(r, payer)),
    finalization: [
      "solana",
      "program",
      "set-upgrade-authority",
      AXELAR_ORACLE_PROGRAM,
      "--final",
      "--url",
      m.rpcUrl,
    ],
  };
}
