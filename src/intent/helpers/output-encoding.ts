import { encodeAbiParameters, encodePacked, parseAbiParameters } from "viem";
import {
  COIN_FILLER,
  SOLANA_OUTPUT_SETTLER_PDAS,
  TRON_OUTPUT_SETTLERS,
} from "../../constants";
import type { CoreVerifier, IntentDeps } from "../../deps";
import { addressToBytes32 } from "../../helpers/convert";
import type { MandateOutput, TokenContext } from "../../types";
import { ONE_MINUTE } from "./shared";

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
  inputOracle: `0x${string}`;
  sameChain: boolean;
  recipient: `0x${string}`;
  currentTime: number;
}): MandateOutput[] {
  const {
    exclusiveFor,
    outputTokens,
    getOracle,
    verifier,
    inputOracle,
    sameChain,
    recipient,
    currentTime,
  } = options;

  if (exclusiveFor) {
    const formattedCorrectly =
      exclusiveFor.length === 42 && exclusiveFor.slice(0, 2) === "0x";
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
      const solanaSettler =
        SOLANA_OUTPUT_SETTLER_PDAS[token.chainId.toString()];
      if (!solanaSettler)
        throw new Error(`Unsupported Solana chain id: ${token.chainId}`);
      outputSettler = solanaSettler;
    } else if (token.chainNamespace === "tron") {
      const tronSettler = TRON_OUTPUT_SETTLERS[token.chainId.toString()];
      if (!tronSettler)
        throw new Error(`Unsupported Tron chain id: ${token.chainId}`);
      outputSettler = tronSettler;
    } else {
      outputSettler = COIN_FILLER;
    }
    let outputOracle: `0x${string}`;
    if (sameChain) {
      outputOracle = addressToBytes32(outputSettler);
    } else if (verifier === "polymer") {
      // Polymer stores proofs under address(this) on the input chain, so
      // output.oracle must be the input chain's oracle for the lookup to match.
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
