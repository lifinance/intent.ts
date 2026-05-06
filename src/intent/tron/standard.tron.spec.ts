import { describe, expect, it } from "bun:test";

import { TRON_MAINNET_INPUT_SETTLER } from "../../constants";
import {
  computeStandardTronId,
  StandardTronIntent,
  standardOrderToTronOrder,
} from "./standard.tron";
import {
  b32,
  makeMandateOutput,
  makeStandardTron,
  makeStandardEvm,
  CHAIN_ID_ARBITRUM,
} from "../../../tests/orderFixtures";
import type { StandardTron } from "../../types";

function expectBytes32Hex(value: `0x${string}`) {
  expect(value.startsWith("0x")).toBe(true);
  expect(value.length).toBe(66);
}

describe("tron standard intent", () => {
  describe("computeStandardTronId", () => {
    it("is deterministic for identical inputs", () => {
      const order = makeStandardTron();
      const id1 = computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, order);
      const id2 = computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, order);

      expect(id1).toBe(id2);
      expectBytes32Hex(id1);
    });

    it("changes when order-id fields change", () => {
      const base = makeStandardTron();
      const [baseOutput] = base.outputs;
      if (!baseOutput) throw new Error("Expected base output");
      const baseId = computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, base);

      const mutations: { name: string; order: StandardTron }[] = [
        {
          name: "user",
          order: makeStandardTron({
            user: "0x2222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          order: makeStandardTron({ nonce: base.nonce + 1n }),
        },
        {
          name: "originChainId",
          order: makeStandardTron({
            originChainId: base.originChainId + 1n,
          }),
        },
        {
          name: "expires",
          order: makeStandardTron({ expires: base.expires + 1 }),
        },
        {
          name: "fillDeadline",
          order: makeStandardTron({
            fillDeadline: base.fillDeadline + 1,
          }),
        },
        {
          name: "inputOracle",
          order: makeStandardTron({
            inputOracle: "0x0000000000000000000000000000000000000001",
          }),
        },
        {
          name: "inputs[0].token",
          order: makeStandardTron({
            inputs: [[BigInt(b32("b")), base.inputs[0]![1]]],
          }),
        },
        {
          name: "inputs[0].amount",
          order: makeStandardTron({
            inputs: [[base.inputs[0]![0], base.inputs[0]![1] + 1n]],
          }),
        },
        {
          name: "outputs",
          order: makeStandardTron({
            outputs: [{ ...baseOutput, amount: baseOutput.amount + 1n }],
          }),
        },
      ];

      for (const { order } of mutations) {
        expect(
          computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, order),
        ).not.toBe(baseId);
      }
    });

    it("changes when inputSettler changes", () => {
      const order = makeStandardTron();
      const id1 = computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, order);
      const id2 = computeStandardTronId(
        "0x0000000000000000000000000000000000000001",
        order,
      );

      expect(id1).not.toBe(id2);
    });
  });

  describe("standardOrderToTronOrder", () => {
    it("converts a StandardOrder correctly", () => {
      const std = makeStandardEvm();
      const tron = standardOrderToTronOrder(std);

      expect(tron.user).toBe(std.user);
      expect(tron.nonce).toBe(std.nonce);
      expect(tron.originChainId).toBe(std.originChainId);
      expect(tron.expires).toBe(std.expires);
      expect(tron.fillDeadline).toBe(std.fillDeadline);
      expect(tron.inputOracle).toBe(std.inputOracle);
      expect(tron.outputs).toBe(std.outputs);
      expect(tron.inputs).toEqual(std.inputs);
    });
  });

  describe("StandardTronIntent", () => {
    it("returns the original order from asOrder", () => {
      const order = makeStandardTron();
      const intent = new StandardTronIntent(TRON_MAINNET_INPUT_SETTLER, order);

      expect(intent.asOrder()).toBe(order);
    });

    it("returns the origin chain as the only input chain", () => {
      const order = makeStandardTron();
      const intent = new StandardTronIntent(TRON_MAINNET_INPUT_SETTLER, order);

      expect(intent.inputChains()).toEqual([order.originChainId]);
    });

    it("has namespace set to tron", () => {
      const order = makeStandardTron();
      const intent = new StandardTronIntent(TRON_MAINNET_INPUT_SETTLER, order);

      expect(intent.namespace).toBe("tron");
    });

    it("computes a deterministic orderId from its current state", () => {
      const order = makeStandardTron();
      const intent = new StandardTronIntent(TRON_MAINNET_INPUT_SETTLER, order);
      const id1 = intent.orderId();
      const id2 = intent.orderId();

      expect(id1).toBe(id2);
      expect(id1).toBe(
        computeStandardTronId(TRON_MAINNET_INPUT_SETTLER, order),
      );
      expectBytes32Hex(id1);
    });

    it("orderId changes when order fields change", () => {
      const order1 = makeStandardTron();
      const order2 = makeStandardTron({
        outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM, 999n)],
      });
      const intent1 = new StandardTronIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order1,
      );
      const intent2 = new StandardTronIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order2,
      );

      expect(intent1.orderId()).not.toBe(intent2.orderId());
    });
  });
});
