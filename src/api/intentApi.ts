import ky, { HTTPError } from "ky";
import type {
  MultichainOrder,
  Namespace,
  NoSignature,
  OrderContainer,
  Quote,
  Signature,
  StandardOrder,
} from "../types/index";
import { bytes32ToAddress } from "../helpers/convert";
import { isStandardOrder } from "../intent/index";
import {
  bytes32ToSolanaBase58,
  isSolanaBase58Address,
  solanaBase58ToBytes32,
} from "../helpers/solana";
import {
  bytes32ToStellarAccount,
  bytes32ToStellarContract,
  isStellarAccount,
  isStellarContract,
} from "../helpers/stellar";

type OrderStatus = "Signed" | "Delivered" | "Settled";

type SubmitOrderDto = {
  orderType: "CatalystCompactOrder";
  order: StandardOrder;
  inputSettler: `0x${string}`;
  sponsorSignature?: `0x${string}`;
  allocatorSignature?: `0x${string}`;
  compactRegistrationTxHash?: `0x${string}`;
};

type intentApiPush = (orderArr: {
  order: StandardOrder;
  inputSettler: `0x${string}`;
  sponsorSignature?: `0x${string}`;
  allocatorSignature?: `0x${string}`;
}) => void;

type GetOrderResponse = {
  data: {
    order: StandardOrder;
    quote: Quote;
    sponsorSignature: `0x${string}` | null;
    allocatorSignature?: `0x${string}` | null;
    inputSettler: `0x${string}`;
    meta: {
      submitTime: number;
      orderStatus: OrderStatus;
      destinationAddress: `0x${string}`;
      orderIdentifier: string;
      onChainOrderId: `0x${string}`;
      signedAt: string;
      expiredAt: string | null;
    };
  }[];
  meta: {
    limit: number;
    offset: number;
    total: number;
  };
};

/**
 * Addresses and assets are `string`, not `0x${string}`: a Solana field may be
 * given either as this library's internal 32-byte hex or as native base58.
 * `toQuoteAddress` normalizes to what the API expects for `namespace`, so the
 * namespace must be set on any non-EVM input or output — it selects both the
 * CAIP-2 chain prefix and the address encoding, and they have to agree.
 */
type GetQuoteOptions = {
  user: string;
  userChainId: number | bigint;
  userNamespace?: Namespace;
  inputs: {
    sender: string;
    asset: string;
    chainId: number | bigint;
    namespace?: Namespace;
    amount: bigint;
  }[];
  outputs: {
    receiver: string;
    asset: string;
    chainId: number | bigint;
    namespace?: Namespace;
    amount?: bigint;
  }[];
  swapType?: "exact-input" | "exact-output";
  minValidUntil?: number;
  exclusiveFor?: `0x${string}`[];
  /** Accepted EVM oracle contracts on both sides of a cross-chain route. */
  oracle?: { chainId: number | bigint; address: `0x${string}` }[];
  /**
   * Optional integrator key sent as the `X-Integrator-Key` header on the quote
   * request. Lets an integrator receive integrator-specific quotes.
   */
  integratorKey?: string;
  preference?: "price" | "speed" | "input-priority" | "trust-minimization";
  partialFill?: boolean;
  failureHandling?: (
    | "refund-automatic"
    | "refund-claim"
    | "needs-new-signature"
  )[];
};

type QuotePreviewItem = {
  chain: string;
  user?: string;
  receiver?: string;
  asset: string;
  amount: string;
};

type GetQuoteResponse = {
  quotes: {
    quoteId: string;
    provider: string;
    preview: {
      inputs: QuotePreviewItem[];
      outputs: QuotePreviewItem[];
    };
    order: {
      type: string;
      openIntentTx: {
        chain: string;
        to: string;
        data: string;
        gasRequired: string;
      };
      checks: {
        allowances: {
          chain: string;
          token: string;
          user: string;
          spender: string;
          required: string;
        }[];
      };
    };
    partialFill: boolean;
    failureHandling: string;
    metadata: {
      // Rendered in the INPUT chain's own form: `0x` hex on EVM, `T...` on
      // Tron, base58 on Solana — not necessarily hex.
      exclusiveFor: string | string[] | null;
    };
  }[];
};

