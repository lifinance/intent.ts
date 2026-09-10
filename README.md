# Core Library

`src` is the domain layer for orders and intents.

It owns:

- Order data models and type guards.
- Intent creation and conversion logic.
- Order id and hashing logic for standard + multichain flows.
- Core validation/parsing used by higher-level libraries/screens.
- Dependency-injected domain behavior (for chain/oracle policy), without importing app config.

It does not own:

- UI behavior from app workspaces (`app/*`).
- External orchestration wrappers that live outside this package (except core parsing helpers in `api/`).

## Installation

```sh
npm install @lifi/intent
```

Runtime target: Node.js 20+.

## Solana

Solana public keys and mint addresses use base58 externally and 32-byte hex
internally. Convert native Solana addresses before building an intent, and
convert back to base58 when displaying them:

```ts
import { bytes32ToSolanaBase58, solanaBase58ToBytes32 } from "@lifi/intent";

const recipient = solanaBase58ToBytes32(
  "FWBFarytmqKQajUDiqH6VCAJ2bt4d2Q4X4g38zKQehCy",
);
const mint = solanaBase58ToBytes32(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

const token = {
  address: mint,
  name: "USDC",
  chainId: 1151111081099710n,
  decimals: 6,
  chainNamespace: "solana" as const,
};

console.log(bytes32ToSolanaBase58(recipient));
```

When requesting a quote, set `namespace: "solana"` on every Solana input or
output. The API client accepts either native base58 or internal bytes32 hex and
normalizes the wire representation. An omitted namespace defaults to
`eip155`, so a 32-byte Solana address under that namespace is rejected locally.

Current Solana support is limited to standard single-input orders on mainnet
and devnet. Testnet has no configured deployment. Solana inputs are not
supported in multichain or compact orders.

## Architecture

- `types.ts`
  - Canonical types such as `StandardOrder`, `MultichainOrder`, and `OrderContainer`.
  - Core token model is chain-id based (`token.chainId`), not chain-name based.
- `deps.ts`
  - Minimal dependency interfaces consumed by core constructors/functions.
- `intent/`
  - `create.ts`: High-level `Intent` builder.
  - `fromOrder.ts`: `orderToIntent(...)` and `isStandardOrder(...)`.
  - `standard.ts` / `multichain.ts`: Concrete intent implementations and order-id derivation.
  - `compact/*`: Compact conversions/signing/claims helpers used by intent flows.
- `orderLib.ts`
  - Validation helpers (`validateOrder...`) and output encoding/hash helpers.
  - Multi-argument helpers accept object params, e.g. `validateOrderWithReason({ order, deps })`.
- `api/intentApi.ts`
  - Normalization/parsing for intent-api payloads.
- `typedMessage.ts`
  - EIP-712 type definitions and precomputed type hashes used in compact flows.
- `helpers/` and `compact/`
  - Shared low-level helpers (conversions and compact lock/id utilities).

## Core Entry Points

Most contributors start with `intent/index.ts`:

- `orderToIntent(...)`
- `isStandardOrder(...)`
- `StandardOrderIntent`
- `MultichainOrderIntent`
- `computeStandardOrderId(...)`
- `computeMultichainEscrowOrderId(...)`
- `computeMultichainCompactOrderId(...)`
- `hashMultichainInputs(...)`

## Order Models

`OrderContainer` wraps:

- `inputSettler`
- `order` (`StandardOrder | MultichainOrder`)
- sponsor/allocator signatures

Use `isStandardOrder(...)` as the canonical discriminator for branching between single-chain and multichain order logic.

## Order Creation Flow

Typical contributor path:

1. Build an intent with `Intent` in `intent/create.ts` and inject `IntentDeps`.
2. Convert/hydrate with `orderToIntent(...)` from `intent/fromOrder.ts`.
3. Compute `orderId()` and chain-specific behavior through `StandardOrderIntent` or `MultichainOrderIntent`.

Example: create/convert and derive order id.

```ts
import { orderToIntent } from "@lifi/intent";
import type { OrderContainer } from "@lifi/intent";

function getOrderId(orderContainer: OrderContainer): `0x${string}` {
  return orderToIntent(orderContainer).orderId();
}
```

Example: branch behavior by order type during creation/execution logic.

```ts
import { isStandardOrder, orderToIntent } from "@lifi/intent";
import type { OrderContainer } from "@lifi/intent";

function getInputCount(orderContainer: OrderContainer): number {
  if (isStandardOrder(orderContainer.order))
    return orderContainer.order.inputs.length;
  return orderContainer.order.inputs.reduce(
    (sum, v) => sum + v.inputs.length,
    0,
  );
}

function getInputChains(orderContainer: OrderContainer): bigint[] {
  return orderToIntent(orderContainer).inputChains();
}
```

## Hashing and Typed Messages

`typedMessage.ts` defines EIP-712 type structures and verifies that computed type hashes match expected on-chain constants. Any change here can break compact claim/signature compatibility.

When touching compact hashing or typed message definitions:

- Keep encodings aligned with contracts.
- Treat hash constant changes as protocol-level changes.

## Validation and Parsing

- `orderLib.ts`
  - `validateOrderWithReason(...)`
  - `validateOrderContainerWithReason(...)`
- `api/intentApi.ts`
  - `parseOrderStatusPayload(...)`

These utilities are the core gate for normalizing and validating inbound order data before execution paths consume it.

## Dependency Model

- Core has no direct imports from app config/util modules.
- Dependencies are passed in scope at creation time (constructor/function), never via global mutable runtime.
- Keep dependencies minimal:
  - `Intent` receives `IntentDeps`.
  - Standard order validation receives `StandardOrderValidationDeps` (`{ order, deps }`).
  - Container validation receives `OrderContainerValidationDeps` (`{ orderContainer, deps }`), adding `inputSettlers` for compact input-settler policy.
  - Core-internal protocol constants live in `constants.ts`.

## Test Layout

- Unit tests are colocated with features in `src/**/<feature>.spec.ts`.
- Every non-`index.ts` runtime module in `src/` must have a sibling `.spec.ts`.
- `index.ts` barrel files are excluded from that requirement.
- Type-only modules (for example `src/types/**` and `src/intent/types.ts`) should not have individual `.spec.ts` coverage.
- Rely on TypeScript checks and behavior tests that consume those types.
- Integration tests live under `tests/`.
- Bare spec files in `src/` (no sibling source module) are not allowed.

## Safe Change Checklist

- Use `isStandardOrder(...)` for order branching, not ad-hoc property checks.
- Keep hashing/encoding behavior stable unless you are intentionally changing protocol semantics.
- Keep core APIs chain-id based. Map app chain names to ids at app boundaries.
- Update/add tests when changing order construction, parsing, or hashing behavior.
- Run `bun run check` and relevant unit tests before merging.

## File References

- `src/types/index.ts`
- `src/intent/index.ts`
- `src/intent/create.ts`
- `src/intent/fromOrder.ts`
- `src/intent/standard.ts`
- `src/intent/multichain.ts`
- `src/output.ts`
- `src/validation.ts`
- `src/api/intentApi.ts`
- `src/typedMessage.ts`

### Explicit EVM oracle quotes

Pass `oracle: [{ chainId: 1, address: vowAdapter }, { chainId: 8453, address: vowAdapter }]` to `IntentApi.getQuotes` to require the listed oracle contracts on both sides of a cross-chain route. The SDK sends these as `intent.metadata.oracle` with `eip155` chain identifiers, alongside any `exclusiveFor` metadata. Omitting the option preserves the API's default oracle selection; an empty list also allows the API defaults. Same-chain swaps ignore oracle selection.
