import { afterEach, describe, expect, it } from "bun:test";
import { IntentApi } from "./intentApi";

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

  it("rejects invalid chain IDs, malformed addresses, and non-EVM route entries before fetch", async () => {
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("unexpected fetch");
      },
      { preconnect: originalFetch.preconnect },
    );
    const api = new IntentApi(false);
    for (const chainId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        api.getQuotes({ ...options, oracle: [{ chainId, address }] }),
      ).rejects.toThrow("positive EVM integer");
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
    ).rejects.toThrow("EVM chains only");
  });
});