/**
 * Normalizes a solver identity to the form its own chain names it by.
 *
 * `buildMandateOutputs` accepts the exclusive solver either as an address or as
 * the bytes32 it is padded to on the wire, so both forms legitimately reach a
 * caller. The quote API names solvers the way the chain does — a 20-byte
 * address on EVM and Tron — and a padded value there would reach the order
 * service as an address it cannot parse. Solana keys are 32 bytes in both
 * places and pass straight through, as do Stellar solver identities: those are
 * 32-byte address commitments, which no 20-byte truncation can preserve.
 */
function toSolverAddress(
  solver: `0x${string}`,
  namespace: Namespace = "eip155",
): `0x${string}` {
  if (namespace === "solana" || namespace === "stellar") return solver;
  return /^0x[0-9a-fA-F]{64}$/.test(solver)
    ? (bytes32ToAddress(solver) as `0x${string}`)
    : solver;
}

function toCaip2Chain(
  chainId: number | bigint,
  namespace: Namespace = "eip155",
): string {
  return `${namespace}:${chainId}`;
}

/**
 * What a quote field names. Only Stellar needs it: its strkey encodes the
 * address kind, which the bare 32-byte form does not carry.
 */
type QuoteAddressRole = "user" | "asset" | "receiver" | "solver";

/**
 * An address or asset in the notation its own namespace uses on the wire.
 *
 * The quote API reads every field in the namespace declared by the sibling
 * `chain`, so the two must agree. A Solana mint or account is base58 there, not
 * this library's internal 32-byte hex: sending the hex form under a `solana:`
 * chain is rejected with `bytes32 value has non-zero upper bytes`, because the
 * API tries to read a left-padded 20-byte EVM address out of a full 32-byte
 * key. (Under an `eip155:` chain the same value fails identically — which is
 * why a wrong namespace and a wrong encoding surface as one error.)
 *
 * Callers keep one internal representation and this converts on the way out.
 * Already-base58 input passes through, so a caller holding a native Solana
 * address needs no conversion of its own.
 *
 * Stellar is a strkey on the wire, and the strkey encodes whether the key is an
 * account (`G…`) or a contract (`C…`). A user is the order's signing account
 * and an asset is a token contract, so their 32-byte form converts
 * unambiguously. A receiver may be either — orders tag the recipient kind in
 * the output context — so its 32-byte form is rejected and the strkey must be
 * passed. A solver is a 32-byte address commitment (a hash, not a key), which
 * has no strkey and passes through as hex.
 *
 * EVM and Tron are deliberately untouched: the API accepts their hex form
 * today, and Tron's base58 is a different (checksummed) encoding that should
 * only be introduced against a verified API expectation.
 */
function toQuoteAddress(
  value: string,
  role: QuoteAddressRole,
  namespace: Namespace = "eip155",
): string {
  if (namespace === "stellar") return toStellarQuoteAddress(value, role);
  const isBytes32 = /^0x[0-9a-fA-F]{64}$/.test(value);
  if (namespace !== "solana") {
    // A 32-byte value under any other namespace is a missing or wrong
    // `namespace`, not a legitimate address: EVM and Tron are both 20 bytes.
    // Left unchecked it reaches the API as an `eip155` field and comes back as
    // `bytes32 value has non-zero upper bytes`, which names the asset rather
    // than the namespace that actually caused it.
    if (isBytes32) {
      throw new Error(
        `Quote request invalid: "${value}" is 32 bytes but its namespace is "${namespace}" — set namespace to the chain's own ("solana" or "stellar")`,
      );
    }
    return value;
  }
  if (isBytes32) {
    return bytes32ToSolanaBase58(value as `0x${string}`);
  }
  if (isSolanaBase58Address(value)) return value;
  throw new Error(
    `Quote request invalid: "${value}" is not a Solana address (expected base58 or 32-byte hex)`,
  );
}

