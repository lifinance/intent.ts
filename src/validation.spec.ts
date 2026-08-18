import { describe, expect, it } from "bun:test";
import {
  BYTES32_ZERO,
  COIN_FILLER,
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  SOLANA_OUTPUT_SETTLER_PDA,
  SOLANA_POLYMER_ORACLE_PDA,
  SOLANA_POLYMER_ORACLE_PROGRAM,
  TRON_MAINNET_CHAIN_ID,
  TRON_MAINNET_OUTPUT_SETTLER,
  TRON_MAINNET_POLYMER_ORACLE,
} from "./constants";
import type { OrderContainerValidationDeps } from "./deps";
import {
  validateOrder,
  validateOrderContainer,
  validateOrderContainerWithReason,
  validateOrderWithReason,
  VALIDATION_ERRORS,
} from "./validation";
import type { OrderContainer } from "./types";
import {
  b32,
  CHAIN_ID_ARBITRUM,
  CHAIN_ID_ETHEREUM,
  CHAIN_ID_SOLANA_DEVNET,
  CHAIN_ID_SOLANA_MAINNET,
  makeMandateOutput,
  makeMultichainOrder,
  makeSolanaMandateOutput,
  makeStandardEvm,
  makeStandardSolana,
  makeStandardTron,
  TEST_POLYMER_ORACLE,
} from "../tests/orderFixtures";
import { addressToBytes32 } from "./helpers/convert";

const output = makeMandateOutput(CHAIN_ID_ARBITRUM, 1n, { context: "0x00" });

const validationDeps: OrderContainerValidationDeps = {
  inputSettlers: [INPUT_SETTLER_COMPACT_LIFI],
  allowedInputOracles({ chainId, sameChainFill }) {
    if (chainId !== CHAIN_ID_ETHEREUM) return undefined;
    const allowed = [
      "0x0000003E06000007A224AeE90052fA6bb46d43C9" as `0x${string}`,
    ];
    if (sameChainFill) allowed.push(COIN_FILLER);
    return allowed;
  },
  allowedOutputOracles({ outputChainId }) {
    if (
      outputChainId !== CHAIN_ID_ARBITRUM &&
      outputChainId !== CHAIN_ID_ETHEREUM
    )
      return undefined;
    // COIN_FILLER must now be returned explicitly — the library no longer
    // injects it for every chain.
    return ["0x0000003E06000007A224AeE90052fA6bb46d43C9", COIN_FILLER];
  },
  allowedOutputSettlers() {
    return [COIN_FILLER];
  },
};

