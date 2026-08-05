import type {
  OrderContainerValidationDeps,
  StandardOrderValidationDeps,
} from "./deps";
import {
  BYTES32_ZERO,
  INPUT_SETTLER_COMPACT_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
} from "./constants";
import { addressToBytes32 } from "./helpers/convert";
import { isStandardOrder } from "./intent/index";
import type { OrderContainer, StandardOrder } from "./types/index";

export type ValidationResult = {
  passed: boolean;
  reason: string;
};

export const VALIDATION_PASS_REASON = "" as const;

export enum VALIDATION_ERRORS {
  FILL_DEADLINE_AFTER_EXPIRES = "fillDeadline > expires",
  UNKNOWN_ORIGIN_CHAIN = "input chain",
  INPUT_ORACLE_NOT_ALLOWED = "inputOracle",
  NO_INPUTS = "inputs",
  INPUT_AMOUNT_NON_POSITIVE = "input amount",
  NO_OUTPUTS = "outputs",
  UNKNOWN_OUTPUT_CHAIN = "output chain",
  OUTPUT_AMOUNT_NON_POSITIVE = "output amount",
  INVALID_OUTPUT_ORACLE = "output oracle",
  INVALID_OUTPUT_SETTLER = "output settler",
  OUTPUT_TOKEN_ZERO = "output token",
  OUTPUT_RECIPIENT_ZERO = "output recipient",
}

function normalize(value: string) {
  return value.toLowerCase();
}

function isZeroBytes32(value: string) {
  return normalize(value) === normalize(BYTES32_ZERO);
}

function pass(): ValidationResult {
  return { passed: true, reason: VALIDATION_PASS_REASON };
}

function fail(reason: string): ValidationResult {
  return { passed: false, reason };
}

function getAllowedInputOracles({
  allowedInputOracles,
  chainId,
  sameChainFill,
}: Readonly<{
  allowedInputOracles: StandardOrderValidationDeps["allowedInputOracles"];
  chainId: bigint;
  sameChainFill: boolean;
}>): string[] | undefined {
  const allowed = allowedInputOracles({ chainId, sameChainFill });
  if (!allowed) return undefined;
  return allowed.map(normalize);
}

function getAllowedOutputOracles({
  allowedOutputOracles,
  ...args
}: Readonly<{
  allowedOutputOracles: StandardOrderValidationDeps["allowedOutputOracles"];
  inputChainId: bigint;
  inputOracle: `0x${string}`;
  outputChainId: bigint;
  sameChainFill: boolean;
}>): string[] | undefined {
  const allowed = allowedOutputOracles(args);
  if (!allowed) return undefined;
  // No implicit COIN_FILLER: it is only a valid output oracle on chains where
  // it is actually deployed (EVM same-chain fills) — consumers must return it
  // explicitly. Injecting it globally let e.g. Tron outputs validate with an
  // EVM-only oracle that can never prove.
  return allowed.map((oracle) => addressToBytes32(oracle)).map(normalize);
}

function getAllowedOutputSettlers(
  allowedOutputSettlers: StandardOrderValidationDeps["allowedOutputSettlers"],
  chainId: bigint,
): string[] {
  return allowedOutputSettlers(chainId)
    .map((settler) => addressToBytes32(settler))
    .map(normalize);
}