function toStellarQuoteAddress(value: string, role: QuoteAddressRole): string {
  const isBytes32 = /^0x[0-9a-fA-F]{64}$/.test(value);
  if (role === "solver") {
    if (isBytes32) return value;
    throw new Error(
      `Quote request invalid: "${value}" is not a Stellar solver commitment (expected 32-byte hex)`,
    );
  }
  if (isStellarAccount(value) || isStellarContract(value)) return value;
  if (isBytes32) {
    const bytes32 = value as `0x${string}`;
    if (role === "user") return bytes32ToStellarAccount(bytes32);
    if (role === "asset") return bytes32ToStellarContract(bytes32);
    throw new Error(
      `Quote request invalid: Stellar receiver "${value}" may be an account or a contract — pass the strkey (G… or C…)`,
    );
  }
  throw new Error(
    `Quote request invalid: "${value}" is not a Stellar address (expected a G…/C… strkey or 32-byte hex)`,
  );
}

type OrderEnvelope = {
  order: unknown;
  inputSettler: unknown;
  sponsorSignature?: unknown;
  allocatorSignature?: unknown;
};

function toHexString(value: unknown, field: string): `0x${string}` {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(value) ||
    value.length % 2 !== 0
  ) {
    throw new Error(`Order payload invalid: ${field}`);
  }
  return value as `0x${string}`;
}

function toBigIntValue(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      throw new Error(`Order payload invalid: ${field}`);
    }
  }
  throw new Error(`Order payload invalid: ${field}`);
}

/**
 * An address-shaped field, in whichever encoding its own namespace uses on the
 * wire, normalized to this library's internal hex form.
 *
 * The order API renders every field in the namespace of the chain it belongs
 * to — the same convention `toQuoteAddress` writes on the way out — so an order
 * whose origin or output chain is Solana comes back with `user`, `inputOracle`,
 * `inputSettler`, mints and recipients as raw base58. Left unconverted they
 * fail `toHexString` and the import dies on the first such field.
 *
 * The two encodings cannot collide: base58's alphabet excludes `0`, so no
 * base58 address can begin with `0x`. Hex is passed through byte-for-byte,
 * which leaves EVM and Tron orders parsed exactly as before.
 */
function toAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value === "string" && !value.startsWith("0x")) {
    try {
      return solanaBase58ToBytes32(value.trim());
    } catch {
      throw new Error(`Order payload invalid: ${field}`);
    }
  }
  return toHexString(value, field);
}

/**
 * The asset slot of an input tuple: a uint256 token id on EVM and Tron, a
 * base58 mint on Solana. Base58 decodes to the same 32-byte key the rest of the
 * library carries as an integer (see `create.ts`, which builds a Solana order's
 * input as `BigInt(mintHex)`), so both encodings land on one representation.
 *
 * The numeric reading is tried first. Base58's alphabet also contains the
 * digits 1-9, so a decimal id is spellable in it — and every existing order
 * means the number.
 */
function toAssetId(value: unknown, field: string): bigint {
  if (
    typeof value === "string" &&
    !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())
  ) {
    return BigInt(toAddress(value, field));
  }
  return toBigIntValue(value, field);
}

function toNumberValue(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim().length > 0
          ? Number(value.trim())
          : Number.NaN;
  if (Number.isSafeInteger(parsed)) return parsed;
  throw new Error(`Order payload invalid: ${field}`);
}

function normalizeSignature(value: unknown): Signature | NoSignature {
  if (!value) return { type: "None", payload: "0x" };
  return {
    type: "ECDSA",
    payload: toHexString(value, "signature"),
  };
}

function normalizeOutputs(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Order payload invalid: outputs");
  return value.map((output, index) => {
    if (!output || typeof output !== "object") {
      throw new Error(`Order payload invalid: outputs[${index}]`);
    }
    const o = output as Record<string, unknown>;
    return {
      oracle: toAddress(o.oracle, `outputs[${index}].oracle`),
      settler: toAddress(o.settler, `outputs[${index}].settler`),
      chainId: toBigIntValue(o.chainId, `outputs[${index}].chainId`),
      token: toAddress(o.token, `outputs[${index}].token`),
      amount: toBigIntValue(o.amount, `outputs[${index}].amount`),
      recipient: toAddress(o.recipient, `outputs[${index}].recipient`),
      callbackData: toHexString(
        o.callbackData ?? "0x",
        `outputs[${index}].callbackData`,
      ),
      context: toHexString(o.context ?? "0x", `outputs[${index}].context`),
    };
  });
}