describe("validation", () => {
  it("rejects orders where fillDeadline is later than expires", () => {
    const invalidTiming = makeStandardEvm({
      expires: 2_000_000_000,
      fillDeadline: 2_000_000_001,
    });
    const result = validateOrderWithReason({
      order: invalidTiming,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.FILL_DEADLINE_AFTER_EXPIRES);
  });

  it("accepts orders with multiple outputs", () => {
    const multiOutput = makeStandardEvm({
      outputs: [output, { ...output, amount: 2n }],
    });
    expect(validateOrder({ order: multiOutput, deps: validationDeps })).toBe(
      true,
    );
  });

  it("rejects orders with unknown source oracle", () => {
    const invalidOracle = makeStandardEvm({
      inputOracle: "0x0000000000000000000000000000000000000001",
    });
    const result = validateOrderWithReason({
      order: invalidOracle,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INPUT_ORACLE_NOT_ALLOWED);
  });

  it("accepts same-chain intents with COIN_FILLER as inputOracle", () => {
    const sameChainCoinFiller = makeStandardEvm({
      inputOracle: COIN_FILLER,
      outputs: [{ ...output, chainId: CHAIN_ID_ETHEREUM }],
    });
    expect(
      validateOrder({ order: sameChainCoinFiller, deps: validationDeps }),
    ).toBe(true);
  });

  it("rejects orders with empty inputs", () => {
    const emptyInputs = makeStandardEvm({ inputs: [] });
    const result = validateOrderWithReason({
      order: emptyInputs,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.NO_INPUTS);
  });

  it("rejects orders with non-positive input amount", () => {
    const invalidInputAmount = makeStandardEvm({ inputs: [[1n, 0n]] });
    const result = validateOrderWithReason({
      order: invalidInputAmount,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INPUT_AMOUNT_NON_POSITIVE);
  });

  it("rejects orders with zero output amount", () => {
    const zeroOutputAmount = makeStandardEvm({
      outputs: [{ ...output, amount: 0n }],
    });
    const result = validateOrderWithReason({
      order: zeroOutputAmount,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_AMOUNT_NON_POSITIVE);
  });

  it("rejects orders with negative output amount", () => {
    const negativeOutputAmount = makeStandardEvm({
      outputs: [{ ...output, amount: -1n }],
    });
    const result = validateOrderWithReason({
      order: negativeOutputAmount,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_AMOUNT_NON_POSITIVE);
  });

  it("rejects orders with unknown output chain", () => {
    const badOutputChain = makeStandardEvm({
      outputs: [{ ...output, chainId: 999999999n }],
    });
    const result = validateOrderWithReason({
      order: badOutputChain,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.UNKNOWN_OUTPUT_CHAIN);
  });

  it("rejects orders with non-whitelisted output oracle", () => {
    const badOutputOracle = makeStandardEvm({
      outputs: [{ ...output, oracle: b32("a") }],
    });
    const result = validateOrderWithReason({
      order: badOutputOracle,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
  });

  it("rejects orders with non-whitelisted output settler", () => {
    const badOutputSettler = makeStandardEvm({
      outputs: [{ ...output, settler: b32("b") }],
    });
    const result = validateOrderWithReason({
      order: badOutputSettler,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
  });

  it("rejects orders with zero token", () => {
    const invalidToken = makeStandardEvm({
      outputs: [{ ...output, token: b32("0") }],
    });
    const result = validateOrderWithReason({
      order: invalidToken,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_TOKEN_ZERO);
  });

  it("rejects orders with zero recipient", () => {
    const invalidRecipient = makeStandardEvm({
      outputs: [{ ...output, recipient: b32("0") }],
    });
    const result = validateOrderWithReason({
      order: invalidRecipient,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_RECIPIENT_ZERO);
  });

  it("returns standard-order validation result from container validator", () => {
    const invalidStandardContainer: OrderContainer = {
      inputSettler: INPUT_SETTLER_ESCROW_LIFI,
      order: makeStandardEvm({
        inputOracle: "0x0000000000000000000000000000000000000001",
      }),
      sponsorSignature: { type: "None", payload: "0x" },
      allocatorSignature: { type: "None", payload: "0x" },
    };

    const result = validateOrderContainerWithReason({
      orderContainer: invalidStandardContainer,
      deps: validationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INPUT_ORACLE_NOT_ALLOWED);
  });

  it("accepts multichain containers in TODO validation path", () => {
    const multichainContainer: OrderContainer = {
      inputSettler: MULTICHAIN_INPUT_SETTLER_ESCROW,
      order: makeMultichainOrder(),
      sponsorSignature: { type: "None", payload: "0x" },
      allocatorSignature: { type: "None", payload: "0x" },
    };
    expect(
      validateOrderContainer({
        orderContainer: multichainContainer,
        deps: validationDeps,
      }),
    ).toBe(true);
  });

  it("treats compact intents as valid in container validator (TODO path)", () => {
    const compactContainer: OrderContainer = {
      inputSettler: INPUT_SETTLER_COMPACT_LIFI,
      order: makeStandardEvm({
        inputOracle: "0x0000000000000000000000000000000000000001",
      }),
      sponsorSignature: { type: "None", payload: "0x" },
      allocatorSignature: { type: "None", payload: "0x" },
    };
    expect(
      validateOrderContainer({
        orderContainer: compactContainer,
        deps: validationDeps,
      }),
    ).toBe(true);
  });
});

describe("validation (tron)", () => {
  // Deps that model the chain-aware policy the app is expected to implement:
  // per-chain settlers, input-oracle correlation, native only on Tron.
  const tronAwareDeps: OrderContainerValidationDeps = {
    inputSettlers: [],
    allowedInputOracles({ chainId }) {
      if (chainId === TRON_MAINNET_CHAIN_ID)
        return [TRON_MAINNET_POLYMER_ORACLE];
      if (chainId === CHAIN_ID_ETHEREUM || chainId === CHAIN_ID_ARBITRUM)
        return [TEST_POLYMER_ORACLE];
      return undefined;
    },
    allowedOutputOracles({ inputChainId, inputOracle, sameChainFill }) {
      if (sameChainFill) return [];
      // Polymer: output.oracle must be the INPUT chain's configured oracle.
      if (
        inputChainId === TRON_MAINNET_CHAIN_ID &&
        inputOracle === TRON_MAINNET_POLYMER_ORACLE
      )
        return [TRON_MAINNET_POLYMER_ORACLE];
      if (inputOracle === TEST_POLYMER_ORACLE) return [TEST_POLYMER_ORACLE];
      return [];
    },
    allowedOutputSettlers(chainId) {
      if (chainId === TRON_MAINNET_CHAIN_ID)
        return [TRON_MAINNET_OUTPUT_SETTLER];
      return [COIN_FILLER];
    },
    supportsNativeOutput(chainId) {
      return chainId === TRON_MAINNET_CHAIN_ID;
    },
  };

  const tronOutput = makeMandateOutput(TRON_MAINNET_CHAIN_ID, 5n, {
    oracle: addressToBytes32(TRON_MAINNET_POLYMER_ORACLE),
    settler: addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
  });

  it("accepts an EVM->Tron order with the Tron settler on the Tron output", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        { ...tronOutput, oracle: addressToBytes32(TEST_POLYMER_ORACLE) },
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(true);
  });

  it("rejects the Tron output settler on an EVM output chain", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          settler: addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER),
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
  });

  it("rejects an output oracle that is not the input chain's oracle", () => {
    const order = makeStandardTron({
      inputOracle: TRON_MAINNET_POLYMER_ORACLE,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
        }),
      ],
    });
    const wrongCorrelationDeps: OrderContainerValidationDeps = {
      ...tronAwareDeps,
      allowedOutputOracles({ inputOracle }) {
        // Strict correlation: only the order's own input oracle is valid.
        return inputOracle === TRON_MAINNET_POLYMER_ORACLE
          ? [TRON_MAINNET_POLYMER_ORACLE]
          : [];
      },
    };
    const result = validateOrderWithReason({
      order,
      deps: wrongCorrelationDeps,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
  });

  it("accepts a native (zero-token) output on Tron", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        {
          ...tronOutput,
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          token: BYTES32_ZERO,
        },
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(true);
  });

  it("rejects a native (zero-token) output on chains without native support", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          token: BYTES32_ZERO,
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_TOKEN_ZERO);
  });

  it("rejects native outputs everywhere when supportsNativeOutput is omitted", () => {
    const { supportsNativeOutput: _unused, ...withoutNative } = tronAwareDeps;
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        {
          ...tronOutput,
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          token: BYTES32_ZERO,
        },
      ],
    });
    const result = validateOrderWithReason({ order, deps: withoutNative });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_TOKEN_ZERO);
  });

  it("rejects COIN_FILLER as the oracle on a Tron output", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        {
          ...tronOutput,
          oracle: addressToBytes32(COIN_FILLER),
        },
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
  });

  it("accepts mixed native and TRC-20 outputs on Tron", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        { ...tronOutput, oracle: addressToBytes32(TEST_POLYMER_ORACLE) },
        {
          ...tronOutput,
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          token: BYTES32_ZERO,
        },
      ],
    });
    const result = validateOrderWithReason({ order, deps: tronAwareDeps });
    expect(result.passed).toBe(true);
  });
});

