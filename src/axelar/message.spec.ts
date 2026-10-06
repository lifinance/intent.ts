import { describe, expect, it } from "bun:test";
import vectors from "../../tests/vectors/axelarClientVectors.json";
import {
  type AxelarMessage,
  axelarMessageHash,
  checkMessageBounds,
  decodeAxelarAddress,
} from "./message";

const receive = vectors.find((v) => v.name === "receive from stellar")!;
const message = receive.request.message as AxelarMessage;

describe("axelarMessageHash", () => {
  it("matches solana-axelar-std and binds every field", () => {
    expect(axelarMessageHash(message).slice(2)).toBe(
      (receive.result as { messageHash: string }).messageHash,
    );
    expect(
      axelarMessageHash({
        ...message,
        destination_address: message.destination_address.toLowerCase(),
      }),
    ).not.toBe(axelarMessageHash(message));
  });
});

describe("checkMessageBounds", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(() =>
      checkMessageBounds({ ...message, destination_chain: "é".repeat(10) }),
    ).not.toThrow();
    expect(() =>
      checkMessageBounds({ ...message, destination_chain: "é".repeat(11) }),
    ).toThrow();
  });
});

describe("decodeAxelarAddress", () => {
  it("left-pads EVM addresses and validates Stellar checksums", () => {
    const evm = decodeAxelarAddress(`0x${"Ab".repeat(20)}`, "evm");
    expect([...evm.subarray(0, 12)]).toEqual(Array(12).fill(0));
    expect(evm[12]).toBe(0xab);
    expect(decodeAxelarAddress(message.source_address, "stellar")).toEqual(
      new Uint8Array(32).fill(5),
    );
    const corrupt = `${message.source_address.slice(0, -1)}${message.source_address.endsWith("A") ? "B" : "A"}`;
    expect(() => decodeAxelarAddress(corrupt, "stellar")).toThrow();
    expect(() => decodeAxelarAddress("0x1234", "evm")).toThrow();
  });
});