function normalizeStandardOrder(order: Record<string, unknown>): StandardOrder {
  if (!Array.isArray(order.inputs))
    throw new Error("Order payload invalid: inputs");
  return {
    user: toAddress(order.user, "order.user"),
    nonce: toBigIntValue(order.nonce, "order.nonce"),
    originChainId: toBigIntValue(order.originChainId, "order.originChainId"),
    expires: toNumberValue(order.expires, "order.expires"),
    fillDeadline: toNumberValue(order.fillDeadline, "order.fillDeadline"),
    inputOracle: toAddress(order.inputOracle, "order.inputOracle"),
    inputs: order.inputs.map((input, index) => {
      if (!Array.isArray(input) || input.length !== 2) {
        throw new Error(`Order payload invalid: inputs[${index}]`);
      }
      return [
        toAssetId(input[0], `inputs[${index}][0]`),
        toBigIntValue(input[1], `inputs[${index}][1]`),
      ];
    }),
    outputs: normalizeOutputs(order.outputs),
  };
}

function normalizeMultichainOrder(
  order: Record<string, unknown>,
): MultichainOrder {
  if (!Array.isArray(order.inputs))
    throw new Error("Order payload invalid: inputs");
  return {
    user: toAddress(order.user, "order.user"),
    nonce: toBigIntValue(order.nonce, "order.nonce"),
    expires: toNumberValue(order.expires, "order.expires"),
    fillDeadline: toNumberValue(order.fillDeadline, "order.fillDeadline"),
    inputOracle: toAddress(order.inputOracle, "order.inputOracle"),
    outputs: normalizeOutputs(order.outputs),
    inputs: order.inputs.map((input, index) => {
      if (!input || typeof input !== "object") {
        throw new Error(`Order payload invalid: inputs[${index}]`);
      }
      const i = input as Record<string, unknown>;
      if (!Array.isArray(i.inputs)) {
        throw new Error(`Order payload invalid: inputs[${index}].inputs`);
      }
      return {
        chainId: toBigIntValue(i.chainId, `inputs[${index}].chainId`),
        inputs: i.inputs.map((tuple, tupleIndex) => {
          if (!Array.isArray(tuple) || tuple.length !== 2) {
            throw new Error(
              `Order payload invalid: inputs[${index}].inputs[${tupleIndex}]`,
            );
          }
          return [
            toAssetId(tuple[0], `inputs[${index}].inputs[${tupleIndex}][0]`),
            toBigIntValue(
              tuple[1],
              `inputs[${index}].inputs[${tupleIndex}][1]`,
            ),
          ];
        }),
      };
    }),
  };
}

function extractOrderEnvelope(payload: unknown): OrderEnvelope {
  const root =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as Record<string, unknown>).data
      : payload;
  const candidateRaw = Array.isArray(root) ? root[0] : root;
  if (!candidateRaw || typeof candidateRaw !== "object") {
    throw new Error("Order payload invalid: data");
  }
  const candidate = candidateRaw as Record<string, unknown>;
  const c =
    candidate.intent && typeof candidate.intent === "object"
      ? (candidate.intent as Record<string, unknown>)
      : candidate;
  if (!("order" in c) || !("inputSettler" in c)) {
    throw new Error("Order payload invalid: missing order fields");
  }
  return c as OrderEnvelope;
}

export function parseOrderStatusPayload(payload: unknown): OrderContainer {
  const envelope = extractOrderEnvelope(payload);
  const rawOrder = envelope.order as Record<string, unknown>;
  if (!rawOrder || typeof rawOrder !== "object") {
    throw new Error("Order payload invalid: order");
  }
  const orderLike = rawOrder as StandardOrder | MultichainOrder;
  const order = isStandardOrder(orderLike)
    ? normalizeStandardOrder(rawOrder)
    : normalizeMultichainOrder(rawOrder);

  return {
    inputSettler: toAddress(envelope.inputSettler, "inputSettler"),
    order,
    sponsorSignature: normalizeSignature(envelope.sponsorSignature),
    allocatorSignature: normalizeSignature(envelope.allocatorSignature),
  };
}

