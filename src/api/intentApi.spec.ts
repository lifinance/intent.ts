import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { INPUT_SETTLER_ESCROW_LIFI } from "../constants";
import { isStandardOrder } from "../intent";
import { bytes32ToSolanaBase58 } from "../helpers/solana";
import { IntentApi, parseOrderStatusPayload } from "./intentApi";

const BYTES32_ONE =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const INPUT_SETTLER = INPUT_SETTLER_ESCROW_LIFI;

describe("parseOrderStatusPayload", () => {
  it("parses a status payload into an OrderContainer", () => {
    const payload = {
      data: {
        order: {
          user: "0x1111111111111111111111111111111111111111",
          nonce: "123",
          originChainId: "8453",
          expires: Math.floor(Date.now() / 1000) + 3600,
          fillDeadline: Math.floor(Date.now() / 1000) + 1800,
          inputOracle: "0x0000000000000000000000000000000000000001",
          inputs: [["1", "1000000"]],
          outputs: [
            {
              oracle: BYTES32_ONE,
              settler: BYTES32_ONE,
              chainId: "42161",
              token: BYTES32_ONE,
              amount: "1000000",
              recipient: BYTES32_ONE,
              callbackData: "0x",
              context: "0x",
            },
          ],
        },
        inputSettler: INPUT_SETTLER,
        sponsorSignature: null,
        allocatorSignature: "0x1234",
      },
    };

    const parsed = parseOrderStatusPayload(payload);

    expect(parsed.inputSettler).toBe(INPUT_SETTLER);
    expect(parsed.order.nonce).toBe(123n);
    expect(isStandardOrder(parsed.order) && parsed.order.originChainId).toBe(
      8453n,
    );
    expect(parsed.sponsorSignature).toEqual({ type: "None", payload: "0x" });
    expect(parsed.allocatorSignature).toEqual({
      type: "ECDSA",
      payload: "0x1234",
    });
  });

  it("parses a multichain payload nested under data[0].intent", () => {
    const payload = {
      data: [
        {
          intent: {
            order: {
              user: "0x1111111111111111111111111111111111111111",
              nonce: "12",
              expires: 2_000_000_000,
              fillDeadline: 1_999_999_900,
              inputOracle: "0x0000000000000000000000000000000000000001",
              outputs: [
                {
                  oracle: BYTES32_ONE,
                  settler: BYTES32_ONE,
                  chainId: "8453",
                  token: BYTES32_ONE,
                  amount: "100",
                  recipient: BYTES32_ONE,
                  callbackData: "0x",
                  context: "0x",
                },
              ],
              inputs: [
                { chainId: "1", inputs: [["1", "10"]] },
                { chainId: "42161", inputs: [["2", "20"]] },
              ],
            },
            inputSettler: INPUT_SETTLER,
            sponsorSignature: "0xbeef",
            allocatorSignature: null,
          },
        },
      ],
    };

    const parsed = parseOrderStatusPayload(payload);
    expect(isStandardOrder(parsed.order)).toBe(false);
    if (isStandardOrder(parsed.order))
      throw new Error("Expected multichain order");

    expect(parsed.order.inputs.length).toBe(2);
    const secondInput = parsed.order.inputs[1];
    if (!secondInput) throw new Error("Expected second multichain input");
    expect(secondInput.chainId).toBe(42161n);
    expect(parsed.sponsorSignature).toEqual({
      type: "ECDSA",
      payload: "0xbeef",
    });
    expect(parsed.allocatorSignature).toEqual({ type: "None", payload: "0x" });
  });

  it("throws for invalid payload", () => {
    expect(() => parseOrderStatusPayload({ data: {} })).toThrow();
  });

  it("throws when user is not a hex address", () => {
    const payload = {
      data: {
        order: {
          user: "not-a-hex-address",
          nonce: "123",
          originChainId: "8453",
          expires: 2_000_000_000,
          fillDeadline: 1_999_999_900,
          inputOracle: "0x0000000000000000000000000000000000000001",
          inputs: [["1", "1000000"]],
          outputs: [],
        },
        inputSettler: INPUT_SETTLER,
      },
    };

    expect(() => parseOrderStatusPayload(payload)).toThrow(
      "Order payload invalid: order.user",
    );
  });

  it("throws when standard order input tuple is malformed", () => {
    const payload = {
      data: {
        order: {
          user: "0x1111111111111111111111111111111111111111",
          nonce: "123",
          originChainId: "8453",
          expires: 2_000_000_000,
          fillDeadline: 1_999_999_900,
          inputOracle: "0x0000000000000000000000000000000000000001",
          inputs: [["1"]],
          outputs: [],
        },
        inputSettler: INPUT_SETTLER,
      },
    };

    expect(() => parseOrderStatusPayload(payload)).toThrow(
      "Order payload invalid: inputs[0]",
    );
  });

  it("throws for invalid numeric strings", () => {
    const payload = {
      data: {
        order: {
          user: "0x1111111111111111111111111111111111111111",
          nonce: "123",
          originChainId: "8453",
          expires: "abc",
          fillDeadline: "NaN",
          inputOracle: "0x0000000000000000000000000000000000000001",
          inputs: [["1", "1000000"]],
          outputs: [],
        },
        inputSettler: INPUT_SETTLER,
      },
    };

    expect(() => parseOrderStatusPayload(payload)).toThrow(
      "Order payload invalid: order.expires",
    );
  });

  it("throws for non-finite numeric values", () => {
    const payload = {
      data: {
        order: {
          user: "0x1111111111111111111111111111111111111111",
          nonce: "123",
          originChainId: "8453",
          expires: Infinity,
          fillDeadline: 1_999_999_900,
          inputOracle: "0x0000000000000000000000000000000000000001",
          inputs: [["1", "1000000"]],
          outputs: [],
        },
        inputSettler: INPUT_SETTLER,
      },
    };

    expect(() => parseOrderStatusPayload(payload)).toThrow(
      "Order payload invalid: order.expires",
    );
  });
});

