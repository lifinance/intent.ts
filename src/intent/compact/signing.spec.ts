import { describe, expect, it } from "bun:test";
import { COMPACT } from "../../constants";
import type {
  BatchCompact,
  CompactMandate,
  MultichainCompact,
} from "../../types";
import {
  signMultichainCompact,
  signStandardCompact,
  type TypedDataSigner,
} from "./signing";

const account = "0x1234567890123456789012345678901234567890" as const;

const mandateOutput = {
  oracle: `0x${"11".repeat(32)}`,
  settler: `0x${"22".repeat(32)}`,
  chainId: 42161n,
  token: `0x${"33".repeat(32)}`,
  amount: 5n,
  recipient: `0x${"44".repeat(32)}`,
  callbackData: "0x",
  context: "0x",
} as const;

const mandate: CompactMandate = {
  fillDeadline: 1700000600,
  inputOracle: "0x0000003E06000007A224AeE90052fA6bb46d43C9",
  outputs: [mandateOutput],
};

const batchCompact: BatchCompact = {
  arbiter: "0x1111111111111111111111111111111111111111",
  sponsor: "0x2222222222222222222222222222222222222222",
  nonce: 1n,
  expires: 1700000700n,
  commitments: [
    {
      lockTag: `0x${"55".repeat(12)}`,
      token: "0x3333333333333333333333333333333333333333",
      amount: 9n,
    },
  ],
  mandate,
};

const multichainCompact: MultichainCompact = {
  sponsor: "0x2222222222222222222222222222222222222222",
  nonce: 1n,
  expires: 1700000700n,
  elements: [
    {
      arbiter: "0x1111111111111111111111111111111111111111",
      chainId: 1n,
      commitments: [
        {
          lockTag: `0x${"55".repeat(12)}`,
          token: "0x3333333333333333333333333333333333333333",
          amount: 9n,
        },
      ],
      mandate,
    },
  ],
  mandate,
};

describe("compact signing", () => {
  it("signStandardCompact forwards typed data payload", async () => {
    const calls: unknown[] = [];
    const signature = `0x${"ab".repeat(65)}` as `0x${string}`;
    const walletClient = {
      signTypedData(args: unknown) {
        calls.push(args);
        return Promise.resolve(signature);
      },
    } as TypedDataSigner;

    const result = await signStandardCompact(
      account,
      walletClient,
      1n,
      batchCompact,
    );

    const [call] = calls as Array<{
      primaryType: string;
      domain: {
        name: string;
        version: string;
        chainId: bigint;
        verifyingContract: `0x${string}`;
      };
      account: `0x${string}`;
      message: BatchCompact;
    }>;
    if (!call) throw new Error("Expected signTypedData to be called");

    expect(result).toBe(signature);
    expect(call.account).toBe(account);
    expect(call.primaryType).toBe("BatchCompact");
    expect(call.domain.name).toBe("The Compact");
    expect(call.domain.version).toBe("1");
    expect(call.domain.chainId).toBe(1n);
    expect(call.domain.verifyingContract).toBe(COMPACT);
    expect(call.message).toEqual(batchCompact);
  });

  it("signMultichainCompact forwards typed data payload", async () => {
    const calls: unknown[] = [];
    const signature = `0x${"cd".repeat(65)}` as `0x${string}`;
    const walletClient = {
      signTypedData(args: unknown) {
        calls.push(args);
        return Promise.resolve(signature);
      },
    } as TypedDataSigner;

    const result = await signMultichainCompact(
      account,
      walletClient,
      10n,
      multichainCompact,
    );

    const [call] = calls as Array<{
      primaryType: string;
      domain: {
        name: string;
        version: string;
        chainId: bigint;
        verifyingContract: `0x${string}`;
      };
      account: `0x${string}`;
      message: MultichainCompact;
    }>;
    if (!call) throw new Error("Expected signTypedData to be called");

    expect(result).toBe(signature);
    expect(call.account).toBe(account);
    expect(call.primaryType).toBe("MultichainCompact");
    expect(call.domain.name).toBe("The Compact");
    expect(call.domain.version).toBe("1");
    expect(call.domain.chainId).toBe(10n);
    expect(call.domain.verifyingContract).toBe(COMPACT);
    expect(call.message).toEqual(multichainCompact);
  });
});
