import { encodePacked, keccak256 } from "viem";
import type { MandateOutput } from "./types/index";

export function getOutputHash(output: MandateOutput) {
  return keccak256(
    encodePacked(
      [
        "bytes32",
        "bytes32",
        "uint256",
        "bytes32",
        "uint256",
        "bytes32",
        "uint16",
        "bytes",
        "uint16",
        "bytes",
      ],
      [
        output.oracle,
        output.settler,
        output.chainId,
        output.token,
        output.amount,
        output.recipient,
        output.callbackData.replace("0x", "").length / 2,
        output.callbackData,
        output.context.replace("0x", "").length / 2,
        output.context,
      ],
    ),
  );
}

/**
 * Serialises a FillDescription for proof lookups (`isProven`).
 *
 * ⚠️ KNOWN INCOMPATIBILITY with the settler generation whose addresses this file
 * now points at. Upstream `MandateOutputEncodingLib` was reworked to prefix every
 * cross-chain proof payload with a 4-byte domain magic:
 *   FILL_MAGIC       = bytes4(keccak256("OIF.Fill"))      = 0xd1252dff
 *   NOT_FILLED_MAGIC = bytes4(keccak256("OIF.NotFilled")) = 0x830c1e1c
 * The layout below is still the old, unprefixed one, so `keccak256(encodeMandateOutput(...))`
 * will not match the payload hash the new oracles/settlers store, and proof lookups
 * silently return "not proven". Needs a follow-up that adds the magic (and a
 * `NotFilledDescription` encoder) plus golden vectors against the Solidity library.
 * `getOutputHash` above is unaffected: its preimage is unchanged upstream.
 */
export function encodeMandateOutput({
  solver,
  orderId,
  timestamp,
  output,
}: Readonly<{
  solver: `0x${string}`;
  orderId: `0x${string}`;
  timestamp: number;
  output: MandateOutput;
}>) {
  return encodePacked(
    [
      "bytes32",
      "bytes32",
      "uint32",
      "bytes32",
      "uint256",
      "bytes32",
      "uint16",
      "bytes",
      "uint16",
      "bytes",
    ],
    [
      solver,
      orderId,
      timestamp,
      output.token,
      output.amount,
      output.recipient,
      output.callbackData.replace("0x", "").length / 2,
      output.callbackData,
      output.context.replace("0x", "").length / 2,
      output.context,
    ],
  );
}