describe("IntentApi HTTP", () => {
  const originalFetch = globalThis.fetch;
  let requests: Request[];

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends order query params with defaults", async () => {
    const api = new IntentApi(true);
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      requests.push(request);
      return new Response(
        JSON.stringify({
          data: [],
          meta: { limit: 50, offset: 0, total: 0 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const user = "0x1111111111111111111111111111111111111111" as const;
    const response = await api.getOrders({ user, status: "Signed" });
    expect(response.meta.limit).toBe(50);

    const request = requests[0];
    if (!request) throw new Error("Expected request");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/orders");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("user")).toBe(user);
    expect(url.searchParams.get("status")).toBe("Signed");
  });

  it("maps 404 to Order not found", async () => {
    const api = new IntentApi(true);
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      requests.push(request);
      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(
      api.getOrderByOnChainOrderId(BYTES32_ONE),
    ).rejects.toThrowError("Order not found");

    const request = requests[0];
    if (!request) throw new Error("Expected request");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/orders/status/");
    expect(url.searchParams.get("onChainOrderId")).toBe(BYTES32_ONE);
  });

  it("parses order payload from status endpoint", async () => {
    const api = new IntentApi(true);
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      requests.push(request);
      return new Response(
        JSON.stringify({
          data: {
            order: {
              user: "0x1111111111111111111111111111111111111111",
              nonce: "123",
              originChainId: "8453",
              expires: 2_000_000_000,
              fillDeadline: 1_999_999_900,
              inputOracle: "0x0000000000000000000000000000000000000001",
              inputs: [["1", "1000000"]],
              outputs: [
                {
                  oracle: BYTES32_ONE,
                  settler: BYTES32_ONE,
                  chainId: "42161",
                  token: BYTES32_ONE,
                  amount: "1000000",
                  recipient: BYTES32_ONE,
                  callbackData: "0x",
                  context: "0x",
                },
              ],
            },
            inputSettler: INPUT_SETTLER,
            sponsorSignature: null,
            allocatorSignature: null,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const order = await api.getOrderByOnChainOrderId(BYTES32_ONE);
    expect(order.inputSettler).toBe(INPUT_SETTLER);
    expect(order.order.nonce).toBe(123n);
  });

  it("posts quote requests as JSON with v1 format", async () => {
    const api = new IntentApi(false);
    let requestBody = "";
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      requestBody = await request.clone().text();
      requests.push(request);
      return new Response(JSON.stringify({ quotes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await api.getQuotes({
      user: "0x1111111111111111111111111111111111111111",
      userChainId: 1,
      inputs: [
        {
          sender: "0x1111111111111111111111111111111111111111",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 1,
          amount: 1_000_000n,
        },
      ],
      outputs: [
        {
          receiver: "0x1111111111111111111111111111111111111111",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 8453,
          amount: 1_000_000n,
        },
      ],
    });

    const request = requests[0];
    if (!request) throw new Error("Expected request");
    expect(request.method).toBe("POST");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/v1/integrator/quote/request");

    const body = JSON.parse(requestBody);
    expect(body.supportedTypes).toEqual(["oif-user-open-v0"]);
    expect(body.user).toEqual({
      chain: "eip155:1",
      address: "0x1111111111111111111111111111111111111111",
    });
    expect(body.intent.intentType).toBe("oif-swap");
    expect(body.intent.swapType).toBe("exact-input");
    expect(body.intent.inputs[0].chain).toBe("eip155:1");
    expect(body.intent.inputs[0].amount).toBe("1000000");
    expect(body.intent.outputs[0].chain).toBe("eip155:8453");
    expect(body.intent.outputs[0].amount).toBe("1000000");
  });

  it("uses tron CAIP-2 chain for tron namespace", async () => {
    const api = new IntentApi(false);
    let requestBody = "";
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      requestBody = await request.clone().text();
      requests.push(request);
      return new Response(JSON.stringify({ quotes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await api.getQuotes({
      user: "0x1111111111111111111111111111111111111111",
      userChainId: 728126428,
      userNamespace: "tron",
      inputs: [
        {
          sender: "0x1111111111111111111111111111111111111111",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 728126428,
          namespace: "tron",
          amount: 1_000_000n,
        },
      ],
      outputs: [
        {
          receiver: "0x1111111111111111111111111111111111111111",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 42161,
          amount: 1_000_000n,
        },
      ],
    });

    const body = JSON.parse(requestBody);
    expect(body.user.chain).toBe("tron:728126428");
    expect(body.intent.inputs[0].chain).toBe("tron:728126428");
    expect(body.intent.outputs[0].chain).toBe("eip155:42161");
    // Tron stays hex on the wire. Only Solana re-encodes. This is not an
    // oversight: order.li.fi accepts a `tron:` output with hex asset+receiver,
    // base58 asset+receiver, or a mix of the two — all three probed live and
    // all three returned 200. Solana is the namespace that hard-rejects, so it
    // is the only one converted.
    expect(body.intent.inputs[0].asset).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
  });

  // The API reads each field in the namespace its sibling `chain` declares.
  // Sending a Solana output under `eip155:` — or under `solana:` but still in
  // 32-byte hex — is rejected as
  // `bytes32 value has non-zero upper bytes`, because a full Solana key cannot
  // be read as a left-padded 20-byte EVM address. Confirmed against
  // order-dev.li.fi.
  describe("solana namespace addresses", () => {
    // USDC on Solana mainnet.
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const USDC_MINT_BYTES32 =
      "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61";
    const SOLANA_CHAIN_ID = 1151111081099710n;

    function captureQuoteBody() {
      const captured = { body: "" };
      globalThis.fetch = (async (input, init) => {
        const request =
          input instanceof Request
            ? input
            : new Request(input.toString(), init);
        captured.body = await request.clone().text();
        return new Response(JSON.stringify({ quotes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      return captured;
    }

    it("re-encodes 32-byte hex to base58 for a solana output", async () => {
      const captured = captureQuoteBody();
      await new IntentApi(false).getQuotes({
        user: "0x1111111111111111111111111111111111111111",
        userChainId: 8453,
        inputs: [
          {
            sender: "0x1111111111111111111111111111111111111111",
            asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            chainId: 8453,
            amount: 1_000_000n,
          },
        ],
        outputs: [
          {
            receiver:
              "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
            asset: USDC_MINT_BYTES32,
            chainId: SOLANA_CHAIN_ID,
            namespace: "solana",
            amount: 0n,
          },
        ],
      });

      const output = JSON.parse(captured.body).intent.outputs[0];
      expect(output.chain).toBe(`solana:${SOLANA_CHAIN_ID}`);
      expect(output.asset).toBe(USDC_MINT);
      expect(output.receiver).toBe(
        bytes32ToSolanaBase58(
          "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        ),
      );
    });

    it("passes native base58 through unchanged", async () => {
      const captured = captureQuoteBody();
      await new IntentApi(false).getQuotes({
        user: USDC_MINT,
        userChainId: SOLANA_CHAIN_ID,
        userNamespace: "solana",
        inputs: [
          {
            sender: USDC_MINT,
            asset: USDC_MINT,
            chainId: SOLANA_CHAIN_ID,
            namespace: "solana",
            amount: 1_000_000n,
          },
        ],
        outputs: [
          {
            receiver: "0x1111111111111111111111111111111111111111",
            asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            chainId: 8453,
            amount: 0n,
          },
        ],
      });

      const body = JSON.parse(captured.body);
      expect(body.user).toEqual({
        chain: `solana:${SOLANA_CHAIN_ID}`,
        address: USDC_MINT,
      });
      expect(body.intent.inputs[0].asset).toBe(USDC_MINT);
      // The EVM output is untouched by the Solana input's namespace.
      expect(body.intent.outputs[0].asset).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
    });

    it("rejects a solana asset whose namespace was left unset", async () => {
      captureQuoteBody();
      await expect(
        new IntentApi(false).getQuotes({
          user: "0x1111111111111111111111111111111111111111",
          userChainId: 8453,
          inputs: [
            {
              sender: "0x1111111111111111111111111111111111111111",
              asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              chainId: 8453,
              amount: 1_000_000n,
            },
          ],
          outputs: [
            {
              receiver: "0x1111111111111111111111111111111111111111",
              asset: USDC_MINT_BYTES32,
              chainId: SOLANA_CHAIN_ID,
              // namespace omitted -> defaults to eip155, which would send
              // `eip155:1151111081099710` with an unconverted 32-byte asset.
              amount: 0n,
            },
          ],
        }),
      ).rejects.toThrow('is 32 bytes but its namespace is "eip155"');
    });

    it("rejects a 20-byte EVM address declared as solana", async () => {
      captureQuoteBody();
      await expect(
        new IntentApi(false).getQuotes({
          user: "0x1111111111111111111111111111111111111111",
          userChainId: 8453,
          inputs: [
            {
              sender: "0x1111111111111111111111111111111111111111",
              asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              chainId: 8453,
              amount: 1_000_000n,
            },
          ],
          outputs: [
            {
              // An EVM address can never be a Solana account. Failing here beats
              // a 400 that names `bytes32 value has non-zero upper bytes`.
              receiver: "0x1111111111111111111111111111111111111111",
              asset: USDC_MINT_BYTES32,
              chainId: SOLANA_CHAIN_ID,
              namespace: "solana",
              amount: 0n,
            },
          ],
        }),
      ).rejects.toThrow("is not a Solana address");
    });
  });
});

const LIVE = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!LIVE)("IntentApi live quotes", () => {
  it("fetches a live quote for ARB USDC -> Base USDC", async () => {
    const api = new IntentApi(true);
    const result = await api.getQuotes({
      user: "0x1111111111111111111111111111111111111111",
      userChainId: 42161,
      inputs: [
        {
          sender: "0x1111111111111111111111111111111111111111",
          asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          chainId: 42161,
          amount: 10_000_000_000n,
        },
      ],
      outputs: [
        {
          receiver: "0x1111111111111111111111111111111111111111",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          chainId: 8453,
        },
      ],
    });

    expect(result.quotes.length).toBeGreaterThan(0);

    const quote = result.quotes[0]!;
    expect(quote.quoteId).toBeString();
    expect(quote.provider).toBeString();

    expect(quote.preview.inputs.length).toBeGreaterThan(0);
    expect(quote.preview.inputs[0]!.chain).toBe("eip155:42161");
    expect(quote.preview.outputs.length).toBeGreaterThan(0);
    expect(quote.preview.outputs[0]!.chain).toBe("eip155:8453");

    expect(quote.order.type).toBe("oif-user-open-v0");
    expect(quote.order.openIntentTx.chain).toBe("eip155:42161");
    expect(quote.order.openIntentTx.to).toStartWith("0x");
    expect(quote.order.openIntentTx.data).toStartWith("0x");
    expect(quote.order.openIntentTx.gasRequired).toBeString();

    expect(quote.order.checks.allowances.length).toBeGreaterThan(0);
    const allowance = quote.order.checks.allowances[0]!;
    expect(allowance.chain).toBe("eip155:42161");
    expect(allowance.token.toLowerCase()).toBe(
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831".toLowerCase(),
    );
    expect(allowance.user).toBe("0x1111111111111111111111111111111111111111");

    expect(typeof quote.partialFill).toBe("boolean");
    expect(quote.failureHandling).toBeString();
  });

  it("returns empty quotes for unsupported route", async () => {
    const api = new IntentApi(true);
    const result = await api.getQuotes({
      user: "0x1111111111111111111111111111111111111111",
      userChainId: 1,
      inputs: [
        {
          sender: "0x1111111111111111111111111111111111111111",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 1,
          amount: 1n,
        },
      ],
      outputs: [
        {
          receiver: "0x1111111111111111111111111111111111111111",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          chainId: 8453,
        },
      ],
    });

    expect(result.quotes).toBeArray();
  });
});
