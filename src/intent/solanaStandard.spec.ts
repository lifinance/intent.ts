import { describe, expect, it } from "bun:test";
import { numberToHex } from "viem";
import { SOLANA_INPUT_SETTLER_ESCROW } from "../constants";
import {
  borshEncodeSolanaOrder,
  computeSolanaStandardOrderId,
  SolanaStandardOrderIntent,
  standardOrderToSolanaOrder,
} from "./solanaStandard";
import {
  b32,
  makeMandateOutput,
  makeSolanaStandardOrder,
  makeStandardOrder,
  CHAIN_ID_ARBITRUM,
} from "../../tests/orderFixtures";
import type { SolanaStandardOrder } from "../types";

function expectBytes32Hex(value: `0x${string}`) {
  expect(value.startsWith("0x")).toBe(true);
  expect(value.length).toBe(66);
}

describe("solana standard intent", () => {
  describe("borshEncodeSolanaOrder", () => {
    it("is deterministic", () => {
      const order = makeSolanaStandardOrder();
      const enc1 = borshEncodeSolanaOrder(order);
      const enc2 = borshEncodeSolanaOrder(order);

      expect(enc1).toEqual(enc2);
    });

    it("returns a Uint8Array", () => {
      const order = makeSolanaStandardOrder();
      const encoded = borshEncodeSolanaOrder(order);

      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it("changes when order fields change", () => {
      const base = makeSolanaStandardOrder();
      const baseEnc = borshEncodeSolanaOrder(base);

      const mutations: { name: string; order: SolanaStandardOrder }[] = [
        {
          name: "user",
          order: makeSolanaStandardOrder({
            user: "0x2222222222222222222222222222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          order: makeSolanaStandardOrder({ nonce: base.nonce + 1n }),
        },
        {
          name: "input.amount",
          order: makeSolanaStandardOrder({
            input: { ...base.input, amount: base.input.amount + 1n },
          }),
        },
      ];

      for (const { order } of mutations) {
        expect(borshEncodeSolanaOrder(order)).not.toEqual(baseEnc);
      }
    });
  });

  describe("computeSolanaStandardOrderId", () => {
    it("is deterministic for identical inputs", () => {
      const order = makeSolanaStandardOrder();
      const id1 = computeSolanaStandardOrderId(order);
      const id2 = computeSolanaStandardOrderId(order);

      expect(id1).toBe(id2);
      expectBytes32Hex(id1);
    });

    it("changes when order-id fields change", () => {
      const base = makeSolanaStandardOrder();
      const [baseOutput] = base.outputs;
      if (!baseOutput) throw new Error("Expected base output");
      const baseId = computeSolanaStandardOrderId(base);

      const mutations: { name: string; order: SolanaStandardOrder }[] = [
        {
          name: "user",
          order: makeSolanaStandardOrder({
            user: "0x2222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          order: makeSolanaStandardOrder({ nonce: base.nonce + 1n }),
        },
        {
          name: "originChainId",
          order: makeSolanaStandardOrder({
            originChainId: base.originChainId + 1n,
          }),
        },
        {
          name: "expires",
          order: makeSolanaStandardOrder({ expires: base.expires + 1 }),
        },
        {
          name: "fillDeadline",
          order: makeSolanaStandardOrder({
            fillDeadline: base.fillDeadline + 1,
          }),
        },
        {
          name: "inputOracle",
          order: makeSolanaStandardOrder({
            inputOracle: "0x0000000000000000000000000000000000000001",
          }),
        },
        {
          name: "input.token",
          order: makeSolanaStandardOrder({
            input: { ...base.input, token: b32("b") },
          }),
        },
        {
          name: "input.amount",
          order: makeSolanaStandardOrder({
            input: { ...base.input, amount: base.input.amount + 1n },
          }),
        },
        {
          name: "outputs",
          order: makeSolanaStandardOrder({
            outputs: [{ ...baseOutput, amount: baseOutput.amount + 1n }],
          }),
        },
      ];

      for (const { order } of mutations) {
        expect(computeSolanaStandardOrderId(order)).not.toBe(baseId);
      }
    });
  });

  describe("standardOrderToSolanaOrder", () => {
    it("converts a single-input StandardOrder correctly", () => {
      const std = makeStandardOrder();
      const [firstInput] = std.inputs;
      if (!firstInput) throw new Error("Expected input");
      const [tokenBigInt, amount] = firstInput;

      const solana = standardOrderToSolanaOrder(std);

      expect(solana.user).toBe(std.user);
      expect(solana.nonce).toBe(std.nonce);
      expect(solana.originChainId).toBe(std.originChainId);
      expect(solana.expires).toBe(std.expires);
      expect(solana.fillDeadline).toBe(std.fillDeadline);
      expect(solana.inputOracle).toBe(std.inputOracle);
      expect(solana.outputs).toBe(std.outputs);
      expect(solana.input.token).toBe(numberToHex(tokenBigInt, { size: 32 }));
      expect(solana.input.amount).toBe(amount);
    });

    it("throws when inputs is empty", () => {
      const std = makeStandardOrder({ inputs: [] });

      expect(() => standardOrderToSolanaOrder(std)).toThrow("No inputs in order");
    });

    it("throws when there are multiple inputs", () => {
      const std = makeStandardOrder({ inputs: [[1n, 1n], [2n, 2n]] });

      expect(() => standardOrderToSolanaOrder(std)).toThrow(
        "SolanaStandardOrder only supports a single input",
      );
    });
  });

  describe("SolanaStandardOrderIntent", () => {
    it("returns the original order from asOrder", () => {
      const order = makeSolanaStandardOrder();
      const intent = new SolanaStandardOrderIntent(
        SOLANA_INPUT_SETTLER_ESCROW,
        order,
      );

      expect(intent.asOrder()).toBe(order);
    });

    it("returns the origin chain as the only input chain", () => {
      const order = makeSolanaStandardOrder();
      const intent = new SolanaStandardOrderIntent(
        SOLANA_INPUT_SETTLER_ESCROW,
        order,
      );

      expect(intent.inputChains()).toEqual([order.originChainId]);
    });

    it("computes a deterministic orderId from its current state", () => {
      const order = makeSolanaStandardOrder();
      const intent = new SolanaStandardOrderIntent(
        SOLANA_INPUT_SETTLER_ESCROW,
        order,
      );
      const id1 = intent.orderId();
      const id2 = intent.orderId();

      expect(id1).toBe(id2);
      expect(id1).toBe(computeSolanaStandardOrderId(order));
      expectBytes32Hex(id1);
    });

    it("orderId changes when order fields change", () => {
      const order1 = makeSolanaStandardOrder();
      const order2 = makeSolanaStandardOrder({
        outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM, 999n)],
      });
      const intent1 = new SolanaStandardOrderIntent(
        SOLANA_INPUT_SETTLER_ESCROW,
        order1,
      );
      const intent2 = new SolanaStandardOrderIntent(
        SOLANA_INPUT_SETTLER_ESCROW,
        order2,
      );

      expect(intent1.orderId()).not.toBe(intent2.orderId());
    });
  });
});
