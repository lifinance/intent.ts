# Axelar verification responses

`verification-status.json` contains literal `messages_status` response examples.
Message contents are synthetic. Status values are derived independently of the
client from `VerificationStatus` at Amplifier revision
`21bdc767f23412c5ae9e76c5ea94813db48209da`, using the enum's `cw_serde`
snake-case serialization. The fixture records the source URL and SHA-256.

Primary sources:

- [VerificationStatus](https://github.com/axelarnetwork/axelar-amplifier/blob/21bdc767f23412c5ae9e76c5ea94813db48209da/packages/axelar-wasm-std/src/verification.rs)
- [MessageStatus response shape](https://github.com/axelarnetwork/axelar-amplifier/blob/21bdc767f23412c5ae9e76c5ea94813db48209da/contracts/voting-verifier/src/msg.rs)
- [Consensus and expiry status calculation](https://github.com/axelarnetwork/axelar-amplifier/blob/21bdc767f23412c5ae9e76c5ea94813db48209da/contracts/voting-verifier/src/contract/query.rs)
- [Retry eligibility](https://github.com/axelarnetwork/axelar-amplifier/blob/21bdc767f23412c5ae9e76c5ea94813db48209da/contracts/voting-verifier/src/contract/execute.rs)

`Vote::SucceededOnChain` and `VerificationStatus::SucceededOnSourceChain` are
different types. The status query returns the latter. Do not derive expected RPC
responses from constants in `src/hub.ts` when updating these fixtures.

The tests substitute RPC and signing, but use the actual `hubTransaction`,
transaction encoding and disk `Journal`. They exercise recovery without
broadcasting or claiming to test a live provider quorum.
