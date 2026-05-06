import { describe, expect, it } from "bun:test";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
} from "../../constants";
import { compactClaimHash as computeCompactClaimHash } from "../compact/claims";
import { toStandardBatchCompact } from "../compact/conversions";
import { computeStandardEVMId, StandardEVMIntent } from "./standard.evm";
import {
  makeStandardEvm,
  makeStandardTron,
} from "../../../tests/orderFixtures";
import { TRON_MAINNET_INPUT_SETTLER } from "../../constants";
import type { StandardOrder } from "../../types";

function expectBytes32Hex(value: `0x${string}`) {
  expect(value.startsWith("0x")).toBe(true);
  expect(value.length).toBe(66);
}

describe("standard intent", () => {
  describe("computeStandardEVMId", () => {
    it("is deterministic for identical inputs", () => {
      const order = makeStandardEvm();
      const id1 = computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, order);
      const id2 = computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, order);

      expect(id1).toBe(id2);
      expectBytes32Hex(id1);
    });

    it("changes when inputSettler changes", () => {
      const order = makeStandardEvm();
      const id1 = computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, order);
      const id2 = computeStandardEVMId(INPUT_SETTLER_COMPACT_LIFI, order);

      expect(id1).not.toBe(id2);
    });

    it("changes when order-id fields change", () => {
      const baseOrder = makeStandardEvm();
      const [firstInput] = baseOrder.inputs;
      const [firstOutput] = baseOrder.outputs;
      if (!firstInput || !firstOutput)
        throw new Error("Expected standard order inputs and outputs");
      const baseId = computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, baseOrder);

      const mutations: {
        name: string;
        mutate: (order: StandardOrder) => StandardOrder;
      }[] = [
        {
          name: "originChainId",
          mutate: (order) => ({
            ...order,
            originChainId: order.originChainId + 1n,
          }),
        },
        {
          name: "user",
          mutate: (order) => ({
            ...order,
            user: "0x2222222222222222222222222222222222222222",
          }),
        },
        {
          name: "nonce",
          mutate: (order) => ({
            ...order,
            nonce: order.nonce + 1n,
          }),
        },
        {
          name: "expires",
          mutate: (order) => ({
            ...order,
            expires: order.expires + 1,
          }),
        },
        {
          name: "fillDeadline",
          mutate: (order) => ({
            ...order,
            fillDeadline: order.fillDeadline + 1,
          }),
        },
        {
          name: "inputOracle",
          mutate: (order) => ({
            ...order,
            inputOracle: "0x0000000000000000000000000000000000000001",
          }),
        },
        {
          name: "inputs",
          mutate: (order) => ({
            ...order,
            inputs: [[firstInput[0], firstInput[1] + 1n]],
          }),
        },
        {
          name: "outputs",
          mutate: (order) => ({
            ...order,
            outputs: [{ ...firstOutput, amount: firstOutput.amount + 1n }],
          }),
        },
      ];

      for (const mutation of mutations) {
        const mutatedOrder = mutation.mutate(baseOrder);
        const mutatedId = computeStandardEVMId(
          INPUT_SETTLER_ESCROW_LIFI,
          mutatedOrder,
        );
        expect(mutatedId).not.toBe(baseId);
      }
    });
  });

  describe("Tron order ID", () => {
    it("is deterministic for identical Tron inputs", () => {
      const order = makeStandardTron();
      const id1 = computeStandardEVMId(TRON_MAINNET_INPUT_SETTLER, order);
      const id2 = computeStandardEVMId(TRON_MAINNET_INPUT_SETTLER, order);

      expect(id1).toBe(id2);
      expectBytes32Hex(id1);
    });

    it("differs from EVM order ID with same fields but different settler", () => {
      const order = makeStandardTron();
      const tronId = computeStandardEVMId(TRON_MAINNET_INPUT_SETTLER, order);
      const evmId = computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, order);

      expect(tronId).not.toBe(evmId);
    });

    it("changes when Tron order fields change", () => {
      const baseOrder = makeStandardTron();
      const baseId = computeStandardEVMId(
        TRON_MAINNET_INPUT_SETTLER,
        baseOrder,
      );
      const mutated = makeStandardTron({ nonce: baseOrder.nonce + 1n });
      const mutatedId = computeStandardEVMId(
        TRON_MAINNET_INPUT_SETTLER,
        mutated,
      );

      expect(mutatedId).not.toBe(baseId);
    });
  });

  describe("StandardEVMIntent with tron namespace", () => {
    it("reports tron namespace", () => {
      const order = makeStandardTron();
      const intent = new StandardEVMIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order,
        "tron",
      );

      expect(intent.namespace).toBe("tron");
      expect(intent.inputSettler).toBe(TRON_MAINNET_INPUT_SETTLER);
    });

    it("computes orderId using the tron settler", () => {
      const order = makeStandardTron();
      const intent = new StandardEVMIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order,
        "tron",
      );

      expect(intent.orderId()).toBe(
        computeStandardEVMId(TRON_MAINNET_INPUT_SETTLER, order),
      );
      expectBytes32Hex(intent.orderId());
    });

    it("returns tron origin chain as the only input chain", () => {
      const order = makeStandardTron();
      const intent = new StandardEVMIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order,
        "tron",
      );

      expect(intent.inputChains()).toEqual([order.originChainId]);
    });

    it("throws on asBatchCompact for tron namespace", () => {
      const order = makeStandardTron();
      const intent = new StandardEVMIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order,
        "tron",
      );

      expect(() => intent.asBatchCompact()).toThrow(
        'asBatchCompact is not supported for namespace "tron"',
      );
    });

    it("throws on compactClaimHash for tron namespace", () => {
      const order = makeStandardTron();
      const intent = new StandardEVMIntent(
        TRON_MAINNET_INPUT_SETTLER,
        order,
        "tron",
      );

      expect(() => intent.compactClaimHash()).toThrow(
        'compactClaimHash is not supported for namespace "tron"',
      );
    });
  });

  describe("StandardEVMIntent", () => {
    it("returns the original order from asOrder", () => {
      const order = makeStandardEvm();
      const intent = new StandardEVMIntent(INPUT_SETTLER_ESCROW_LIFI, order);

      expect(intent.asOrder()).toBe(order);
    });

    it("returns the origin chain as the only input chain", () => {
      const order = makeStandardEvm();
      const intent = new StandardEVMIntent(INPUT_SETTLER_ESCROW_LIFI, order);

      expect(intent.inputChains()).toEqual([order.originChainId]);
    });

    it("computes a deterministic orderId from its current state", () => {
      const order = makeStandardEvm();
      const intent = new StandardEVMIntent(INPUT_SETTLER_ESCROW_LIFI, order);
      const id1 = intent.orderId();
      const id2 = intent.orderId();

      expect(id1).toBe(id2);
      expect(id1).toBe(computeStandardEVMId(INPUT_SETTLER_ESCROW_LIFI, order));
      expectBytes32Hex(id1);
    });

    it("asBatchCompact maps order fields and uses compact arbiter constant", () => {
      const order = makeStandardEvm();
      const intent = new StandardEVMIntent(INPUT_SETTLER_ESCROW_LIFI, order);
      const batch = intent.asBatchCompact();
      const expected = toStandardBatchCompact(
        order,
        INPUT_SETTLER_COMPACT_LIFI,
      );

      expect(batch).toEqual(expected);
      expect(batch.arbiter).toBe(INPUT_SETTLER_COMPACT_LIFI);
    });

    it("compactClaimHash matches claim hash of asBatchCompact and is deterministic", () => {
      const order = makeStandardEvm();
      const intent = new StandardEVMIntent(INPUT_SETTLER_ESCROW_LIFI, order);
      const claimHash1 = intent.compactClaimHash();
      const claimHash2 = intent.compactClaimHash();
      const expected = computeCompactClaimHash(intent.asBatchCompact());

      expect(claimHash1).toBe(claimHash2);
      expect(claimHash1).toBe(expected);
      expectBytes32Hex(claimHash1);
    });

    it("compactClaimHash changes when commitments or mandate fields change", () => {
      const baseOrder = makeStandardEvm();
      const [baseOutput] = baseOrder.outputs;
      if (!baseOutput) throw new Error("Expected standard order output");
      const baseIntent = new StandardEVMIntent(
        INPUT_SETTLER_ESCROW_LIFI,
        baseOrder,
      );
      const changedIntent = new StandardEVMIntent(
        INPUT_SETTLER_ESCROW_LIFI,
        makeStandardEvm({
          outputs: [
            {
              ...baseOutput,
              amount: baseOutput.amount + 1n,
            },
          ],
        }),
      );

      expect(changedIntent.compactClaimHash()).not.toBe(
        baseIntent.compactClaimHash(),
      );
    });
  });
});