describe("validation (solana)", () => {
  // Deps modelling the policy an app must implement for Solana. The asymmetry
  // that matters: a Solana OUTPUT is proven under the Polymer PROGRAM ID,
  // while a Solana INPUT proves under the Polymer oracle PDA.
  const solanaAwareDeps: OrderContainerValidationDeps = {
    inputSettlers: [],
    allowedInputOracles({ chainId, sameChainFill }) {
      if (
        chainId === CHAIN_ID_SOLANA_DEVNET ||
        chainId === CHAIN_ID_SOLANA_MAINNET
      ) {
        return sameChainFill
          ? [SOLANA_OUTPUT_SETTLER_PDA]
          : [SOLANA_POLYMER_ORACLE_PDA];
      }
      if (chainId === CHAIN_ID_ETHEREUM || chainId === CHAIN_ID_ARBITRUM)
        return [TEST_POLYMER_ORACLE];
      return undefined;
    },
    allowedOutputOracles({ outputChainId, inputOracle, sameChainFill }) {
      if (sameChainFill) return [SOLANA_OUTPUT_SETTLER_PDA];
      // A Solana output is identified to Polymer by program id, regardless of
      // what the input chain's oracle is.
      if (
        outputChainId === CHAIN_ID_SOLANA_DEVNET ||
        outputChainId === CHAIN_ID_SOLANA_MAINNET
      )
        return [SOLANA_POLYMER_ORACLE_PROGRAM];
      if (inputOracle === SOLANA_POLYMER_ORACLE_PDA)
        return [SOLANA_POLYMER_ORACLE_PDA];
      if (inputOracle === TEST_POLYMER_ORACLE) return [TEST_POLYMER_ORACLE];
      return [];
    },
    allowedOutputSettlers(chainId) {
      if (
        chainId === CHAIN_ID_SOLANA_DEVNET ||
        chainId === CHAIN_ID_SOLANA_MAINNET
      )
        return [SOLANA_OUTPUT_SETTLER_PDA];
      return [COIN_FILLER];
    },
    supportsNativeOutput(chainId) {
      // native_fill exists on the Solana output settler.
      return (
        chainId === CHAIN_ID_SOLANA_DEVNET ||
        chainId === CHAIN_ID_SOLANA_MAINNET
      );
    },
  };

  it("accepts an EVM->Solana order carrying the polymer program id", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [makeSolanaMandateOutput()],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(true);
  });

  it("rejects an EVM->Solana output carrying the input chain's EVM oracle", () => {
    // Regression guard for the buildMandateOutputs bug: the generic polymer
    // rule (output.oracle = input chain's oracle) produces an order that fills
    // and can then never be proven.
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 1n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
  });

  it("rejects the polymer PDA in a Solana output's oracle", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 1n, {
          oracle: SOLANA_POLYMER_ORACLE_PDA,
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
  });

  it("rejects the polymer program id as a Solana order's inputOracle", () => {
    const order = makeStandardSolana({
      inputOracle: SOLANA_POLYMER_ORACLE_PROGRAM,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INPUT_ORACLE_NOT_ALLOWED);
  });

  it("accepts a Solana->EVM order using the polymer oracle PDA", () => {
    const order = makeStandardSolana({
      inputOracle: SOLANA_POLYMER_ORACLE_PDA,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: SOLANA_POLYMER_ORACLE_PDA,
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(true);
  });

  it("accepts a same-chain Solana order settled against the output settler", () => {
    const order = makeStandardSolana({
      inputOracle: SOLANA_OUTPUT_SETTLER_PDA,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 5n, {
          oracle: SOLANA_OUTPUT_SETTLER_PDA,
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(true);
  });

  it("rejects the Solana output settler on an EVM output chain", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeMandateOutput(CHAIN_ID_ARBITRUM, 5n, {
          oracle: addressToBytes32(TEST_POLYMER_ORACLE),
          settler: SOLANA_OUTPUT_SETTLER_PDA,
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
  });

  it("rejects the superseded pre-vanity-key output settler PDA", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 1n, {
          settler:
            "0x57e93c230b75ab3ad76e89157ae3ce486fbe4ae4c4ac120882ccf2fdfb88a8bf",
        }),
      ],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
  });

  it("accepts a native SOL output and rejects it without native support", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 1n, {
          token: BYTES32_ZERO,
        }),
      ],
    });
    expect(
      validateOrderWithReason({ order, deps: solanaAwareDeps }).passed,
    ).toBe(true);

    const withoutNative: OrderContainerValidationDeps = {
      ...solanaAwareDeps,
      supportsNativeOutput: undefined,
    };
    const result = validateOrderWithReason({ order, deps: withoutNative });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_TOKEN_ZERO);
  });

  it("rejects a Solana output amount that does not fit u64", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 1n << 64n)],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.OUTPUT_AMOUNT_EXCEEDS_U64);
  });

  it("allows the largest u64 Solana output amount", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, (1n << 64n) - 1n),
      ],
    });
    expect(
      validateOrderWithReason({ order, deps: solanaAwareDeps }).passed,
    ).toBe(true);
  });

  it("rejects two identical outputs", () => {
    // One transfer would satisfy both fill records; the user pays twice.
    const duplicate = makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 5n);
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [duplicate, { ...duplicate }],
    });
    const result = validateOrderWithReason({ order, deps: solanaAwareDeps });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(VALIDATION_ERRORS.DUPLICATE_OUTPUTS);
  });

  it("allows two outputs that differ only by amount", () => {
    const order = makeStandardEvm({
      inputOracle: TEST_POLYMER_ORACLE,
      outputs: [
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 5n),
        makeSolanaMandateOutput(CHAIN_ID_SOLANA_DEVNET, 6n),
      ],
    });
    expect(
      validateOrderWithReason({ order, deps: solanaAwareDeps }).passed,
    ).toBe(true);
  });
});
