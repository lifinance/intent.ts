import { describe, expect, it } from "bun:test";
import type {
  CoreVerifier,
  IntentDeps,
  OrderContainerValidationDeps,
  OrderValidationDeps,
  StandardOrderValidationDeps,
} from "./deps";

describe("deps types", () => {
  it("accepts the expected intent dependency contract", () => {
    const verifier: CoreVerifier = "polymer";
    expect(verifier).toBe("polymer");

    const deps: IntentDeps = {
      getOracle(selectedVerifier, chainId) {
        if (selectedVerifier === "polymer" && chainId === 1n) {
          return "0x0000003E06000007A224AeE90052fA6bb46d43C9";
        }
        return undefined;
      },
    };

    expect(deps.getOracle("polymer", 1n)).toBe(
      "0x0000003E06000007A224AeE90052fA6bb46d43C9",
    );
    expect(deps.getOracle("wormhole", 1n)).toBeUndefined();
  });

  it("supports order validation dependency aliases", () => {
    const validationDeps: StandardOrderValidationDeps = {
      allowedInputOracles() {
        return ["0x0000000000000000000000000000000000000001"];
      },
      allowedOutputOracles() {
        return ["0x0000000000000000000000000000000000000002"];
      },
      allowedOutputSettlers() {
        return ["0x0000000000000000000000000000000000000003"];
      },
    };

    const containerDeps: OrderContainerValidationDeps = {
      ...validationDeps,
      inputSettlers: ["0x0000000000000000000000000000000000000004"],
    };
    const alias: OrderValidationDeps = containerDeps;

    expect(
      alias.allowedInputOracles({ chainId: 1n, sameChainFill: false }),
    ).toEqual(["0x0000000000000000000000000000000000000001"]);
    expect(alias.inputSettlers).toEqual([
      "0x0000000000000000000000000000000000000004",
    ]);
  });
});
