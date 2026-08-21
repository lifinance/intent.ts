import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  COIN_FILLER,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
  SOLANA_OUTPUT_SETTLER_PDA,
  SOLANA_POLYMER_ORACLE_PDA,
  SOLANA_POLYMER_ORACLE_PROGRAM,
  SOLANA_TESTNET_CHAIN_ID,
  TRON_MAINNET_CHAIN_ID,
  TRON_MAINNET_INPUT_SETTLER,
  TRON_MAINNET_OUTPUT_SETTLER,
} from "../constants";
import { addressToBytes32 } from "../helpers/convert";
import type { IntentDeps } from "../deps";
import {
  b32,
  CHAIN_ID_ARBITRUM,
  CHAIN_ID_BASE,
  CHAIN_ID_ETHEREUM,
  TEST_NOW_SECONDS,
  TEST_POLYMER_ORACLE,
  TEST_USER,
} from "../../tests/orderFixtures";
import type {
  CoreToken,
  CreateIntentOptionsEscrow,
  TokenContext,
} from "../types";
import { Intent } from "./create";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";

const originalDateNow = Date.now;
const originalMathRandom = Math.random;

const intentDeps: IntentDeps = {
  getOracle(verifier, chainId) {
    if (verifier !== "polymer") return undefined;
    return [CHAIN_ID_ETHEREUM, CHAIN_ID_ARBITRUM, CHAIN_ID_BASE].includes(
      chainId,
    )
      ? TEST_POLYMER_ORACLE
      : undefined;
  },
};

const ETH_USDC: CoreToken = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "usdc",
  chainId: CHAIN_ID_ETHEREUM,
  decimals: 6,
  chainNamespace: "eip155",
};

const ETH_WETH: CoreToken = {
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  name: "weth",
  chainId: CHAIN_ID_ETHEREUM,
  decimals: 18,
  chainNamespace: "eip155",
};

const ARB_USDC: CoreToken = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  name: "usdc",
  chainId: CHAIN_ID_ARBITRUM,
  decimals: 6,
  chainNamespace: "eip155",
};

const BASE_USDC: CoreToken = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  name: "usdc",
  chainId: CHAIN_ID_BASE,
  decimals: 6,
  chainNamespace: "eip155",
};

function ctx(token: CoreToken, amount: bigint): TokenContext {
  return { token, amount };
}

// The exclusive solver lives in the INPUT chain's address space (only the input
// settler pays it out), so the default fixture solver follows the first input.
const TEST_SOLANA_SOLVER =
  "0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7" as const;

function defaultExclusiveFor(
  inputTokens: TokenContext[],
): `0x${string}` | undefined {
  return inputTokens[0]?.token.chainNamespace === "solana"
    ? TEST_SOLANA_SOLVER
    : TEST_USER;
}

function makeEscrowOptions(
  inputTokens: TokenContext[],
  outputTokens: TokenContext[],
  overrides: Partial<CreateIntentOptionsEscrow> = {},
): CreateIntentOptionsEscrow {
  return {
    exclusiveFor: defaultExclusiveFor(inputTokens),
    inputTokens,
    outputTokens,
    verifier: "polymer",
    account: TEST_USER,
    // Cross-namespace fixtures need an explicit recipient (see the
    // cross-namespace recipient guard in Intent.singlechain).
    outputRecipient: TEST_USER,
    lock: { type: "escrow" },
    ...overrides,
  };
}

