import { afterEach, describe, expect, it } from "bun:test";
import { IntentApi } from "./intentApi";
import { STELLAR_TESTNET_CHAIN_ID } from "../constants";
import {
  bytes32ToStellarAccount,
  bytes32ToStellarContract,
} from "../helpers/stellar";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const address = "0x6a5003E8c50bA0e188715532602c0f076827b2f0" as const;
const options = {
  user: address,
  userChainId: 1,
  inputs: [{ sender: address, asset: address, chainId: 1, amount: 10n }],
  outputs: [{ receiver: address, asset: address, chainId: 8453 }],
};

describe("EVM oracle quote filters", () => {
  it("merges both chain filters with exclusivity and the integrator header", async () => {
    let body: any;
    let headers: Headers | undefined;
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      body = await request.json();
      headers = request.headers;
      return Response.json({ quotes: [] });
    }) as typeof fetch;
    await new IntentApi(false).getQuotes({
      ...options,
      exclusiveFor: [address],
      integratorKey: "test-key",
      oracle: [
        { chainId: 1n, address },
        { chainId: 8453, address },
      ],
    });
    expect(body.intent.metadata).toEqual({
      exclusiveFor: [address],
      oracle: [
        { chain: "eip155:1", address },
        { chain: "eip155:8453", address },
      ],
    });
    expect(headers?.get("X-Integrator-Key")).toBe("test-key");
  });

  it("preserves omitted and empty filter semantics", async () => {
    const bodies: any[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      bodies.push(await request.json());
      return Response.json({ quotes: [] });
    }) as typeof fetch;
    const api = new IntentApi(false);
    await api.getQuotes(options);
    await api.getQuotes({ ...options, oracle: [] });
    expect(bodies[0].intent.metadata).toBeUndefined();
    expect(bodies[1].intent.metadata).toEqual({ oracle: [] });
  });

  it("rejects invalid chain IDs, malformed addresses, and conflicting namespaces before fetch", async () => {
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("unexpected fetch");
      },
      { preconnect: originalFetch.preconnect },
    );
    const api = new IntentApi(false);
    for (const chainId of [
      0,
      -1,
      0n,
      -1n,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        api.getQuotes({ ...options, oracle: [{ chainId, address }] }),
      ).rejects.toThrow("positive safe integer");
    }
    await expect(
      api.getQuotes({ ...options, oracle: [{ chainId: 1, address: "0x123" }] }),
    ).rejects.toThrow("20-byte EVM");
    await expect(
      api.getQuotes({
        ...options,
        inputs: [{ ...options.inputs[0]!, namespace: "tron" }],
        oracle: [{ chainId: 1, address }],
      }),
    ).rejects.toThrow("namespace conflicts");
  });

  it("normalizes Stellar contracts and preserves both route namespaces", async () => {
    const key = `0x${"12".repeat(32)}` as const;
    const contract = bytes32ToStellarContract(key);
    const stellarOptions = {
      ...options,
      outputs: [
        {
          receiver: bytes32ToStellarAccount(key),
          asset: contract,
          chainId: STELLAR_TESTNET_CHAIN_ID,
          namespace: "stellar" as const,
        },
      ],
    };
    let captured: unknown;
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      captured = await request.json();
      return Response.json({ quotes: [] });
    }) as typeof fetch;
    for (const stellarOracle of [key, contract]) {
      await new IntentApi(false).getQuotes({
        ...stellarOptions,
        oracle: [
          { chainId: 1, address },
          {
            chainId: STELLAR_TESTNET_CHAIN_ID,
            namespace: "stellar",
            address: stellarOracle,
          },
        ],
      });
      expect(captured).toMatchObject({
        intent: {
          metadata: {
            oracle: [
              { chain: "eip155:1", address },
              {
                chain: `stellar:${STELLAR_TESTNET_CHAIN_ID}`,
                address: contract,
              },
            ],
          },
        },
      });
    }
    for (const invalid of [
      bytes32ToStellarAccount(key),
      "0x12",
      contract.slice(0, -1) + "A",
    ]) {
      await expect(
        new IntentApi(false).getQuotes({
          ...stellarOptions,
          oracle: [
            {
              chainId: STELLAR_TESTNET_CHAIN_ID,
              namespace: "stellar",
              address: invalid,
            },
          ],
        }),
      ).rejects.toThrow("Stellar C-address");
    }
    await expect(
      new IntentApi(false).getQuotes({
        ...stellarOptions,
        oracle: [{ chainId: STELLAR_TESTNET_CHAIN_ID, address }],
      }),
    ).rejects.toThrow("namespace conflicts");
    await expect(
      new IntentApi(false).getQuotes({
        ...options,
        oracle: [{ chainId: 1, namespace: "stellar", address: contract }],
      }),
    ).rejects.toThrow("namespace conflicts");
  });
});
