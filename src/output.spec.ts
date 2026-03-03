import { describe, expect, it } from "bun:test";
import { encodeMandateOutput, getOutputHash } from "./output";
import {
  b32,
  CHAIN_ID_ARBITRUM,
  makeMandateOutput,
} from "../tests/orderFixtures";

const output = makeMandateOutput(CHAIN_ID_ARBITRUM, 1n, { context: "0x00" });

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
