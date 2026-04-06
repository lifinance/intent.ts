import { describe, expect, it } from "bun:test";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { isStandardSolana, orderToIntent } from ".";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import { asStandardIntent } from "./standard";
import {
  CHAIN_ID_ETHEREUM,
  makeMultichainOrder,
  makeStandardSolana,
  makeStandardEvm,
  makeMandateOutput,
  TEST_POLYMER_ORACLE,
  TEST_NOW_SECONDS,
  TEST_USER,
  CHAIN_ID_ARBITRUM,
} from "../../tests/orderFixtures";
import type { StandardOrder } from "../types";

describe("intent core split", () => {
  it("hydrates a standard order and keeps orderId deterministic", () => {
    const order = makeStandardEvm({
      originChainId: CHAIN_ID_ETHEREUM,
    });
    const intent = orderToIntent({
      inputSettler: INPUT_SETTLER_ESCROW_LIFI,
      order,
    });

    expect(intent).toBeInstanceOf(StandardEVMIntent);
    expect(intent.inputChains()).toEqual([CHAIN_ID_ETHEREUM]);
    expect(intent.orderId()).toBe(intent.orderId());
  });

  it("hydrates a multichain order and computes one shared orderId", () => {
    const intent = orderToIntent({
      inputSettler: MULTICHAIN_INPUT_SETTLER_ESCROW,
      order: makeMultichainOrder(),
    });

    expect(intent).toBeInstanceOf(MultichainOrderIntent);
    expect(intent.inputChains().length).toBe(2);
    expect(intent.lock).toEqual({ type: "escrow" });
    const orderId = intent.orderId();
    expect(orderId.startsWith("0x")).toBe(true);
    expect(orderId.length).toBe(66);
  });

  it("infers compact lock for compact settlers", () => {
    const intent = orderToIntent({
      inputSettler: MULTICHAIN_INPUT_SETTLER_COMPACT,
      order: makeMultichainOrder(),
    });

    expect(intent.lock).toEqual({
      type: "compact",
      resetPeriod: ResetPeriod.OneDay,
      allocatorId: "0",
    });
  });

  it("uses explicit lock when provided", () => {
    const explicitLock = {
      type: "compact" as const,
      resetPeriod: ResetPeriod.ThirtyDays,
      allocatorId: "99",
    };

    const intent = orderToIntent({
      inputSettler: INPUT_SETTLER_COMPACT_LIFI,
      order: makeMultichainOrder(),
      lock: explicitLock,
    });

    expect(intent.lock).toEqual(explicitLock);
  });

  it("isStandardSolana returns true only for solana orders", () => {
    expect(isStandardSolana(makeStandardSolana())).toBe(true);
    expect(isStandardSolana(makeStandardEvm())).toBe(false);
    expect(isStandardSolana(makeMultichainOrder())).toBe(false);
  });

  it("hydrates a solana order into StandardSolanaIntent", () => {
    const order = makeStandardSolana();
    const intent = orderToIntent({
      inputSettler: SOLANA_DEVNET_INPUT_SETTLER_ESCROW!,
      order,
    });

    expect(intent).toBeInstanceOf(StandardSolanaIntent);
    expect(intent.inputSettler).toBe(SOLANA_DEVNET_INPUT_SETTLER_ESCROW);
    expect(intent.orderId()).toBe(intent.orderId());
  });

  it("remove me please", () => {
    const myIntent: StandardOrder = {
      user: TEST_USER,
      nonce: 1n,
      originChainId: CHAIN_ID_ETHEREUM,
      expires: TEST_NOW_SECONDS + 1000,
      fillDeadline: TEST_NOW_SECONDS + 900,
      inputOracle: TEST_POLYMER_ORACLE,
      inputs: [[1n, 1n]],
      outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM)],
    };

    asStandardIntent;

    const solanaintent = asStandardIntent({
      namespace: "solana",
      order: myIntent,
      inputSettler: "0x",
    });
    const evmintent = asStandardIntent({
      namespace: "eip155",
      order: myIntent,
      inputSettler: "0x",
    });

    evmintent.compactClaimHash;

    solanaintent.borshEncode;
  });
});
