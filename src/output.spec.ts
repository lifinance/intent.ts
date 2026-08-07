import { describe, expect, it } from "bun:test";
import { keccak256, toHex } from "viem";
import {
  encodeFillDescription,
  encodeMandateOutput,
  encodeNotFilledDescription,
  FILL_MAGIC,
  getFillDescriptionHash,
  getNotFilledDescriptionHash,
  getOutputHash,
  NOT_FILLED_MAGIC,
} from "./output";
import { BYTES32_ZERO } from "./constants";
import {
  b32,
  CHAIN_ID_ARBITRUM,
  makeMandateOutput,
} from "../tests/orderFixtures";
import rawVectors from "../tests/vectors/fillPayloadVectors.json";

const output = makeMandateOutput(CHAIN_ID_ARBITRUM, 1n, { context: "0x00" });

type CommonVector = {
  name: string;
  orderId: `0x${string}`;
  token: `0x${string}`;
  amount: string;
  recipient: `0x${string}`;
  callbackData: `0x${string}`;
  context: `0x${string}`;
  payload: `0x${string}`;
  payloadLength: number;
  payloadHash: `0x${string}`;
};

type FillVector = CommonVector & {
  kind: "fill";
  solver: `0x${string}`;
  timestamp: number;
};

type NotFilledVector = CommonVector & {
  kind: "notFilled";
  fillDeadline: number;
};

type Vector = FillVector | NotFilledVector;

const fillPayloadVectors = rawVectors as unknown as {
  fillMagic: `0x${string}`;
  notFilledMagic: `0x${string}`;
  vectors: Vector[];
};

const vectorOutput = (vector: Vector) =>
  makeMandateOutput(CHAIN_ID_ARBITRUM, BigInt(vector.amount), {
    // Only the common payload participates in the proof payloads; oracle,
    // settler and chainId are part of the MandateOutput identity hash instead.
    oracle: BYTES32_ZERO,
    settler: BYTES32_ZERO,
    token: vector.token,
    recipient: vector.recipient,
    callbackData: vector.callbackData,
    context: vector.context,
  });

describe("output", () => {
  it("produces stable output hashes", () => {
    const h1 = getOutputHash(output);
    const h2 = getOutputHash(output);
    expect(h1).toBe(h2);
  });

  it("changes hash when output amount changes", () => {
    const h1 = getOutputHash(output);
    const h2 = getOutputHash({ ...output, amount: output.amount + 1n });
    expect(h1).not.toBe(h2);
  });

  it("encodes mandate output deterministically", () => {
    const solver = b32("1");
    const orderId = b32("2");
    const encoded1 = encodeMandateOutput({
      solver,
      orderId,
      timestamp: 1234,
      output,
    });
    const encoded2 = encodeMandateOutput({
      solver,
      orderId,
      timestamp: 1234,
      output,
    });

    expect(encoded1).toBe(encoded2);
    expect(encoded1.startsWith("0x")).toBe(true);
  });
});

describe("proof payload domain magics", () => {
  it("derives from the OIF domain strings", () => {
    expect(keccak256(toHex("OIF.Fill")).slice(0, 10)).toBe(FILL_MAGIC);
    expect(keccak256(toHex("OIF.NotFilled")).slice(0, 10)).toBe(
      NOT_FILLED_MAGIC,
    );
  });

  it("matches the magics the Solidity vectors were generated with", () => {
    expect(fillPayloadVectors.fillMagic.slice(0, 10)).toBe(FILL_MAGIC);
    expect(fillPayloadVectors.notFilledMagic.slice(0, 10)).toBe(
      NOT_FILLED_MAGIC,
    );
  });

  it("leads the fill and not-filled payloads", () => {
    expect(
      encodeFillDescription({
        solver: b32("1"),
        orderId: b32("2"),
        timestamp: 1234,
        output,
      }).slice(0, 10),
    ).toBe(FILL_MAGIC);
    expect(
      encodeNotFilledDescription({
        orderId: b32("2"),
        fillDeadline: 1234,
        output,
      }).slice(0, 10),
    ).toBe(NOT_FILLED_MAGIC);
  });

  it("keeps the MandateOutput identity hash untagged", () => {
    // getOutputHash hashes the struct preimage, which starts at `oracle` and
    // carries no magic — a magic there would break output identification.
    expect(getOutputHash(output)).not.toBe(
      keccak256(
        encodeFillDescription({
          solver: b32("1"),
          orderId: b32("2"),
          timestamp: 1234,
          output,
        }),
      ),
    );
  });
});

// Golden vectors generated from the Solidity MandateOutputEncodingLib
// (lifi-oif test/util/GenerateFillPayloadVectors.t.sol), pinned against both
// the calldata and memory hashers.
describe("fill payload golden vectors", () => {
  const fills = fillPayloadVectors.vectors.filter(
    (v): v is FillVector => v.kind === "fill",
  );
  const notFilled = fillPayloadVectors.vectors.filter(
    (v): v is NotFilledVector => v.kind === "notFilled",
  );

  it("covers both payload kinds", () => {
    expect(fills.length).toBeGreaterThan(0);
    expect(notFilled.length).toBeGreaterThan(0);
    expect(fills.length + notFilled.length).toBe(
      fillPayloadVectors.vectors.length,
    );
  });

  for (const vector of fills) {
    it(`reproduces ${vector.name}`, () => {
      const args = {
        solver: vector.solver,
        orderId: vector.orderId,
        timestamp: vector.timestamp,
        output: vectorOutput(vector),
      };
      const payload = encodeFillDescription(args);

      expect(payload).toBe(vector.payload);
      expect((payload.length - 2) / 2).toBe(vector.payloadLength);
      expect(getFillDescriptionHash(args)).toBe(vector.payloadHash);
      expect(encodeMandateOutput(args)).toBe(vector.payload);
    });
  }

  for (const vector of notFilled) {
    it(`reproduces ${vector.name}`, () => {
      const args = {
        orderId: vector.orderId,
        fillDeadline: vector.fillDeadline,
        output: vectorOutput(vector),
      };
      const payload = encodeNotFilledDescription(args);

      expect(payload).toBe(vector.payload);
      expect((payload.length - 2) / 2).toBe(vector.payloadLength);
      expect(getNotFilledDescriptionHash(args)).toBe(vector.payloadHash);
    });
  }
});
