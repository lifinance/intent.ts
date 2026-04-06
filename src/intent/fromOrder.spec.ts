import { describe, expect, it } from "bun:test";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
  SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
} from "../constants";
import { ResetPeriod } from "../compact/idLib";
import { orderToIntent } from ".";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { StandardSolanaIntent } from "./solana/standard.solana";
import {
  CHAIN_ID_ETHEREUM,
  makeMultichainOrder,
  makeStandardSolana,
  makeStandardEvm,
} from "../../tests/orderFixtures";

describe("intent core split", () => {
  it("hydrates a standard order and keeps orderId deterministic", () => {
    const order = makeStandardEvm({
      originChainId: CHAIN_ID_ETHEREUM,
    });
    const intent = orderToIntent({
      namespace: "eip155",
      inputSettler: INPUT_SETTLER_ESCROW_LIFI,
      order,
    });

    expect(intent).toBeInstanceOf(StandardEVMIntent);
    expect(intent.inputChains()).toEqual([CHAIN_ID_ETHEREUM]);
    expect(intent.orderId()).toBe(intent.orderId());
  });

  it("hydrates a multichain order and computes one shared orderId", () => {
    const intent = orderToIntent({
      namespace: "eip155",
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
      namespace: "eip155",
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
      namespace: "eip155",
      inputSettler: INPUT_SETTLER_COMPACT_LIFI,
      order: makeMultichainOrder(),
      lock: explicitLock,
    });

    expect(intent.lock).toEqual(explicitLock);
  });

  it("hydrates a solana order into StandardSolanaIntent", () => {
    const order = makeStandardSolana();
    const intent = orderToIntent({
      namespace: "solana",
      inputSettler: SOLANA_DEVNET_INPUT_SETTLER_ESCROW!,
      order,
    });

    expect(intent).toBeInstanceOf(StandardSolanaIntent);
    expect(intent.inputSettler).toBe(SOLANA_DEVNET_INPUT_SETTLER_ESCROW);
    expect(intent.orderId()).toBe(intent.orderId());
  });
});
