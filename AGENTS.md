# intent.ts

TypeScript SDK for LI.FI intents and OIF. The [README](README.md) is the reference for the order
models, creation flow, dependency model and per-chain usage.

## Features by folder

- `src/intent/`: the `Intent` builder, `orderToIntent` and order id derivation for standard,
  multichain and compact orders, per chain (`evm/`, `solana/`, `stellar/`, `compact/`).
- `src/types/`: order, mandate, quote, lock, token and signature types.
- `src/validation.ts`, `src/output.ts`, `src/typedMessage.ts`: order validation, output
  encoding and hashing, EIP-712 types and type hashes.
- `src/helpers/`: address conversion between native formats and bytes32 (Solana, Stellar, Tron).
- `src/api/`: `IntentApi` quote client and intent-api payload parsing.
- `src/axelar/`: Axelar message encoding.
- `src/compact/`: Compact resource lock id helpers.
- `relay/axelar/`: caller-operated Axelar relay CLI, a private workspace package with its own README.
- `tests/vectors/`: encoding and order id vectors shared with the contract repos.

## Constraints

- Encodings, order ids and type hashes must match the contracts; a change there is a protocol
  change and must keep `tests/vectors/` passing.
- Chain and oracle policy comes in through `IntentDeps`; the library never imports app config.
- Live API tests in `src/api/` run only with `RUN_LIVE_TESTS=true`.
- CI runs the `build`, `check` and `test` scripts from `package.json`.

## Package

Published to npm as `@lifi/intent`, with `src/axelar/` as the subpath `@lifi/intent/axelar`.
A release is a `version` bump in `package.json` plus a matching `v<version>` tag.

## Ownership

Squad Intents + Solver. Reviewer: Alexander (`@reednaa`).