describe("Intent", () => {
  beforeEach(() => {
    Date.now = () => TEST_NOW_SECONDS * 1000;
    Math.random = () => 0.5;
  });

  afterEach(() => {
    Date.now = originalDateNow;
    Math.random = originalMathRandom;
  });

  it("counts unique input chains and detects multichain", () => {
    const intent = new Intent(
      makeEscrowOptions(
        [ctx(ETH_USDC, 10n), ctx(ETH_WETH, 1n), ctx(ARB_USDC, 20n)],
        [ctx(BASE_USDC, 10n)],
      ),
      intentDeps,
    );

    expect(intent.numInputChains()).toBe(2);
    expect(intent.isMultichain()).toBe(true);
  });

  it("detects same-chain when single input and output chains match", () => {
    const intent = new Intent(
      makeEscrowOptions([ctx(ETH_USDC, 10n)], [ctx(ETH_WETH, 1n)]),
      intentDeps,
    );

    expect(intent.isMultichain()).toBe(false);
    expect(intent.isSameChain()).toBe(true);
  });

  it("builds a single-chain intent with default deadlines and same-chain oracle", () => {
    const intent = new Intent(
      makeEscrowOptions([ctx(ETH_USDC, 10n)], [ctx(ETH_WETH, 1n)]),
      intentDeps,
    );
    const single = intent.singlechain();
    const order = single.asOrder();

    expect(single).toBeInstanceOf(StandardEVMIntent);
    expect(single.inputSettler).toBe(INPUT_SETTLER_ESCROW_LIFI);
    expect(order.inputOracle).toBe(COIN_FILLER);
    expect(order.fillDeadline).toBe(TEST_NOW_SECONDS + 44 * 60 * 60);
    expect(order.expires).toBe(TEST_NOW_SECONDS + 48 * 60 * 60);
    expect(order.nonce).toBe(2_147_483_648n);
    expect(intent.nonce()).toBe(2_147_483_648n);
  });

  it("applies expiry and fillDeadline overrides from options", () => {
    const intent = new Intent(
      {
        ...makeEscrowOptions([ctx(ETH_USDC, 10n)], [ctx(ETH_WETH, 1n)]),
        expiry: 60,
        fillDeadline: 30,
      },
      intentDeps,
    );
    const order = intent.singlechain().asOrder();

    expect(order.expires).toBe(TEST_NOW_SECONDS + 60);
    expect(order.fillDeadline).toBe(TEST_NOW_SECONDS + 30);
  });

  it("applies expiry and fillDeadline overrides via chained setters", () => {
    const intent = new Intent(
      makeEscrowOptions([ctx(ETH_USDC, 10n)], [ctx(ETH_WETH, 1n)]),
      intentDeps,
    );
    expect(intent.setExpiry(120).setFillDeadline(90)).toBe(intent);
    const order = intent.singlechain().asOrder();

    expect(order.expires).toBe(TEST_NOW_SECONDS + 120);
    expect(order.fillDeadline).toBe(TEST_NOW_SECONDS + 90);
  });

  it("issues a limit order with empty output context when exclusiveFor is omitted", () => {
    const intent = new Intent(
      {
        inputTokens: [ctx(ETH_USDC, 10n)],
        outputTokens: [ctx(ETH_WETH, 1n)],
        verifier: "polymer",
        account: TEST_USER,
        lock: { type: "escrow" },
      },
      intentDeps,
    );
    const order = intent.singlechain().asOrder();

    expect(order.outputs.every((output) => output.context === "0x")).toBe(true);
  });

  it("generates a stable positive nonce and never emits zero", () => {
    Math.random = () => 0;
    const intent = new Intent(
      makeEscrowOptions([ctx(ETH_USDC, 10n)], [ctx(ETH_WETH, 1n)]),
      intentDeps,
    );

    expect(intent.nonce()).toBe(1n);
    expect(intent.nonce()).toBe(1n);
  });

  it("throws when singlechain() is called for multichain input set", () => {
    const intent = new Intent(
      makeEscrowOptions(
        [ctx(ETH_USDC, 10n), ctx(ARB_USDC, 20n)],
        [ctx(BASE_USDC, 10n)],
      ),
      intentDeps,
    );

    expect(() => intent.singlechain()).toThrow("Not supported as single chain");
  });

  it("builds multichain orders grouped by chain", () => {
    const intent = new Intent(
      makeEscrowOptions(
        [ctx(ETH_USDC, 10n), ctx(ETH_WETH, 2n), ctx(ARB_USDC, 20n)],
        [ctx(BASE_USDC, 10n)],
      ),
      intentDeps,
    );
    const multi = intent.multichain();
    const order = multi.asOrder();

    expect(multi).toBeInstanceOf(MultichainOrderIntent);
    expect(multi.inputSettler).toBe(MULTICHAIN_INPUT_SETTLER_ESCROW);
    expect(order.inputs.length).toBe(2);
    const [firstInput, secondInput] = order.inputs;
    if (!firstInput || !secondInput)
      throw new Error("Expected two multichain input groups");
    expect(firstInput.inputs.length).toBe(2);
    expect(secondInput.inputs.length).toBe(1);
  });

  it("order() dispatches to singlechain or multichain intent", () => {
    const single = new Intent(
      makeEscrowOptions([ctx(ETH_USDC, 1n)], [ctx(ETH_WETH, 1n)]),
      intentDeps,
    ).order();
    const multi = new Intent(
      makeEscrowOptions(
        [ctx(ETH_USDC, 1n), ctx(ARB_USDC, 1n)],
        [ctx(BASE_USDC, 1n)],
      ),
      intentDeps,
    ).order();

    expect(single).toBeInstanceOf(StandardEVMIntent);
    expect(multi).toBeInstanceOf(MultichainOrderIntent);
  });

  it("routes a mixed local/remote output order entirely through the cross-chain rule", () => {
    // Documents existing behaviour, not a new decision: `sameChain` is computed
    // for the whole order (isSameChain returns false as soon as the outputs span
    // two chains), so the output that happens to sit on the input chain gets the
    // cross-chain oracle rather than the settler.
    const intent = new Intent(
      makeEscrowOptions(
        [ctx(ETH_USDC, 2n)],
        [ctx(ETH_USDC, 1n), ctx(ARB_USDC, 1n)],
      ),
      intentDeps,
    );
    const order = intent.singlechain().asOrder();

    expect(order.outputs[0]!.chainId).toBe(CHAIN_ID_ETHEREUM);
    expect(order.outputs[0]!.oracle).toBe(
      addressToBytes32(TEST_POLYMER_ORACLE),
    );
    expect(order.outputs[0]!.oracle).not.toBe(addressToBytes32(COIN_FILLER));
    expect(order.outputs[1]!.oracle).toBe(
      addressToBytes32(TEST_POLYMER_ORACLE),
    );
  });

  describe("Solana singlechain", () => {
    const SOLANA_DEVNET_ORACLE =
      "0x0000003E06000007A224AeE90052fA6bb46d43C9" as const;

    const solanaIntentDeps: IntentDeps = {
      getOracle(verifier, chainId) {
        if (verifier !== "polymer") return undefined;
        if (chainId === SOLANA_DEVNET_CHAIN_ID) return SOLANA_DEVNET_ORACLE;
        return [CHAIN_ID_ETHEREUM, CHAIN_ID_ARBITRUM, CHAIN_ID_BASE].includes(
          chainId,
        )
          ? TEST_POLYMER_ORACLE
          : undefined;
      },
    };

    const SOLANA_USDC: CoreToken = {
      address:
        "0xab11111111111111111111111111111111111111111111111111111111111111",
      name: "USDC",
      chainId: SOLANA_DEVNET_CHAIN_ID,
      decimals: 6,
      chainNamespace: "solana",
    };

    it("returns SolanaStandardEVMIntent for a solana input token", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        solanaIntentDeps,
      );
      const result = intent.singlechain();

      expect(result).toBeInstanceOf(StandardSolanaIntent);
      expect(result.inputSettler).toBe(SOLANA_DEVNET_INPUT_SETTLER_ESCROW);
    });

    it("sets inputOracle from the oracle resolver", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        solanaIntentDeps,
      );
      const order = intent.singlechain().asOrder();

      expect(order.inputOracle).toBe(SOLANA_DEVNET_ORACLE);
    });

    it("throws when more than one solana input is provided", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1n), ctx(SOLANA_USDC, 2n)],
          [ctx(ARB_USDC, 1n)],
        ),
        solanaIntentDeps,
      );

      expect(() => intent.singlechain()).toThrow(
        "SolanaStandardOrder only supports a single input",
      );
    });

    it("throws for an undeployed solana chain id", () => {
      const testnetToken: CoreToken = {
        ...SOLANA_USDC,
        chainId: SOLANA_TESTNET_CHAIN_ID,
      };
      const intent = new Intent(
        makeEscrowOptions([ctx(testnetToken, 1n)], [ctx(ARB_USDC, 1n)]),
        {
          getOracle: () => SOLANA_DEVNET_ORACLE,
        },
      );

      expect(() => intent.singlechain()).toThrow("Unsupported Solana chain id");
    });

    it("names the EVM output chain's polymer oracle on a Solana->EVM output", () => {
      // The input chain's oracle is a 32-byte Solana PDA, and the EVM output
      // settler reverts HasDirtyBits() on it before it moves any tokens
      // (OutputSettlerBase.sol:175), so a Solana-origin order must name the
      // OUTPUT chain's oracle. Safe because oracle_polymer::receive_attest
      // keys the attestation by output.oracle exactly as declared.
      const getOracle = mock(solanaIntentDeps.getOracle);
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        { getOracle },
      );
      const order = intent.singlechain().asOrder();

      expect(order.outputs[0]!.oracle).toBe(
        addressToBytes32(TEST_POLYMER_ORACLE),
      );
      expect(order.outputs[0]!.oracle).not.toBe(SOLANA_DEVNET_ORACLE);
      // The upper 12 bytes must be zero or the EVM fill reverts. Only an
      // on-chain call would otherwise catch this.
      expect(order.outputs[0]!.oracle.slice(0, 26)).toBe(
        `0x${"00".repeat(12)}`,
      );
      expect(getOracle).toHaveBeenCalledWith("polymer", CHAIN_ID_ARBITRUM);
      // The input side is unchanged: still the Solana oracle PDA.
      expect(order.inputOracle).toBe(SOLANA_DEVNET_ORACLE);
    });

    it("never puts the 32-byte solana oracle PDA into an EVM output", () => {
      // The regression this guards: the real deployed input oracle is a full
      // 32-byte PDA. Any non-zero upper 12 bytes make the EVM fill revert.
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        {
          getOracle(verifier, chainId) {
            if (verifier !== "polymer") return undefined;
            if (chainId === SOLANA_DEVNET_CHAIN_ID)
              return SOLANA_POLYMER_ORACLE_PDA;
            return TEST_POLYMER_ORACLE;
          },
        },
      );
      const order = intent.singlechain().asOrder();

      expect(order.inputOracle).toBe(SOLANA_POLYMER_ORACLE_PDA);
      expect(order.outputs[0]!.oracle).not.toBe(SOLANA_POLYMER_ORACLE_PDA);
      expect(order.outputs[0]!.oracle).toBe(
        addressToBytes32(TEST_POLYMER_ORACLE),
      );
    });

    it("names the Tron output chain's oracle on a Solana->Tron output", () => {
      // Tron's PolymerOracle is not the CREATE2-identical EVM address, so
      // "the output chain's oracle" must be resolved per chain.
      const TRON_ORACLE = "0xfa5fabd73c86e1822fda06418c332800c0d7d73b" as const;
      const TRON_USDC: CoreToken = {
        address: "0xab11111111111111111111111111111111111111",
        name: "USDC",
        chainId: TRON_MAINNET_CHAIN_ID,
        decimals: 6,
        chainNamespace: "tron",
      };
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(TRON_USDC, 1_000_000n)],
          { outputRecipient: b32("c") },
        ),
        {
          getOracle(verifier, chainId) {
            if (verifier !== "polymer") return undefined;
            if (chainId === TRON_MAINNET_CHAIN_ID) return TRON_ORACLE;
            if (chainId === SOLANA_DEVNET_CHAIN_ID) return SOLANA_DEVNET_ORACLE;
            return undefined;
          },
        },
      );
      const order = intent.singlechain().asOrder();

      expect(order.outputs[0]!.oracle).toBe(addressToBytes32(TRON_ORACLE));
      expect(order.outputs[0]!.settler).toBe(
        addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
      );
    });

    it("names the polymer PROGRAM ID on an EVM->Solana output", () => {
      // The generic polymer rule would put the input chain's oracle here,
      // producing an order that fills and can then never be proven —
      // oracle_polymer::submit compares against its own program id.
      const getOracle = mock(() => TEST_POLYMER_ORACLE);
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(ARB_USDC, 1_000_000n)],
          [ctx(SOLANA_USDC, 1_000_000n)],
          { outputRecipient: b32("c") },
        ),
        { getOracle },
      );
      const order = intent.singlechain().asOrder();

      expect(order.outputs[0]!.oracle).toBe(SOLANA_POLYMER_ORACLE_PROGRAM);
      expect(order.outputs[0]!.settler).toBe(SOLANA_OUTPUT_SETTLER_PDA);
      // The Solana output chain is never asked for an oracle.
      expect(getOracle).not.toHaveBeenCalledWith(
        "polymer",
        SOLANA_DEVNET_CHAIN_ID,
      );
    });

    it("uses the output settler as inputOracle for a same-chain solana order", () => {
      // validate_fill takes the LocalAttestation branch and never reads
      // input_oracle, so no cross-chain oracle is required.
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(SOLANA_USDC, 1_000_000n)],
        ),
        { getOracle: () => undefined },
      );
      const order = intent.singlechain().asOrder();

      expect(order.inputOracle).toBe(SOLANA_OUTPUT_SETTLER_PDA);
      expect(order.outputs[0]!.oracle).toBe(SOLANA_OUTPUT_SETTLER_PDA);
      expect(order.outputs[0]!.settler).toBe(SOLANA_OUTPUT_SETTLER_PDA);
    });

    it("keeps a 32-byte solana exclusiveFor unpadded in the context", () => {
      const solanaSolver = TEST_SOLANA_SOLVER;
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
          { outputRecipient: TEST_USER, exclusiveFor: solanaSolver },
        ),
        { getOracle: () => TEST_POLYMER_ORACLE },
      );
      const order = intent.singlechain().asOrder();

      // 0xe0 ‖ bytes32 solver ‖ uint32 start
      expect(order.outputs[0]!.context.slice(0, 4)).toBe("0xe0");
      expect(order.outputs[0]!.context.slice(4, 68)).toBe(
        solanaSolver.slice(2),
      );
    });

    // The failure this rejects is order
    // 0x2947daf76e839afdd36972307f937d2dd80bea17c264f242b6fc78697168dcd3: a
    // Solana-origin order exclusive to an EVM address. It filled on Base and
    // can never be finalised, because the escrow pays out only to the solver
    // that signs on Solana.
    it("rejects an EVM exclusiveFor on a solana-origin order", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
          { outputRecipient: TEST_USER, exclusiveFor: TEST_USER },
        ),
        { getOracle: () => TEST_POLYMER_ORACLE },
      );

      expect(() => intent.singlechain()).toThrow("is not a Solana pubkey");
    });

    it("applies a custom exclusivity window to a solana-origin order", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(SOLANA_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
          { outputRecipient: TEST_USER, exclusivity: 300 },
        ),
        { getOracle: () => TEST_POLYMER_ORACLE },
      );
      const order = intent.singlechain().asOrder();

      // Trailing uint32 of the exclusive-limit context is the window's end.
      expect(parseInt(order.outputs[0]!.context.slice(68, 76), 16)).toBe(
        TEST_NOW_SECONDS + 300,
      );
    });
  });

  describe("Tron singlechain", () => {
    const TRON_ORACLE = "0xfa5fabd73c86e1822fda06418c332800c0d7d73b" as const;

    const tronIntentDeps: IntentDeps = {
      getOracle(verifier, chainId) {
        if (verifier !== "polymer") return undefined;
        if (chainId === TRON_MAINNET_CHAIN_ID) return TRON_ORACLE;
        return [CHAIN_ID_ETHEREUM, CHAIN_ID_ARBITRUM, CHAIN_ID_BASE].includes(
          chainId,
        )
          ? TEST_POLYMER_ORACLE
          : undefined;
      },
    };

    const TRON_USDC: CoreToken = {
      address: "0xab11111111111111111111111111111111111111",
      name: "USDC",
      chainId: TRON_MAINNET_CHAIN_ID,
      decimals: 6,
      chainNamespace: "tron",
    };

    it("keeps the tron INPUT chain's oracle on a Tron->EVM output", () => {
      // Anti-regression for the Solana-input change: an EVM-shaped input still
      // names its own oracle, and Tron's is not the EVM address.
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(TRON_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        tronIntentDeps,
      );
      const order = intent.singlechain().asOrder();

      expect(order.outputs[0]!.oracle).toBe(addressToBytes32(TRON_ORACLE));
      expect(order.outputs[0]!.oracle).not.toBe(
        addressToBytes32(TEST_POLYMER_ORACLE),
      );
    });

    it("keeps the EVM INPUT chain's oracle on an EVM->Tron output", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(ARB_USDC, 1_000_000n)],
          [ctx(TRON_USDC, 1_000_000n)],
          { outputRecipient: b32("c") },
        ),
        tronIntentDeps,
      );
      const order = intent.singlechain().asOrder();

      expect(order.outputs[0]!.oracle).toBe(
        addressToBytes32(TEST_POLYMER_ORACLE),
      );
      expect(order.outputs[0]!.settler).toBe(
        addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
      );
    });

    it("returns StandardEVMIntent with tron namespace for a tron input token", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(TRON_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        tronIntentDeps,
      );
      const result = intent.singlechain();

      expect(result).toBeInstanceOf(StandardEVMIntent);
      expect(result.namespace).toBe("tron");
      expect(result.inputSettler).toBe(TRON_MAINNET_INPUT_SETTLER);
    });

    it("sets inputOracle from the oracle resolver", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(TRON_USDC, 1_000_000n)],
          [ctx(ARB_USDC, 1_000_000n)],
        ),
        tronIntentDeps,
      );
      const order = intent.singlechain().asOrder();

      expect(order.inputOracle).toBe(TRON_ORACLE);
    });

    it("supports multiple tron inputs", () => {
      const TRON_WTRX: CoreToken = {
        address: "0xcd22222222222222222222222222222222222222",
        name: "WTRX",
        chainId: TRON_MAINNET_CHAIN_ID,
        decimals: 6,
        chainNamespace: "tron",
      };

      const intent = new Intent(
        makeEscrowOptions(
          [ctx(TRON_USDC, 1n), ctx(TRON_WTRX, 2n)],
          [ctx(ARB_USDC, 1n)],
        ),
        tronIntentDeps,
      );
      const result = intent.singlechain();

      expect(result).toBeInstanceOf(StandardEVMIntent);
      expect(result.namespace).toBe("tron");
      expect(result.asOrder().inputs.length).toBe(2);
    });

    it("requires an explicit recipient for cross-namespace outputs", () => {
      const options = makeEscrowOptions(
        [ctx(TRON_USDC, 1_000_000n)],
        [ctx(ARB_USDC, 1_000_000n)],
      );
      delete options.outputRecipient;
      const intent = new Intent(options, tronIntentDeps);

      expect(() => intent.singlechain()).toThrow(
        "require an explicit output recipient",
      );
    });

    it("uses the tron output settler as inputOracle for same-chain fills without consulting getOracle", () => {
      const TRON_USDT: CoreToken = {
        address: "0xa614f803b6fd780986a42c78ec9c7f77e6ded13c",
        name: "USDT",
        chainId: TRON_MAINNET_CHAIN_ID,
        decimals: 6,
        chainNamespace: "tron",
      };
      const noTronOracleDeps: IntentDeps = {
        getOracle() {
          return undefined;
        },
      };
      const intent = new Intent(
        makeEscrowOptions([ctx(TRON_USDC, 1n)], [ctx(TRON_USDT, 1n)]),
        noTronOracleDeps,
      );
      const order = intent.singlechain().asOrder();

      expect(order.inputOracle).toBe(TRON_MAINNET_OUTPUT_SETTLER);
      expect(order.outputs[0]!.oracle).toBe(
        addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
      );
      expect(order.outputs[0]!.settler).toBe(
        addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
      );
    });

    it("rejects singlechain inputs with mixed namespaces", () => {
      const intent = new Intent(
        makeEscrowOptions(
          // Same chain id so the multichain detector does not trip first.
          [
            ctx(TRON_USDC, 1n),
            ctx({ ...ARB_USDC, chainId: TRON_MAINNET_CHAIN_ID }, 1n),
          ],
          [ctx(ARB_USDC, 1n)],
        ),
        tronIntentDeps,
      );

      expect(() => intent.singlechain()).toThrow(
        "All inputs must share one chain namespace",
      );
    });

    it("rejects multichain orders containing a tron input", () => {
      const intent = new Intent(
        makeEscrowOptions(
          [ctx(TRON_USDC, 1n), ctx(ETH_USDC, 1n)],
          [ctx(ARB_USDC, 1n)],
        ),
        tronIntentDeps,
      );

      expect(() => intent.multichain()).toThrow(
        "Multichain orders only support eip155 inputs",
      );
    });
  });
});
