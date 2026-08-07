import { encodePacked, keccak256 } from "viem";
import type { MandateOutput } from "./types/index";

/**
 * Domain magic leading every serialised OIF FillDescription:
 * `bytes4(keccak256("OIF.Fill"))`.
 */
export const FILL_MAGIC = "0xd1252dff" as const;

/**
 * Domain magic leading every serialised OIF NotFilledDescription:
 * `bytes4(keccak256("OIF.NotFilled"))`.
 */
export const NOT_FILLED_MAGIC = "0x830c1e1c" as const;

const byteLength = (hex: `0x${string}`) => (hex.length - 2) / 2;

/**
 * Hash of the serialised MandateOutput struct — the output identity key.
 *
 * NOTE: this is *not* one of the cross-chain proof payloads and deliberately
 * carries no domain magic. Its preimage is
 * `oracle‖settler‖chainId‖token‖amount‖recipient‖uint16(cbLen)‖cb‖uint16(ctxLen)‖ctx`
 * and it never leaves the output chain. The proof payloads
 * ({@link encodeFillDescription}, {@link encodeNotFilledDescription}) each lead
 * with a distinct 4-byte magic so the two proof domains can never be
 * cross-consumed; do not add a magic here. See `MandateOutputEncodingLib` in
 * the OIF contracts.
 */
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
        byteLength(output.callbackData),
        output.callbackData,
        byteLength(output.context),
        output.context,
      ],
    ),
  );
}

/**
 * Serialises an OIF FillDescription — the proof payload attesting that an
 * output was filled.
 *
 * Layout (packed, big-endian, no ABI padding):
 * `FILL_MAGIC(4)‖solver(32)‖orderId(32)‖uint32(timestamp)‖token(32)‖amount(32)‖
 * recipient(32)‖uint16(cbLen)‖cb‖uint16(ctxLen)‖ctx`.
 */
export function encodeFillDescription({
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
      "bytes4",
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
      FILL_MAGIC,
      solver,
      orderId,
      timestamp,
      output.token,
      output.amount,
      output.recipient,
      byteLength(output.callbackData),
      output.callbackData,
      byteLength(output.context),
      output.context,
    ],
  );
}

/**
 * Alias of {@link encodeFillDescription} under its historical name.
 *
 * @deprecated Prefer {@link encodeFillDescription}: this name predates the
 * contracts calling the payload a "fill description", and it reads as if it
 * serialised a `MandateOutput` (that is {@link getOutputHash}'s preimage).
 *
 * BREAKING: the bytes this returns changed in v0.3.0 — it previously omitted
 * the mandatory leading {@link FILL_MAGIC}, so every payload and hash it
 * produced was rejected by the deployed OIF contracts. Callers that persisted
 * or compared old payloads/hashes must recompute them.
 */
export const encodeMandateOutput = encodeFillDescription;

/**
 * Serialises an OIF NotFilledDescription — the proof payload attesting that an
 * output was provably *not* filled before its fill deadline (the refund path).
 *
 * Layout (packed, big-endian, no ABI padding):
 * `NOT_FILLED_MAGIC(4)‖orderId(32)‖uint32(fillDeadline)‖token(32)‖amount(32)‖
 * recipient(32)‖uint16(cbLen)‖cb‖uint16(ctxLen)‖ctx`.
 */
export function encodeNotFilledDescription({
  orderId,
  fillDeadline,
  output,
}: Readonly<{
  orderId: `0x${string}`;
  fillDeadline: number;
  output: MandateOutput;
}>) {
  return encodePacked(
    [
      "bytes4",
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
      NOT_FILLED_MAGIC,
      orderId,
      fillDeadline,
      output.token,
      output.amount,
      output.recipient,
      byteLength(output.callbackData),
      output.callbackData,
      byteLength(output.context),
      output.context,
    ],
  );
}

/**
 * keccak256 of a serialised FillDescription — the value an input oracle is
 * queried with (`isProven(...)`) and the value attesters sign over.
 */
export function getFillDescriptionHash(
  args: Parameters<typeof encodeFillDescription>[0],
) {
  return keccak256(encodeFillDescription(args));
}

/**
 * keccak256 of a serialised NotFilledDescription — the non-fill counterpart of
 * {@link getFillDescriptionHash}.
 */
export function getNotFilledDescriptionHash(
  args: Parameters<typeof encodeNotFilledDescription>[0],
) {
  return keccak256(encodeNotFilledDescription(args));
}