export class IntentApi {
  baseUrl: string;
  websocketUrl: string;

  constructor(mainnet: boolean) {
    this.baseUrl = IntentApi.getIntentApiUrl(mainnet);
    this.websocketUrl = IntentApi.getIntentApiWssUrl(mainnet);
  }

  static getIntentApiUrl(mainnet: boolean) {
    return mainnet ? "https://order.li.fi" : "https://order-dev.li.fi";
  }

  static getIntentApiWssUrl(mainnet: boolean) {
    return mainnet ? "wss://order.li.fi" : "wss://order-dev.li.fi";
  }

  /**
   * @notice Submits an order to the intent-api
   * @param request The order submission request
   * @returns The response data from the intent-api
   */
  async submitOrder(request: SubmitOrderDto) {
    try {
      return await ky
        .post(new URL("/orders/submit", this.baseUrl), {
          json: request,
          timeout: 15000,
        })
        .json();
    } catch (error) {
      console.error("Error submitting order:", error);
      throw error;
    }
  }

  /**
   * @notice Gets latest orders from the intent-api
   * @param options Optional parameters to filter orders
   * @returns The response data containing the orders
   */
  async getOrders(options?: { user?: `0x${string}`; status?: OrderStatus }) {
    try {
      return await ky
        .get(new URL("/orders", this.baseUrl), {
          searchParams: { limit: 50, offset: 0, ...options },
          timeout: 15000,
        })
        .json<GetOrderResponse>();
    } catch (error) {
      console.error("Error getting orders:", error);
      throw error;
    }
  }

