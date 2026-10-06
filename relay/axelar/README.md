# Caller-operated Axelar relay

This private workspace package drives source verification, poll completion,
routing, proof signing, destination gateway approval, oracle execution and
Solana proof registration. It works for unpaid self-relay messages and for
manually finishing paid delivery. Axelar verifiers and signers still
authenticate every message. Self-relaying changes who pays and submits
transactions; it does not create a second trust path.

The standard Axelar executor cannot fund `register_proof` on Solana. Paid
relaying therefore still needs a caller-submitted registration: this relay, or
an equivalent that submits the `register` step from `axelarReceiveSteps`.

## Install and configure

From the repository root:

```sh
bun install
bun run --cwd relay/axelar test
bun run --cwd relay/axelar check
```

Instruction encoding, PDA derivation, provider hashing and admission limits come
from the published `@lifi/intent/axelar` subpath (`src/axelar/`). They are pure
functions: they never read private keys or contact RPC. All addresses, RPCs and
canonical chain IDs are explicit; nothing defaults to a public network. Example
configuration shape:

```json
{
  "source": {
    "platform": "stellar",
    "chainName": "stellar",
    "chainId": "REPLACE",
    "rpcUrl": "REPLACE",
    "networkPassphrase": "REPLACE",
    "oracle": "REPLACE",
    "gateway": "REPLACE",
    "gasService": "REPLACE"
  },
  "destination": {
    "platform": "solana",
    "chainName": "solana",
    "chainId": "REPLACE",
    "rpcUrl": "REPLACE",
    "genesisHash": "REPLACE",
    "oracle": "FHMjUtWovj3KvMea62D2api8HaJy8oGye4UFzsGKZHvw",
    "gateway": "REPLACE"
  },
  "hub": {
    "rpcUrl": "REPLACE",
    "chainId": "REPLACE",
    "gasPrice": "REPLACEuaxl",
    "sourceGateway": "REPLACE",
    "votingVerifier": "REPLACE",
    "destinationGateway": "REPLACE",
    "destinationProver": "REPLACE",
    "fullMessagePayloads": false
  }
}
```

Use the selected deployment's actual addresses and registered chain names.
Set `fullMessagePayloads` to its prover's `expect_full_message_payloads` setting.
The hub API target is the permissionless Amplifier gateway, voting verifier
(`poll_by_message` support required), and multisig prover. This flow does not
target legacy Axelar Core gateways. EVM execution targets the Amplifier gateway.
For a Solana destination, optional `computeUnitPrice` (integer microlamports per
compute unit) adds a `SetComputeUnitPrice` priority fee to each relay
transaction; omit it to send without a priority fee.

## Before funding an order

Call `checkSolanaAxelarAdmission` from `@lifi/intent/axelar` with
callback/context lengths and both chain IDs. Reject proofs over 320 bytes
(`AXELAR_MAX_PROOF_BYTES`); split transport batches to one proof/message.
`admission` in `src/solana.ts` (also `bun run --cwd relay/axelar relay admit
ADMISSION.json`) wraps that check and additionally serializes supplied
source/execute/register instructions, including compute budget instructions,
rejecting transactions over 1,232 bytes before signing. Use
`axelarSubmitInstruction` to construct source instructions; default to
non-consuming submission. Consuming mode requires the recorded rent recipient.
Simulate the actual open/fill/claim transaction and check native rent/fees as well.

Every application that opens or funds an order routed over Axelar to or from
Solana (Stellar, EVM or Solana clients alike) must call
`checkSolanaAxelarAdmission({ callbackBytes, contextBytes, sourceChainId,
destinationChainId })` from `@lifi/intent/axelar` before `open`, so oversize
orders fail before funding. Generic escrow contracts cannot infer the selected
transport's lower operational limits.

Solana `deployment(manifest, payer)` in `src/deployment.ts` validates the
manifest and returns the `axelarInitializeInstruction` result, one
`axelarSetChainMappingInstruction` per manifest route, and the command to revoke
the program upgrade authority. The initializing `payer` must be the upgrade
authority; the manifest's `owner` becomes the mapping owner, who signs every
mapping (`chainMapping(route, owner)` builds later additions) and can transfer
(`axelarTransferOwnershipInstruction`) or renounce
(`axelarRenounceOwnershipInstruction`) ownership. Route kinds are `evm`,
`stellar` or `solana`; Solana-kind routes need a nonzero `destinationConfig` on
`axelarSubmitInstruction`. Chain names
are lowercase Axelar names of at most 20 bytes; mappings are set once and cannot
change. Verify the program ID, protocol chain ID and gateway deployment before
initializing; revoke upgrade authority after initialization. Exported source
oracle is the program ID, while the receiving input-oracle identifier is its
configuration PDA. `axelarConfigAddress()` derives that PDA for EVM/Stellar
submissions; `axelarRouteAddress(name)` derives a chain's mapping account, and
`decodeAxelarConfig` / `decodeAxelarRoute` read them back.

## Relay and resume

```sh
bun run --cwd relay/axelar relay extract CONFIG.json SOURCE_TX JOB.json
bun run --cwd relay/axelar relay status JOB.json
bun run --cwd relay/axelar relay relay JOB.json --broadcast
bun run --cwd relay/axelar relay finish JOB.json --broadcast
```

