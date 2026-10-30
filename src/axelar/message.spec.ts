import { describe, expect, it } from "bun:test";
import vectors from "../../tests/vectors/axelarClientVectors.json";
import { bytesToHex } from "viem";
import {
  type AxelarMessage,
  axelarMessageHash,
  checkAxelarChainName,
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
      checkMessageBounds({ ...message, destination_chain: "é".repeat(16) }),
    ).not.toThrow();
    expect(() =>
      checkMessageBounds({ ...message, destination_chain: "é".repeat(17) }),
    ).toThrow();
  });
});

// Shared EVM reference vectors (lifi-oif `AxelarStrings.address.t.sol` and
// `AxelarStrings.chainName.t.sol`), identical on Stellar and Solana.
describe("EVM AxelarStrings reference vectors", () => {
  it("decodes addresses by format", () => {
    const accepted: [string, string][] = [
      ["11111111111111111111111111111111", "00".repeat(32)],
      ["11111111111111111111111111111112", `${"00".repeat(31)}01`],
      ["13cpvoZKJ28f1CDBboEmfEXMVVMcSQzBhTEMtecGWQ6v", `00${"ab".repeat(31)}`],
      ["JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG", "ff".repeat(32)],
      [
        "ComputeBudget111111111111111111111111111111",
        "0306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000",
      ],
      [
        "Ed25519SigVerify111111111111111111111111111",
        "037d46d67c93fbbe12f9428f838d40ff0570744927f48a64fcca704480000000",
      ],
      [
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        "00".repeat(32),
      ],
      [
        "0xABCDEF0123456789abcdef0123456789ABCDEF01",
        `${"00".repeat(12)}abcdef0123456789abcdef0123456789abcdef01`,
      ],
    ];
    for (const [address, id] of accepted)
      expect(bytesToHex(decodeAxelarAddress(address))).toBe(`0x${id}`);
    for (const address of [
      "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofL",
      "111111111111111111111111111111111",
      "0EKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG",
      "1JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "",
      `0x${"0".repeat(39)}`,
      `0x${"0".repeat(39)}g`,
      `0x${"A".repeat(54)}`,
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    ])
      expect(() => decodeAxelarAddress(address)).toThrow();
  });

  it("admits owner chain-map names", () => {
    for (const name of ["ethereum", "0123456789-.:/ !~", "a".repeat(20)])
      expect(() => checkAxelarChainName(name)).not.toThrow();
    for (const name of [
      "Ethereum",
      "",
      "a".repeat(21),
      "ba\0se",
      "x\u{e9}",
      "st_ellar",
      "_",
    ])
      expect(() => checkAxelarChainName(name)).toThrow(
        /^Axelar chain name must be 1-20 ASCII bytes without NUL, _ or ASCII uppercase$/,
      );
  });
});
