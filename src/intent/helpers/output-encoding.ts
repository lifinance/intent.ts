import {
  concat,
  encodeAbiParameters,
  encodePacked,
  parseAbiParameters,
} from "viem";
import { COIN_FILLER } from "../../constants";
import type { CoreVerifier, IntentDeps } from "../../deps";
import { addressToBytes32 } from "../../helpers/convert";
import type { MandateOutput, Namespace, TokenContext } from "../../types";
import {
  ONE_MINUTE,
  outputSettlerForSolana,
  outputSettlerForTron,
  outputSettlerForStellar,
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
 * Validates the exclusive solver against the INPUT chain's address space and
 * returns it as bytes32.
 *
 * The output settler treats the solver as an opaque bytes32 — it only compares
 * it to `exclusive_for` and records it in the fill
 * (output_settler_simple/src/utils/resolve_output.rs:62-71). It is the INPUT
 * settler that pays the solver out, so the identity has to be one that chain
 * can recognise:
 *
 * - Solana inputs finalise only for the signer named in the fill
 *   (`solve_params[0].solver == solver.key()`, input_settler_escrow finalise),
 *   so a zero-padded EVM address is a key that cannot sign. Such an order
 *   opens, escrows the input, can be filled, and can then never be settled —
 *   the fill record on the output chain pins the wrong identity permanently.
 * - EVM and Tron inputs pay out to the low 20 bytes, so a 32-byte Solana key
 *   would be silently truncated to an address nobody holds.
 *
 * The 12-leading-zero-byte test separates the two spaces: EVM and Tron
 * addresses always have them, an ed25519 key has them with probability 2^-96.
 * It answers "which address space is this", not "can this key sign" — an
 * off-curve Solana pubkey (a PDA, a program id) passes it, and choosing a
 * solver identity that can actually sign stays the caller's job.
 */
function exclusiveForForInput(
  exclusiveFor: `0x${string}`,
  inputNamespace: Namespace,
): `0x${string}` {
  if (!/^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(exclusiveFor)) {
    throw new Error(`ExclusiveFor not formatted correctly ${exclusiveFor}`);
  }
  const bytes32 = addressToBytes32(exclusiveFor);
  const isEvmShaped = bytes32.slice(2, 26) === "0".repeat(24);
  const needsKey = inputNamespace === "solana" || inputNamespace === "stellar";
  if (needsKey && isEvmShaped) {
    throw new Error(
      inputNamespace === "solana"
        ? `ExclusiveFor ${exclusiveFor} is not a Solana pubkey: a solana-origin order finalises only for the solver that signs on Solana, so a padded EVM address makes the order fillable but impossible to settle. Pass the solver's 32-byte pubkey (solanaBase58ToBytes32).`
        : `ExclusiveFor ${exclusiveFor} is not a Stellar address commitment: a stellar-origin order finalises only for the claimant whose commitment matches the fill, so a padded EVM address makes the order fillable but impossible to settle. Pass stellarAddressCommitment(solver).`,
    );
  }
  if (!needsKey && !isEvmShaped) {
    throw new Error(
      `ExclusiveFor ${exclusiveFor} is not a ${inputNamespace} address: the ${inputNamespace} input settler pays out to the low 20 bytes, so a 32-byte key would be truncated to an address nobody holds.`,
    );
  }
  return bytes32;
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
  /** Exclusivity window in seconds from `currentTime`. Defaults to 60. */
  exclusivity?: number;
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
    exclusivity = ONE_MINUTE,
  } = options;

  let context: `0x${string}` = "0x";
  if (exclusiveFor) {
    const exclusiveForBytes32 = exclusiveForForInput(
      exclusiveFor,
      inputNamespace,
    );
    context = encodePacked(
      ["bytes1", "bytes32", "uint32"],
      ["0xe0", exclusiveForBytes32, currentTime + exclusivity],
    );
  }

  return outputTokens.map(({ token, amount }) => {
    let outputSettler: `0x${string}`;
    if (token.chainNamespace === "solana") {
      outputSettler = outputSettlerForSolana(token.chainId);
    } else if (token.chainNamespace === "tron") {
      outputSettler = outputSettlerForTron(token.chainId);
    } else if (token.chainNamespace === "stellar") {
      outputSettler = outputSettlerForStellar(token.chainId);
    } else {
      outputSettler = COIN_FILLER;
    }
    if (token.chainNamespace === "stellar" && verifier !== "axelar")
      throw new Error("Stellar outputs require the axelar verifier");
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
      // The Stellar OutputSettler reads a recipient tag after the pricing
      // context; 0x00 marks a plain account (`G…`) recipient.
      context:
        token.chainNamespace === "stellar"
          ? concat([context, "0x00"])
          : context,
    };
  }) as MandateOutput[];
}
