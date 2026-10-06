import { describe, expect, it } from "bun:test";
import { bytesToHex } from "viem";
import fixture from "../../../tests/vectors/stellarClientOrder.json";
import { stellarStrkeyToBytes32 } from "../../helpers/stellar";
import type { StandardStellar } from "../../types";
import { STELLAR_MAINNET_CHAIN_ID, STELLAR_NETWORK_IDS } from "../../constants";
import { orderToIntent } from "../fromOrder";
import {
  StandardStellarIntent,
  computeStandardStellarId,
  encodeStellarOrder,
  encodeStellarSolves,
  stellarOrderId,
} from "./standard.stellar";

const word = (last: string) => `0x${last.padStart(64, "0")}` as const;

// Decoded from intent-soroban fixtures/client-order.json.
const fixtureOrder = (): StandardStellar => ({
  user: stellarStrkeyToBytes32(
    "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
  ),
  nonce: BigInt(`0x${"07".repeat(32)}`),
  originChainId: 5461068n,
  fillDeadline: 200,
  expires: 300,
  inputOracle: stellarStrkeyToBytes32(
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M",
  ),
  inputs: [
    [
      BigInt(
        stellarStrkeyToBytes32(
          "CDYZSQTM5DF3VHQAHC5VEOL4JFORKO7E6JIK3RQ2QHJIDVJTTLPDSYIQ",
        ),
      ),
      150n,
    ],
  ],
  outputs: [
    {
      amount: 100n,
      callbackData: "0x",
      chainId: 5461068n,
      context: "0x01",
      oracle: word("03"),
      recipient: word("05"),
      settler: `0x${"38".repeat(32)}`,
      token:
        "0xf199426ce8cbba9e0038bb52397c495d153be4f250adc61a81d281d5339ade39",
    },
  ],
});

describe("Stellar order encoding", () => {
  it("matches the intent-soroban client vector byte for byte", () => {
    expect(bytesToHex(encodeStellarOrder(fixtureOrder()))).toBe(
      `0x${fixture.order_xdr}`,
    );
  });

  it("derives the escrow's order id", () => {
    expect(
      stellarOrderId(
        `0x${fixture.network_id}`,
        stellarStrkeyToBytes32(fixture.escrow),
        fixtureOrder(),
      ),
    ).toBe(`0x${fixture.order_id}`);
  });

  it("encodes JSON-rehydrated orders identically", () => {
    const rehydrated = JSON.parse(
      JSON.stringify(fixtureOrder(), (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    expect(bytesToHex(encodeStellarOrder(rehydrated))).toBe(
      `0x${fixture.order_xdr}`,
    );
  });

  it("binds mainnet ids to the Stellar mainnet network id", () => {
    const escrow = stellarStrkeyToBytes32(fixture.escrow);
    const order = {
      ...fixtureOrder(),
      originChainId: STELLAR_MAINNET_CHAIN_ID,
    };
    expect(computeStandardStellarId(escrow, order)).toBe(
      stellarOrderId(
        STELLAR_NETWORK_IDS[STELLAR_MAINNET_CHAIN_ID.toString()]!,
        escrow,
        order,
      ),
    );
    expect(() => computeStandardStellarId(escrow, fixtureOrder())).toThrow(
      "Unsupported Stellar chain id: 5461068",
    );
  });

  it("rejects orders the escrow would reject", () => {
    const order = fixtureOrder();
    expect(() => encodeStellarOrder({ ...order, inputs: [] })).toThrow(
      "1 to 4 inputs",
    );
    expect(() =>
      encodeStellarOrder({
        ...order,
        outputs: Array(5).fill(order.outputs[0]),
      }),
    ).toThrow("1 to 4 outputs");
    expect(() => encodeStellarOrder({ ...order, expires: 2 ** 32 })).toThrow(
      "expires exceeds u32 max",
    );
    expect(() =>
      encodeStellarOrder({ ...order, inputs: [[order.inputs[0]![0], 0n]] }),
    ).toThrow("Input amount must be in 1..2^127-1");
    expect(() =>
      encodeStellarOrder({
        ...order,
        inputs: [[order.inputs[0]![0], 2n ** 127n]],
      }),
    ).toThrow("Input amount must be in 1..2^127-1");
    expect(() =>
      encodeStellarOrder({
        ...order,
        outputs: [{ ...order.outputs[0]!, context: `0x${"00".repeat(257)}` }],
      }),
    ).toThrow("context exceeds 256 bytes");
    expect(() =>
      encodeStellarOrder({
        ...order,
        outputs: [{ ...order.outputs[0]!, recipient: "0x05" }],
      }),
    ).toThrow("output recipient must be exactly 32 bytes");
  });
});

describe("encodeStellarSolves", () => {
  it("encodes a Vec of Solve maps", () => {
    const solver = word("aa");
    expect(bytesToHex(encodeStellarSolves([{ solver, timestamp: 7 }]))).toBe(
      `0x${[
        "00000010" + "00000001" + "00000001", // Vec, 1 item
        "00000011" + "00000001" + "00000002", // Map, 2 entries
        "0000000f" + "00000006" + "736f6c766572" + "0000", // "solver"
        "0000000d" + "00000020" + solver.slice(2), // Bytes(32)
        "0000000f" + "00000009" + "74696d657374616d70" + "000000", // "timestamp"
        "00000003" + "00000007", // U32(7)
      ].join("")}`,
    );
  });
});

describe("orderToIntent", () => {
  it("returns a StandardStellarIntent for the stellar namespace", () => {
    const escrow = stellarStrkeyToBytes32(fixture.escrow);
    const order = {
      ...fixtureOrder(),
      originChainId: STELLAR_MAINNET_CHAIN_ID,
    };
    const intent = orderToIntent({
      namespace: "stellar",
      inputSettler: escrow,
      order,
    });
    expect(intent).toBeInstanceOf(StandardStellarIntent);
    expect(intent.inputChains()).toEqual([STELLAR_MAINNET_CHAIN_ID]);
    expect(intent.orderId()).toBe(computeStandardStellarId(escrow, order));
  });
});
