import { describe, expect, it } from "bun:test";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { isStandardOrder, orderToIntent } from ".";
import { MultichainOrderIntent } from "./multichain";
import { StandardOrderIntent } from "./standard";
import {
  CHAIN_ID_ETHEREUM,
  makeMultichainOrder,
  makeStandardOrder,
} from "../../tests/orderFixtures";

describe("intent core split", () => {
  it("hydrates a standard order and keeps orderId deterministic", () => {
    const order = makeStandardOrder({
      originChainId: CHAIN_ID_ETHEREUM,
    });
    const intent = orderToIntent({
      inputSettler: INPUT_SETTLER_ESCROW_LIFI,
      order,
    });

    expect(intent).toBeInstanceOf(StandardOrderIntent);
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

  it("uses originChainId as the standard-vs-multichain discriminator", () => {
    expect(isStandardOrder(makeStandardOrder())).toBe(true);
    expect(isStandardOrder(makeMultichainOrder())).toBe(false);
  });
});
