import { describe, expect, it } from "bun:test";
import { decodeAbiParameters, encodePacked, parseAbiParameters } from "viem";
import {
  COIN_FILLER,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_DEVNET_OUTPUT_SETTLER_PDA,
  SOLANA_MAINNET_CHAIN_ID,
} from "../../constants";
import { addressToBytes32 } from "../../helpers/convert";
import type { TokenContext } from "../../types";
import { buildMandateOutputs, encodeOutputs } from "./output-encoding";

const outputTokens: TokenContext[] = [
  {
    token: {
      address: "0x3333333333333333333333333333333333333333",
      name: "USDC",
      chainId: 42161n,
      decimals: 6,
      chainNameSpace: "eip155",
    },
    amount: 1_000_000n,
  },
];

describe("output encoding helpers", () => {
  it("encodes outputs with stable ABI serialization", () => {
    const output = buildMandateOutputs({
      exclusiveFor: "0x0000000000000000000000000000000000000000",
      outputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      sameChain: false,
      recipient: "0x0000000000000000000000001111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const encoded = encodeOutputs(output);
    const [decoded] = decodeAbiParameters(
      parseAbiParameters(
        "(bytes32 oracle, bytes32 settler, uint256 chainId, bytes32 token, uint256 amount, bytes32 recipient, bytes callbackData, bytes context)[]",
      ),
      encoded,
    ) as [
      Array<{
        oracle: `0x${string}`;
        settler: `0x${string}`;
        chainId: bigint;
        token: `0x${string}`;
        amount: bigint;
        recipient: `0x${string}`;
        callbackData: `0x${string}`;
        context: `0x${string}`;
      }>,
    ];
    const [first] = decoded;
    if (!first) throw new Error("Expected one decoded output");

    expect(encoded.startsWith("0x")).toBe(true);
    expect(first.chainId).toBe(42161n);
    expect(first.amount).toBe(1_000_000n);
  });

  it("uses COIN_FILLER as output oracle for same-chain intents", () => {
    const output = buildMandateOutputs({
      exclusiveFor: "0x0000000000000000000000000000000000000000",
      outputTokens,
      getOracle() {
        throw new Error("getOracle should not be called for same-chain output");
      },
      verifier: "polymer",
      sameChain: true,
      recipient: "0x1111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.oracle).toBe(addressToBytes32(COIN_FILLER));
    expect(first.settler).toBe(addressToBytes32(COIN_FILLER));
    expect(first.context).toBe(
      encodePacked(
        ["bytes1", "bytes32", "uint32"],
        ["0xe0", `0x${"0".repeat(64)}`, 1_700_000_060],
      ),
    );
  });

  it("uses oracle resolver and encodes exclusivity context", () => {
    const resolverCalls: Array<{ verifier: string; chainId: bigint }> = [];
    const output = buildMandateOutputs({
      exclusiveFor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outputTokens,
      getOracle(verifier, chainId) {
        resolverCalls.push({ verifier, chainId });
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      sameChain: false,
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(resolverCalls).toEqual([{ verifier: "polymer", chainId: 42161n }]);
    expect(first.oracle).toBe(
      addressToBytes32("0x0000003E06000007A224AeE90052fA6bb46d43C9"),
    );
    expect(first.context).toBe(
      encodePacked(
        ["bytes1", "bytes32", "uint32"],
        ["0xe0", `0x${"a".repeat(40).padStart(64, "0")}`, 1_700_000_060],
      ),
    );
  });

  it("emits empty context when exclusiveFor is omitted", () => {
    const output = buildMandateOutputs({
      outputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      sameChain: false,
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.context).toBe("0x");
  });

  it("uses solana output settler PDA for solana output tokens", () => {
    const solanaOutputTokens: TokenContext[] = [
      {
        token: {
          address: "0xab11111111111111111111111111111111111111111111111111111111111111",
          name: "SOL",
          chainId: SOLANA_DEVNET_CHAIN_ID,
          decimals: 9,
          chainNameSpace: "solana",
        },
        amount: 1_000_000_000n,
      },
    ];

    const output = buildMandateOutputs({
      outputTokens: solanaOutputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      sameChain: false,
      recipient: "0x0000000000000000000000001111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.settler).toBe(addressToBytes32(SOLANA_DEVNET_OUTPUT_SETTLER_PDA!));
    expect(first.chainId).toBe(SOLANA_DEVNET_CHAIN_ID);
  });

  it("throws for unsupported solana chain id in output tokens", () => {
    const unsupportedSolanaTokens: TokenContext[] = [
      {
        token: {
          address: "0xab11111111111111111111111111111111111111111111111111111111111111",
          name: "SOL",
          chainId: SOLANA_MAINNET_CHAIN_ID,
          decimals: 9,
          chainNameSpace: "solana",
        },
        amount: 1n,
      },
    ];

    expect(() =>
      buildMandateOutputs({
        outputTokens: unsupportedSolanaTokens,
        getOracle() {
          return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
        },
        verifier: "polymer",
        sameChain: false,
        recipient: "0x0000000000000000000000001111111111111111111111111111111111111111",
        currentTime: 1_700_000_000,
      }),
    ).toThrow(`Unsupported Solana chain id: ${SOLANA_MAINNET_CHAIN_ID}`);
  });

  it("rejects malformed exclusiveFor addresses", () => {
    expect(() =>
      buildMandateOutputs({
        exclusiveFor: "0x1234" as `0x${string}`,
        outputTokens,
        getOracle() {
          return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
        },
        verifier: "polymer",
        sameChain: false,
        recipient: "0x1111111111111111111111111111111111111111",
        currentTime: 1_700_000_000,
      }),
    ).toThrow("ExclusiveFor not formatted correctly");
  });
});
