import { encodeAbiParameters, encodePacked, parseAbiParameters } from "viem";
import { COIN_FILLER } from "../../constants";
import type { CoreVerifier, IntentDeps } from "../../deps";
import { addressToBytes32 } from "../../helpers/convert";
import type { MandateOutput, Namespace, TokenContext } from "../../types";
import {
  ONE_MINUTE,
  outputSettlerForSolana,
  outputSettlerForTron,
  polymerOracleProgramForSolana,
} from "./shared";

export function encodeOutputs(outputs: MandateOutput[]) {
  return encodeAbiParameters(
    parseAbiParameters(
      "(bytes32 oracle, bytes32 settler, uint256 chainId, bytes32 token, uint256 amount, bytes32 recipient, bytes callbackData, bytes context)[]",
    ),
    [outputs],
  );
}

/**
 * recipient must be a bytes32-padded address (32 bytes, 0x-prefixed).
 */
export function buildMandateOutputs(options: {
  exclusiveFor?: `0x${string}`;
  outputTokens: TokenContext[];
  getOracle: IntentDeps["getOracle"];
  verifier: CoreVerifier;
  inputChainId: bigint;
  inputNamespace: Namespace;
  sameChain: boolean;
  recipient: `0x${string}`;
  currentTime: number;
}): MandateOutput[] {
  const {
    exclusiveFor,
    outputTokens,
    getOracle,
    verifier,
    inputChainId,
    inputNamespace,
    sameChain,
    recipient,
    currentTime,
  } = options;

  if (exclusiveFor) {
    // 20-byte EVM/Tron address or a 32-byte Solana solver pubkey. The output
    // settler compares `exclusive_for` against the raw 32-byte solver
    // identity (output_settler_simple/src/utils/resolve_output.rs:62-71), so
    // restricting this to 20 bytes makes exclusive fills structurally
    // impossible on Solana outputs.
    const formattedCorrectly = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(
      exclusiveFor,
    );
    if (!formattedCorrectly) {
      throw new Error(`ExclusiveFor not formatted correctly ${exclusiveFor}`);
    }
  }

  let context: `0x${string}` = "0x";
  if (exclusiveFor) {
    const paddedExclusiveFor = addressToBytes32(exclusiveFor);
    context = encodePacked(
      ["bytes1", "bytes32", "uint32"],
      ["0xe0", paddedExclusiveFor, currentTime + ONE_MINUTE],
    );
  }

  return outputTokens.map(({ token, amount }) => {
    let outputSettler: `0x${string}`;
    if (token.chainNamespace === "solana") {
      outputSettler = outputSettlerForSolana(token.chainId);
    } else if (token.chainNamespace === "tron") {
      outputSettler = outputSettlerForTron(token.chainId);
    } else {
      outputSettler = COIN_FILLER;
    }
    let outputOracle: `0x${string}`;
    if (sameChain) {
      outputOracle = addressToBytes32(outputSettler);
    } else if (token.chainNamespace === "solana" && verifier === "polymer") {
      // Solana identifies its oracle to the EVM PolymerOracle by PROGRAM ID
      // (`returnedProgramId`), and `oracle_polymer::submit` requires the
      // fill's LocalAttestation consumer — which is `output.oracle` — to equal
      // its own program id (oracle_polymer/src/instructions/submit.rs:71).
      //
      // The input-chain-oracle rule below only holds because PolymerOracle is
      // CREATE2-identical across EVM chains; it does not carry over here. Using
      // it for a Solana output produces an order that fills and can then never
      // be proven.
      outputOracle = polymerOracleProgramForSolana(token.chainId);
    } else if (verifier === "polymer" && inputNamespace === "solana") {
      // Solana INPUT, EVM/Tron output. The input chain's oracle is a 32-byte
      // PDA, and the EVM output settler rejects it outright:
      // `_fill` calls `LibAddress.validatedCleanAddress(uint256(output.oracle))`
      // which reverts `HasDirtyBits()` on any value with non-zero upper 12
      // bytes (OutputSettlerBase.sol:175, mirrored on emitNotFilled at :322).
      // So the input-chain-oracle rule below cannot apply here.
      //
      // The output chain's own oracle is safe: for a Solana input,
      // `oracle_polymer::receive_attest` keys the attestation by `output.oracle`
      // exactly as the order declares it, and `validate_fill` reads back the
      // same declared value (input_settler_base/src/base.rs:193) — so any
      // clean-address value is self-consistent on lookup.
      const outputOracleAddress = getOracle(verifier, token.chainId);
      if (!outputOracleAddress)
        throw new Error(
          `No oracle configured for verifier "${verifier}" on chain ${token.chainId}`,
        );
      outputOracle = addressToBytes32(outputOracleAddress);
    } else if (verifier === "polymer") {
      // Polymer stores proofs under address(this) on the input chain, so
      // output.oracle must be the input chain's oracle for the lookup to match.
      // Only valid for an EVM-shaped input: Tron's oracle is a different
      // address from the CREATE2-identical EVM one, hence "the input chain's",
      // not a constant.
      const inputOracle = getOracle(verifier, inputChainId);
      if (!inputOracle)
        throw new Error(
          `No oracle configured for verifier "${verifier}" on chain ${inputChainId}`,
        );
      outputOracle = addressToBytes32(inputOracle);
    } else {
      const oracle = getOracle(verifier, token.chainId);
      if (!oracle)
        throw new Error(
          `No oracle configured for verifier "${verifier}" on chain ${token.chainId}`,
        );
      outputOracle = addressToBytes32(oracle);
    }
    return {
      oracle: outputOracle,
      settler: addressToBytes32(outputSettler),
      chainId: token.chainId,
      token: addressToBytes32(token.address),
      amount: amount,
      recipient,
      callbackData: "0x",
      context,
    };
  }) as MandateOutput[];
}