/// https://docs.li.fi/lifi-intents/for-solvers/orderflow#order-validation
export function validateOrderWithReason({
  order,
  deps,
}: Readonly<{
  order: StandardOrder;
  deps: StandardOrderValidationDeps;
}>): ValidationResult {
  const {
    allowedInputOracles: resolveInputOracles,
    allowedOutputOracles: resolveOutputOracles,
    allowedOutputSettlers: resolveOutputSettlers,
  } = deps;

  // 1-2. temporal consistency only
  if (order.fillDeadline > order.expires)
    return fail(VALIDATION_ERRORS.FILL_DEADLINE_AFTER_EXPIRES);

  // 3. validation layer
  const sameChainFill = order.outputs.every(
    (output) => output.chainId === order.originChainId,
  );
  const allowedInputOracles = getAllowedInputOracles({
    allowedInputOracles: resolveInputOracles,
    chainId: order.originChainId,
    sameChainFill,
  });
  if (!allowedInputOracles) return fail(VALIDATION_ERRORS.UNKNOWN_ORIGIN_CHAIN);
  if (!allowedInputOracles.includes(normalize(order.inputOracle))) {
    return fail(VALIDATION_ERRORS.INPUT_ORACLE_NOT_ALLOWED);
  }

  // 4. inputs
  if (order.inputs.length === 0) return fail(VALIDATION_ERRORS.NO_INPUTS);
  for (const input of order.inputs) {
    const [, amount] = input;
    if (amount <= 0n) return fail(VALIDATION_ERRORS.INPUT_AMOUNT_NON_POSITIVE);
  }

  // 5. lock ID semantics are not validated yet.
  // TODO: validate lock IDs for escrow/compact compatibility and token mapping.
  // 6. reset period semantics are not validated yet.
  // TODO: decode and validate reset period constraints from lock IDs.
  // 7. allocator ID policy is not validated yet.
  // TODO: enforce allocator policy rules for active environments.
  // 8. claim/signature verification is not validated here.
  // TODO: validate sponsor/allocator signatures when required.

  // 9. outputs
  if (order.outputs.length === 0) return fail(VALIDATION_ERRORS.NO_OUTPUTS);
  for (const output of order.outputs) {
    const allowedOutputOracles = getAllowedOutputOracles({
      allowedOutputOracles: resolveOutputOracles,
      inputChainId: order.originChainId,
      inputOracle: order.inputOracle,
      outputChainId: output.chainId,
      sameChainFill,
    });
    if (!allowedOutputOracles)
      return fail(VALIDATION_ERRORS.UNKNOWN_OUTPUT_CHAIN);
    if (output.amount <= 0n)
      return fail(VALIDATION_ERRORS.OUTPUT_AMOUNT_NON_POSITIVE);
    if (isZeroBytes32(output.oracle))
      return fail(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
    if (!allowedOutputOracles.includes(normalize(output.oracle))) {
      return fail(VALIDATION_ERRORS.INVALID_OUTPUT_ORACLE);
    }
    if (isZeroBytes32(output.settler))
      return fail(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
    const allowedOutputSettlers = getAllowedOutputSettlers(
      resolveOutputSettlers,
      output.chainId,
    );
    if (!allowedOutputSettlers.includes(normalize(output.settler))) {
      return fail(VALIDATION_ERRORS.INVALID_OUTPUT_SETTLER);
    }
    // A zero token is the contracts' encoding for the chain's native asset;
    // it is only valid where the deployment supports native outputs.
    if (
      isZeroBytes32(output.token) &&
      !deps.supportsNativeOutput?.(output.chainId)
    )
      return fail(VALIDATION_ERRORS.OUTPUT_TOKEN_ZERO);
    if (isZeroBytes32(output.recipient))
      return fail(VALIDATION_ERRORS.OUTPUT_RECIPIENT_ZERO);
  }

  // 11. allocatorData is not validated yet.
  // TODO: parse and validate allocatorData.
  // 12. nonce freshness/replay checks require chain state.
  // TODO: validate nonce freshness against chain state.
  return pass();
}

export function validateOrder({
  order,
  deps,
}: Readonly<{
  order: StandardOrder;
  deps: StandardOrderValidationDeps;
}>): boolean {
  return validateOrderWithReason({ order, deps }).passed;
}

export function validateOrderContainerWithReason({
  orderContainer,
  deps,
}: Readonly<{
  orderContainer: OrderContainer;
  deps: OrderContainerValidationDeps;
}>): ValidationResult {
  const inputSettlers = (
    deps.inputSettlers.length > 0
      ? deps.inputSettlers
      : [INPUT_SETTLER_COMPACT_LIFI, MULTICHAIN_INPUT_SETTLER_COMPACT]
  ).map(normalize);
  if (inputSettlers.includes(normalize(orderContainer.inputSettler))) {
    // TODO: implement compact validation from LI.FI orderflow docs.
    return pass();
  }

  if (isStandardOrder(orderContainer.order)) {
    return validateOrderWithReason({
      order: orderContainer.order,
      deps: {
        allowedInputOracles: deps.allowedInputOracles,
        allowedOutputOracles: deps.allowedOutputOracles,
        allowedOutputSettlers: deps.allowedOutputSettlers,
        supportsNativeOutput: deps.supportsNativeOutput,
      },
    });
  }

  return pass();
}

export function validateOrderContainer({
  orderContainer,
  deps,
}: Readonly<{
  orderContainer: OrderContainer;
  deps: OrderContainerValidationDeps;
}>): boolean {
  return validateOrderContainerWithReason({ orderContainer, deps }).passed;
}
