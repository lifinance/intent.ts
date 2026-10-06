import {
  Address,
  Asset,
  Contract,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Interface } from "ethers";
import {
  axelarFundInstruction,
  type AxelarInstruction,
} from "../../../src/axelar/index";
import { validateJob, type Job } from "./source";

export type EvmFunding = { to: string; value: bigint; data: string };

// Returns an unsigned native funding request for an existing verified source message.
// Funding is opt-in and independent of destination execution. Persist signed bytes before sending.
export function funding(
  job: Job,
  payer: string,
  amount: bigint | string | number,
): AxelarInstruction | EvmFunding | xdr.Operation {
  validateJob(job);
  if (typeof amount === "number" && !Number.isSafeInteger(amount))
    throw new Error(
      "Funding amount must be a safe integer; pass larger amounts as bigint or decimal string",
    );
  const value = BigInt(amount);
  const s = job.source,
    gasService = s.gasService,
    id = job.message.cc_id.message_id;
  if (value <= 0n || !gasService)
    throw new Error("Positive amount and configured gas service required");
  if (s.platform === "solana")
    return axelarFundInstruction({
      payer,
      gasService,
      messageId: id,
      amount: value,
    });
  if (s.platform === "evm") {
    const match = /^(0x[0-9a-f]{64})-(\d+)$/.exec(id);
    if (!match) throw new Error("Invalid EVM message ID");
    return {
      to: gasService,
      value,
      data: new Interface([
        "function addNativeGas(bytes32,uint256,address) payable",
      ]).encodeFunctionData("addNativeGas", [
        match[1],
        BigInt(match[2]!),
        payer,
      ]),
    };
  }
  if (value >= 1n << 127n) throw new Error("Stellar amount exceeds i128");
  const token = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal("address", { type: "symbol" }),
      val: new Address(
        Asset.native().contractId(s.networkPassphrase!),
      ).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal("amount", { type: "symbol" }),
      val: nativeToScVal(value, { type: "i128" }),
    }),
  ]);
  return new Contract(gasService).call(
    "add_gas",
    new Address(job.message.source_address).toScVal(),
    nativeToScVal(id, { type: "string" }),
    new Address(payer).toScVal(),
    token,
  );
}