`bun run --cwd` resolves relative paths from `relay/axelar`; pass absolute paths
for files elsewhere.

Extraction verifies a successful finalized source transaction, the gateway event,
payload hash and configured route. Supply the complete message ID as a final
argument when a transaction contains multiple exports. Solana message IDs use the
actual event CPI's one-based outer/inner indices; Stellar uses the inner hash for
fee-bump transactions. Preserve gateway string casing in the signed message.

Set `OIF_AXELAR_MNEMONIC` for the hub fee payer. For the destination set one of
`OIF_SOLANA_KEYPAIR_FILE`, `OIF_EVM_PRIVATE_KEY`, or `OIF_STELLAR_SECRET`.
Keys stay outside the job and journal. The CLI only broadcasts with `--broadcast`.
`finish` uses existing destination approvals; `relay` drives the entire path.
Exit code 2 means pending external verification, signing or inclusion: run again.

On Solana, `axelarApprovalSteps` supplies the gateway approval transactions and
`axelarReceiveSteps` the standard execute and `register_proof` transactions. Each
step names the account whose authenticated gateway or protocol state proves it
complete, so a pass skips steps another relayer already finished.

The relay reads the provider's `VerificationStatus` response. Successful source
verification proceeds directly to routing, including before poll expiry. An
in-progress vote waits; `failed_to_verify` (no consensus) and
`not_found_on_source_chain` allow a replacement poll. Each pass starts at most
one new verification request. A verified source-transaction failure is terminal.

Each `construct_proof` starts a signing session under the prover's current
verifier set. A session that remains unsigned past its `expires_at` height is
renewed with one replacement request. If the destination definitively rejects a
completed proof (a failed simulation or an on-chain failure of the approval) and
the prover has since rotated its verifier set, the relay discards that proof
(exit code 2); the next `relay` pass signs a replacement session with the
current set. A lost response or RPC error never discards a proof, because the
journaled approval may still be in flight.
Destination approvals are journaled per signing session, so a
replacement never replays the rejected session's signed approval.

Each pass reconciles gateway state. The adjacent journal atomically saves signed
bytes before broadcasting and reuses those bytes after lost responses. Preserve
it across restarts. The journal is bound to the message, payload, chain names
and IDs, contract addresses and network identifiers of the job; RPC URLs, the
hub `gasPrice` and Solana `computeUnitPrice` are excluded, so they can be changed
between passes without abandoning the journal. A lock prevents concurrent
writers to the same journal; another relayer may still finish on-chain first,
which exact state checks handle.
Verification retries use a separate journal entry tied to the preceding poll.
An outstanding signed verification request is reconciled before another attempt
can be signed, even if another relayer has advanced the poll in the meantime.
Do not delete a lock until its process is stopped. Solana blockhash expiry clears
only an unconfirmed expired attempt, allowing a fresh attempt on the next pass.
For expired Stellar or failed Cosmos/EVM attempts, reconcile the stored hash and
sequence/nonce before replacing a journal entry. No ambiguous payment is retried
under a fresh signature automatically. Restore archived Stellar state explicitly.

`funding(job, payer, amount)` in `src/funding.ts` returns an unsigned provider
native-gas top-up tied to the original message ID (`axelarFundInstruction` on
Solana). A wallet can fund a previously unpaid message later. Save its signed
bytes using the same journal discipline. The adapter never withdraws provider
funds; refund handling belongs to Axelar.

After registration, use the Solana finalisation builder or the Stellar client
from the `lifi-intent-svm` and `intent-soroban` repositories to claim/refund.
The origin claimant still authorizes a claim; proof delivery does not choose a
payout address. Fast refunds require a valid non-fill proof after the committed
deadline. Expiry refunds remain independent of message delivery.

## Tests and provenance

```sh
bun test relay        # from the repository root
```

The relay tests cover bounded serialization, rejected proof substitutions,
on-chain replay checks, interrupted journal recovery and the hub state machine.
The [provider response fixtures](test/fixtures/README.md) derive verification
statuses from the pinned Axelar enum independently of the relay. Hub regressions
exercise successful routing, poll replacement, terminal failure, signing-session
renewal, verifier-set rotation and lost-response recovery through the real disk
journal and transaction serialization. Byte-level parity of the
`@lifi/intent/axelar` builders with the pinned Rust provider crates is covered
by `src/axelar/*.spec.ts` against `tests/vectors/axelarClientVectors.json`.

The real provider and escrow tests, the reviewed provider-binary manifest, and
the bidirectional cross-VM handshake live in `lifi-intent-svm`
(`cargo test -p axelar_litesvm --locked`). The handshake uses actual EVM, Stellar
and Solana settlers/adapters in both directions and both fee modes. EVM/Stellar
provider routing is a deterministic fixture; Solana gateway verification executes
actual pinned SBF and signatures. No network verifier quorum is simulated as a
claim of live network delivery.

Provider source pins: Solana `c954d865c034a67b8cb91632d8f8910d75ddb373`,
Amplifier `21bdc767f23412c5ae9e76c5ea94813db48209da`, and the official
[axe relay sequence](https://github.com/axelarnetwork/axe/blob/6e44efabcffb628d7b0c5b7edd1d229e74f71ef6/src/commands/test_gmp/relay.rs).