  /**
   * @notice Gets an order by on-chain order id.
   * @param orderId On-chain order id (0x-prefixed hash)
   */
  async getOrderByOnChainOrderId(
    orderId: `0x${string}`,
  ): Promise<OrderContainer> {
    try {
      const response = await ky
        .get(new URL("/orders/status/", this.baseUrl), {
          searchParams: { onChainOrderId: orderId },
          timeout: 15000,
        })
        .json();
      return parseOrderStatusPayload(response);
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 404) {
        throw new Error("Order not found");
      }
      if (
        error instanceof Error &&
        error.message.startsWith("Order payload invalid")
      ) {
        throw error;
      }
      console.error("Error getting order by id:", error);
      throw new Error("Failed to fetch order");
    }
  }

  async getQuotes(options: GetQuoteOptions): Promise<GetQuoteResponse> {
    const {
      user,
      userChainId,
      userNamespace,
      inputs,
      outputs,
      swapType = "exact-input",
      minValidUntil,
      exclusiveFor,
      preference,
      partialFill,
      failureHandling,
      integratorKey,
      oracle,
    } = options;

    const intent: Record<string, unknown> = {
      intentType: "oif-swap",
      swapType,
      inputs: inputs.map((input) => {
        const chain = toCaip2Chain(input.chainId, input.namespace);
        return {
          chain,
          user: toQuoteAddress(input.sender, "user", input.namespace),
          asset: toQuoteAddress(input.asset, "asset", input.namespace),
          amount: input.amount.toString(),
        };
      }),
      outputs: outputs.map((output) => {
        const chain = toCaip2Chain(output.chainId, output.namespace);
        const o: Record<string, unknown> = {
          chain,
          receiver: toQuoteAddress(
            output.receiver,
            "receiver",
            output.namespace,
          ),
          asset: toQuoteAddress(output.asset, "asset", output.namespace),
        };
        if (output.amount !== undefined) o.amount = output.amount.toString();
        return o;
      }),
    };

    if (minValidUntil !== undefined) intent.minValidUntil = minValidUntil;
    if (preference !== undefined) intent.preference = preference;
    if (partialFill !== undefined) intent.partialFill = partialFill;
    if (failureHandling !== undefined) intent.failureHandling = failureHandling;
    const metadata: Record<string, unknown> = {};
    const inputNamespace = inputs[0]?.namespace;
    if (exclusiveFor && exclusiveFor.length > 0) {
      metadata.exclusiveFor = exclusiveFor.map((solver) =>
        toQuoteAddress(
          toSolverAddress(solver, inputNamespace),
          "solver",
          inputNamespace,
        ),
      );
    }
    if (oracle !== undefined) {
      metadata.oracle = oracle.map(({ chainId, address }) => {
        if (
          (typeof chainId === "number" && !Number.isSafeInteger(chainId)) ||
          chainId <= 0
        ) {
          throw new Error("Oracle chain ID must be a positive EVM integer");
        }
        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
          throw new Error("Oracle contract must be a 20-byte EVM address");
        }
        if (
          [...inputs, ...outputs].some(
            (item) =>
              BigInt(item.chainId) === BigInt(chainId) &&
              item.namespace !== undefined &&
              item.namespace !== "eip155",
          )
        ) {
          throw new Error("Oracle filters support EVM chains only");
        }
        return { chain: toCaip2Chain(chainId, "eip155"), address };
      });
    }
    if (Object.keys(metadata).length > 0) intent.metadata = metadata;

    const rq = {
      user: {
        chain: toCaip2Chain(userChainId, userNamespace),
        address: toQuoteAddress(user, "user", userNamespace),
      },
      intent,
      supportedTypes: ["oif-user-open-v0"],
    };

    try {
      return await ky
        .post(new URL("/api/v1/integrator/quote/request", this.baseUrl), {
          json: rq,
          timeout: 15000,
          headers: integratorKey
            ? { "X-Integrator-Key": integratorKey }
            : undefined,
        })
        .json<GetQuoteResponse>();
    } catch (error) {
      console.error("Error fetching quote:", error);
      throw error;
    }
  }

  connectIntentApiSocket(newOrderFunction: intentApiPush) {
    let shouldReconnect = true;
    let backoffMs = 1000;
    const MAX_BACKOFF = 30000;
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!shouldReconnect) return;
      socket = new WebSocket(this.websocketUrl);

      socket.onmessage = function (event) {
        const message = JSON.parse(event.data);

        switch (message.event) {
          case "user:vm-order-submit": {
            const incomingOrder = message.data as SubmitOrderDto;
            newOrderFunction(incomingOrder);
            break;
          }
          case "ping":
            socket.send(
              JSON.stringify({
                event: "pong",
              }),
            );
            break;
          default:
            break;
        }
      };

      socket.addEventListener("open", () => {
        console.log("Connected to Catalyst intent-api");
        backoffMs = 1000; // Reset backoff on successful connection
      });

      socket.addEventListener("close", () => {
        console.log("Disconnected from Catalyst intent-api");
        if (shouldReconnect) {
          console.log(`Reconnecting in ${backoffMs}ms...`);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            connect();
          }, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
        }
      });

      socket.addEventListener("error", (event) => {
        console.error("WebSocket error:", event);
      });
    };

    connect();

    return {
      get socket() {
        return socket;
      },
      disconnect: () => {
        shouldReconnect = false;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        socket.close();
      },
    };
  }

  // -- Translations -- //

  /**
   * @notice Fetches all intents from the LI.FI intent-api and then transmutes them into OrderContainers.
   */
  async getAndParseOrders(): Promise<OrderContainer[]> {
    const response = await this.getOrders();
    return response.data.map((instance) => {
      const order: StandardOrder = {
        ...instance.order,
        nonce: BigInt(instance.order.nonce),
        originChainId: BigInt(instance.order.originChainId),
        inputs: instance.order.inputs.map(([tokenId, amount]) => [
          BigInt(tokenId),
          BigInt(amount),
        ]),
        outputs: instance.order.outputs.map((output) => ({
          ...output,
          chainId: BigInt(output.chainId),
          amount: BigInt(output.amount),
        })),
      };
      const allocatorSignature: Signature | NoSignature =
        instance.allocatorSignature
          ? { type: "ECDSA", payload: instance.allocatorSignature }
          : { type: "None", payload: "0x" };
      const sponsorSignature: Signature | NoSignature =
        instance.sponsorSignature
          ? { type: "ECDSA", payload: instance.sponsorSignature }
          : { type: "None", payload: "0x" };
      return {
        inputSettler: instance.inputSettler,
        order,
        sponsorSignature,
        allocatorSignature,
      };
    });
  }
}
