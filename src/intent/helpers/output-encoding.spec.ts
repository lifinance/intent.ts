import { describe, expect, it } from "bun:test";
import { decodeAbiParameters, encodePacked, parseAbiParameters } from "viem";
import {
  COIN_FILLER,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_DEVNET_OUTPUT_SETTLER_PDA,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_MAINNET_OUTPUT_SETTLER_PDA,
  TRON_MAINNET_CHAIN_ID,
  TRON_MAINNET_OUTPUT_SETTLER,
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
      chainNamespace: "eip155",
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
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient:
        "0x0000000000000000000000001111111111111111111111111111111111111111",
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
      inputChainId: 42161n,
      inputNamespace: "eip155",
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

  it("uses input oracle for polymer cross-chain output oracle and encodes exclusivity context", () => {
    const tronOracle = "0xfa5fabd73c86e1822fda06418c332800c0d7d73b";
    const output = buildMandateOutputs({
      exclusiveFor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outputTokens,
      getOracle() {
        return tronOracle;
      },
      verifier: "polymer",
      inputChainId: TRON_MAINNET_CHAIN_ID,
      inputNamespace: "tron",
      sameChain: false,
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.oracle).toBe(addressToBytes32(tronOracle));
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
      inputChainId: 1n,
      inputNamespace: "eip155",
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
          address:
            "0xab11111111111111111111111111111111111111111111111111111111111111",
          name: "SOL",
          chainId: SOLANA_DEVNET_CHAIN_ID,
          decimals: 9,
          chainNamespace: "solana",
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
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient:
        "0x0000000000000000000000001111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.settler).toBe(
      addressToBytes32(SOLANA_DEVNET_OUTPUT_SETTLER_PDA!),
    );
    expect(first.chainId).toBe(SOLANA_DEVNET_CHAIN_ID);
  });

  it("uses solana output settler PDA for solana mainnet output tokens", () => {
    const solanaMainnetTokens: TokenContext[] = [
      {
        token: {
          address:
            "0xab11111111111111111111111111111111111111111111111111111111111111",
          name: "SOL",
          chainId: SOLANA_MAINNET_CHAIN_ID,
          decimals: 9,
          chainNamespace: "solana",
        },
        amount: 1n,
      },
    ];

    const output = buildMandateOutputs({
      outputTokens: solanaMainnetTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient:
        "0x0000000000000000000000001111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.settler).toBe(
      addressToBytes32(SOLANA_MAINNET_OUTPUT_SETTLER_PDA!),
    );
    expect(first.chainId).toBe(SOLANA_MAINNET_CHAIN_ID);
  });

  it("uses tron output settler for tron output tokens", () => {
    const tronOutputTokens: TokenContext[] = [
      {
        token: {
          address: "0xab11111111111111111111111111111111111111",
          name: "USDT",
          chainId: TRON_MAINNET_CHAIN_ID,
          decimals: 6,
          chainNamespace: "tron",
        },
        amount: 1_000_000n,
      },
    ];

    const output = buildMandateOutputs({
      outputTokens: tronOutputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient:
        "0x0000000000000000000000001111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.settler).toBe(addressToBytes32(TRON_MAINNET_OUTPUT_SETTLER));
    expect(first.chainId).toBe(TRON_MAINNET_CHAIN_ID);
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
        inputChainId: 1n,
        inputNamespace: "eip155",
        sameChain: false,
        recipient: "0x1111111111111111111111111111111111111111",
        currentTime: 1_700_000_000,
      }),
    ).toThrow("ExclusiveFor not formatted correctly");
  });

  // The failure this guard exists for: order
  // 0x2947daf76e839afdd36972307f937d2dd80bea17c264f242b6fc78697168dcd3 was a
  // solana-origin order carrying a padded EVM solver. It filled on Base and can
  // never be finalised on Solana, because the escrow pays out only to the
  // signer named in the fill.
  it("rejects a padded EVM solver on a solana-origin intent", () => {
    expect(() =>
      buildMandateOutputs({
        exclusiveFor: "0x7bb2b9b2cf209b88850cb744d9e38297905549c9",
        outputTokens,
        getOracle() {
          return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
        },
        verifier: "polymer",
        inputChainId: SOLANA_MAINNET_CHAIN_ID,
        inputNamespace: "solana",
        sameChain: false,
        recipient: "0x1111111111111111111111111111111111111111",
        currentTime: 1_700_000_000,
      }),
    ).toThrow("is not a Solana pubkey");
  });

  it("accepts a 32-byte solver on a solana-origin intent and leaves it unpadded", () => {
    const solver =
      "0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7";
    const output = buildMandateOutputs({
      exclusiveFor: solver,
      outputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      inputChainId: SOLANA_MAINNET_CHAIN_ID,
      inputNamespace: "solana",
      sameChain: false,
      recipient: "0x1111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.context).toBe(
      encodePacked(
        ["bytes1", "bytes32", "uint32"],
        ["0xe0", solver, 1_700_000_060],
      ),
    );
  });

  it("rejects a 32-byte solver on an EVM-origin intent — the settler truncates to 20 bytes", () => {
    expect(() =>
      buildMandateOutputs({
        exclusiveFor:
          "0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7",
        outputTokens,
        getOracle() {
          return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
        },
        verifier: "polymer",
        inputChainId: 1n,
        inputNamespace: "eip155",
        sameChain: false,
        recipient: "0x1111111111111111111111111111111111111111",
        currentTime: 1_700_000_000,
      }),
    ).toThrow("is not a eip155 address");
  });

  it("honours a custom exclusivity window", () => {
    const solver = "0x7bb2b9b2cf209b88850cb744d9e38297905549c9";
    const output = buildMandateOutputs({
      exclusiveFor: solver,
      outputTokens,
      getOracle() {
        return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
      },
      verifier: "polymer",
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient: "0x1111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
      exclusivity: 300,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.context).toBe(
      encodePacked(
        ["bytes1", "bytes32", "uint32"],
        ["0xe0", addressToBytes32(solver), 1_700_000_300],
      ),
    );
  });

  it("uses getOracle for non-polymer verifier cross-chain intent", () => {
    const wormholeOracle = "0x1234567890abcdef1234567890abcdef12345678";
    const output = buildMandateOutputs({
      outputTokens,
      getOracle() {
        return wormholeOracle;
      },
      verifier: "wormhole",
      inputChainId: 1n,
      inputNamespace: "eip155",
      sameChain: false,
      recipient: "0x1111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.oracle).toBe(addressToBytes32(wormholeOracle));
  });

  it("sets output oracle to input chain oracle for polymer tron cross-chain intent", () => {
    const tronInputOracle =
      "0xfa5fabd73c86e1822fda06418c332800c0d7d73b" as `0x${string}`;
    const evmOutputTokens: TokenContext[] = [
      {
        token: {
          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          name: "USDC",
          chainId: 8453n,
          decimals: 6,
          chainNamespace: "eip155",
        },
        amount: 1_000_000n,
      },
    ];
    const output = buildMandateOutputs({
      outputTokens: evmOutputTokens,
      getOracle() {
        return tronInputOracle;
      },
      verifier: "polymer",
      inputChainId: TRON_MAINNET_CHAIN_ID,
      inputNamespace: "tron",
      sameChain: false,
      recipient: "0x1111111111111111111111111111111111111111",
      currentTime: 1_700_000_000,
    });
    const [first] = output;
    if (!first) throw new Error("Expected one output");

    expect(first.oracle).toBe(addressToBytes32(tronInputOracle));
    expect(first.settler).toBe(addressToBytes32(COIN_FILLER));
  });
});
