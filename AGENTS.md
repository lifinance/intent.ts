# intent.ts (`@lifi/intent`)

TypeScript SDK for LI.FI intents (OIF): order types, intent creation and conversion, order ids and
hashing for standard, multichain and compact orders, EVM, Solana, Stellar and Tron address helpers,
and the `IntentApi` quote client. Published to npm as `@lifi/intent` with the subpath
`@lifi/intent/axelar`. The [README](README.md) documents the public API per chain.

## Ownership

Squad Intents + Solver. Reviewer: Alexander (`@reednaa`).

## Layout

| Path             | What lives there                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `src/index.ts`   | Public entry point; anything exported here is public API                                       |
| `src/types/`     | Order, intent, quote, lock and signature types                                                 |
| `src/intent/`    | Intent builders and `fromOrder`, split by chain (`evm/`, `solana/`, `stellar/`, `compact/`)    |
| `src/helpers/`   | Address conversion per chain (Solana base58, Stellar strkey, Tron)                             |
| `src/api/`       | `IntentApi` HTTP client for quotes                                                             |
| `src/axelar/`    | Pure Axelar encoding behind the `@lifi/intent/axelar` subpath                                  |
| `src/compact/`   | Compact resource id helpers                                                                    |
| `relay/axelar/`  | Private workspace package: caller-operated Axelar relay CLI ([README](relay/axelar/README.md)) |
| `tests/vectors/` | Cross-repo test vectors (for example `stellarClientOrder.json` from intent-soroban)            |
| `scripts/`       | Build helpers: subpath markers and the post-build smoke test                                   |

Unit tests sit next to the code as `*.spec.ts`.

## Commands

```sh
bun install
bun run build         # rollup bundle + types + subpath markers + smoke test
bun run check         # tsc for the package and relay/axelar
bun run test          # bun test
bun run lint          # oxlint
bun run format:check  # oxfmt
```

The relay workspace has its own: `bun run --cwd relay/axelar test` and `bun run --cwd relay/axelar check`.

CI (`.github/workflows/bun-test.yml`) runs build, check and test on every PR. The pre-commit hook runs
lint-staged (oxfmt), then build and test, so commits are slow by design.

## Environment

The library reads no environment. Two exceptions:

- `RUN_LIVE_TESTS=true` enables the live API tests in `src/api/intentApi.spec.ts`; off by default.
- The relay CLI reads signer secrets (`OIF_AXELAR_MNEMONIC`, `OIF_SOLANA_KEYPAIR_FILE`,
  `OIF_EVM_PRIVATE_KEY`, `OIF_STELLAR_SECRET`) as documented in its README. All other relay
  configuration is an explicit JSON file.

## Conventions

- Address width depends on the field: `MandateOutput` fields (`oracle`, `settler`, `token`,
  `recipient`) and Solana and Stellar addresses are 32-byte hex, while EVM input-side fields
  (`user`, `inputOracle`, `inputSettler`) are 20-byte and order id hashing rejects padded ones.
  Convert native formats (base58, strkey) with the helpers in `src/helpers/` at the edges.
- Chain and oracle policy is injected through `IntentDeps`; the library never imports app config or
  mutates exported registries.
- Changing an order encoding or id must keep `tests/vectors/` passing; those vectors are shared with
  the contract repos.
- Releases: bump `version` in `package.json`, then push a matching `v<version>` tag
  (`.github/workflows/release-publish.yml` checks they match and publishes).
- Formatting is oxfmt (`.oxfmtrc.json`), linting oxlint (`.oxlintrc.json`); `_typos.toml` is the
  spelling allowlist.
