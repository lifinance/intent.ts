import { describe, expect, it } from "bun:test";

import { SOLANA_DEVNET_INPUT_SETTLER_ESCROW } from "../constants";
import {
  borshEncodeSolanaOrder,
  computeStandardSolanaId,
  StandardSolanaIntent,
  standardOrderToSolanaOrder,
} from "./solanaStandard";
import {
  b32,
  makeMandateOutput,
  makeStandardSolana,
  makeStandardOrder,
  CHAIN_ID_ARBITRUM,
} from "../../tests/orderFixtures";
import type { StandardSolana } from "../types";

function expectBytes32Hex(value: `0x${string}`) {
  expect(value.startsWith("0x")).toBe(true);
  expect(value.length).toBe(66);
}

describe("solana standard intent", () => {
  describe("borshEncodeSolanaOrder u32 overflow guards", () => {
    const U32_MAX = 4_294_967_295;

    it("throws when expires exceeds u32 max", () => {
      const order = makeStandardSolana({ expires: U32_MAX + 1 });
      expect(() => borshEncodeSolanaOrder(order)).toThrow("expires exceeds u32 max");
    });

    it("throws when fillDeadline exceeds u32 max", () => {
      const order = makeStandardSolana({ fillDeadline: U32_MAX + 1 });
      expect(() => borshEncodeSolanaOrder(order)).toThrow("fillDeadline exceeds u32 max");
    });

    it("accepts values at the u32 boundary", () => {
      const order = makeStandardSolana({ expires: U32_MAX, fillDeadline: U32_MAX });
      expect(() => borshEncodeSolanaOrder(order)).not.toThrow();
    });
  });

  describe("borshEncodeSolanaOrder golden value", () => {
    // This test locks in the exact byte sequence produced for the canonical
    // fixture order. Any change to field ordering, endianness, or schema will
    // cause this to fail immediately, catching silent encoding regressions.
    it("produces the expected byte sequence for the canonical fixture order", () => {
      const EXPECTED_HEX =
        "000000000000000000000000111111111111111111111111111111111111111101000000000000000000000000000000c00116efed1604000000000000000000e8f4536584f453650000000000000000000000000000003e06000007a224aee90052fa6bb46d43c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa40420f0000000000010000000000000000000000000000000000000000ec36b683c2e6ac89e9a75989c22a2e0000000000000000000000000000000000ec36b683c2e6ac89e9a75989c22a2e000000000000000000000000000000000000000000000000000000000000a4b13333333333333333333333333333333333333333333333333333333333333333000000000000000000000000000000000000000000000000000000000000000144444444444444444444444444444444444444444444444444444444444444440000000000000000";
      const order = makeStandardSolana();
      const encoded = borshEncodeSolanaOrder(order);
      expect(Buffer.from(encoded).toString("hex")).toBe(EXPECTED_HEX);
    });

    it("produces the expected order ID for the canonical fixture order", () => {
      const EXPECTED_ID =
        "0x580af79489452e37c49422ff18831a6260e6dd4b3f860e94f2bf39287ce48b5e";
      expect(computeStandardSolanaId(makeStandardSolana())).toBe(EXPECTED_ID);
    });
  });

  describe("borshEncodeSolanaOrder", () => {
    it("is deterministic", () => {
      const order = makeStandardSolana();
      const enc1 = borshEncodeSolanaOrder(order);
      const enc2 = borshEncodeSolanaOrder(order);

      expect(enc1).toEqual(enc2);
    });

    it("returns a Uint8Array", () => {
      const order = makeStandardSolana();
      const encoded = borshEncodeSolanaOrder(order);

      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it("changes when order fields change", () => {
      const base = makeStandardSolana();
      const baseEnc = borshEncodeSolanaOrder(base);

      const mutations: { name: string; order: StandardSolana }[] = [
        {
          name: "user",
          order: makeStandardSolana({
            user: "0x2222222222222222222222222222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          order: makeStandardSolana({ nonce: base.nonce + 1n }),
        },
        {
          name: "inputs[0].amount",
          order: makeStandardSolana({
            inputs: [[base.inputs[0][0], base.inputs[0][1] + 1n]],
          }),
        },
      ];

      for (const { order } of mutations) {
        expect(borshEncodeSolanaOrder(order)).not.toEqual(baseEnc);
      }
    });
  });

  describe("computeStandardSolanaId", () => {
    it("is deterministic for identical inputs", () => {
      const order = makeStandardSolana();
      const id1 = computeStandardSolanaId(order);
      const id2 = computeStandardSolanaId(order);

      expect(id1).toBe(id2);
      expectBytes32Hex(id1);
    });

    it("changes when order-id fields change", () => {
      const base = makeStandardSolana();
      const [baseOutput] = base.outputs;
      if (!baseOutput) throw new Error("Expected base output");
      const baseId = computeStandardSolanaId(base);

      const mutations: { name: string; order: StandardSolana }[] = [
        {
          name: "user",
          order: makeStandardSolana({
            user: "0x2222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          order: makeStandardSolana({ nonce: base.nonce + 1n }),
        },
        {
          name: "originChainId",
          order: makeStandardSolana({
            originChainId: base.originChainId + 1n,
          }),
        },
        {
          name: "expires",
          order: makeStandardSolana({ expires: base.expires + 1 }),
        },
        {
          name: "fillDeadline",
          order: makeStandardSolana({
            fillDeadline: base.fillDeadline + 1,
          }),
        },
        {
          name: "inputOracle",
          order: makeStandardSolana({
            inputOracle: "0x0000000000000000000000000000000000000001",
          }),
        },
        {
          name: "inputs[0].token",
          order: makeStandardSolana({
            inputs: [[BigInt(b32("b")), base.inputs[0][1]]],
          }),
        },
        {
          name: "inputs[0].amount",
          order: makeStandardSolana({
            inputs: [[base.inputs[0][0], base.inputs[0][1] + 1n]],
          }),
        },
        {
          name: "outputs",
          order: makeStandardSolana({
            outputs: [{ ...baseOutput, amount: baseOutput.amount + 1n }],
          }),
        },
      ];

      for (const { order } of mutations) {
        expect(computeStandardSolanaId(order)).not.toBe(baseId);
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
      expect(solana.inputs[0][0]).toBe(tokenBigInt);
      expect(solana.inputs[0][1]).toBe(amount);
    });

    it("throws when inputs is empty", () => {
      const std = makeStandardOrder({ inputs: [] });

      expect(() => standardOrderToSolanaOrder(std)).toThrow("No inputs in order");
    });

    it("throws when there are multiple inputs", () => {
      const std = makeStandardOrder({ inputs: [[1n, 1n], [2n, 2n]] });

      expect(() => standardOrderToSolanaOrder(std)).toThrow(
        "StandardSolana only supports a single input",
      );
    });
  });

  describe("StandardSolanaIntent", () => {
    it("returns the original order from asOrder", () => {
      const order = makeStandardSolana();
      const intent = new StandardSolanaIntent(
        SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
        order,
      );

      expect(intent.asOrder()).toBe(order);
    });

    it("returns the origin chain as the only input chain", () => {
      const order = makeStandardSolana();
      const intent = new StandardSolanaIntent(
        SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
        order,
      );

      expect(intent.inputChain()).toEqual(order.originChainId);
    });

    it("computes a deterministic orderId from its current state", () => {
      const order = makeStandardSolana();
      const intent = new StandardSolanaIntent(
        SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
        order,
      );
      const id1 = intent.orderId();
      const id2 = intent.orderId();

      expect(id1).toBe(id2);
      expect(id1).toBe(computeStandardSolanaId(order));
      expectBytes32Hex(id1);
    });

    it("orderId changes when order fields change", () => {
      const order1 = makeStandardSolana();
      const order2 = makeStandardSolana({
        outputs: [makeMandateOutput(CHAIN_ID_ARBITRUM, 999n)],
      });
      const intent1 = new StandardSolanaIntent(
        SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
        order1,
      );
      const intent2 = new StandardSolanaIntent(
        SOLANA_DEVNET_INPUT_SETTLER_ESCROW,
        order2,
      );

      expect(intent1.orderId()).not.toBe(intent2.orderId());
    });
  });
});
