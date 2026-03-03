import { describe, expect, it } from "bun:test";
import type {
  BatchCompact,
  CompactMandate,
  MultichainCompact,
} from "../../types";
import {
  compactClaimHash,
  MULTICHAIN_COMPACT_TYPEHASH_WITH_WITNESS,
  multichainCompactClaimHash,
} from "./claims";

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

describe("compact claims", () => {
  it("exposes a bytes32 multichain compact typehash", () => {
    expect(MULTICHAIN_COMPACT_TYPEHASH_WITH_WITNESS.startsWith("0x")).toBe(
      true,
    );
    expect(MULTICHAIN_COMPACT_TYPEHASH_WITH_WITNESS).toHaveLength(66);
  });

  it("hashes standard compact claims deterministically", () => {
    const hash1 = compactClaimHash(batchCompact);
    const hash2 = compactClaimHash(batchCompact);
    const hash3 = compactClaimHash({ ...batchCompact, nonce: 2n });

    expect(hash1).toBe(hash2);
    expect(hash3).not.toBe(hash1);
  });

  it("hashes multichain compact claims deterministically", () => {
    const hash1 = multichainCompactClaimHash(multichainCompact);
    const hash2 = multichainCompactClaimHash(multichainCompact);
    const hash3 = multichainCompactClaimHash({
      ...multichainCompact,
      nonce: 2n,
    });

    expect(hash1).toBe(hash2);
    expect(hash3).not.toBe(hash1);
  });
});
