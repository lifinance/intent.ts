import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  anchorDiscriminator,
  AXELAR_ORACLE_PROGRAM,
  axelarConfigAddress,
  axelarReceiveSteps,
  axelarRouteAddress,
  checkSolanaAxelarAdmission,
  decodeAxelarConfig,
  decodeAxelarRoute,
  type AxelarInstruction,
  type AxelarReceivePlan,
  type AxelarStep,
} from "../../../src/axelar/index";
import { Rejected } from "./hub";
import type { Job } from "./source";
import type { Journal, StoredTransaction } from "./state";

const MAX_TRANSACTION_BYTES = 1232;
// Size checks only; never signed or sent.
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

/** Receive plan from `axelarReceiveSteps` bound to the configured destination gateway. */
export type ReceiveContext = AxelarReceivePlan & { gateway: string };
type StepContext = Pick<
  ReceiveContext,
  "gateway" | "protocol" | "messageHash" | "payloadHash"
>;
/** The subset of `Connection` that state recovery reads. */
export type AccountReader = {
  getAccountInfo(
    key: PublicKey,
    commitment: "finalized",
  ): Promise<{ owner: PublicKey; data: Buffer } | null>;
};

export function instruction(ix: AxelarInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })),
    data: Buffer.from(ix.data.slice(2), "hex"),
  });
}

export function transaction(
  ix: AxelarInstruction,
  payer: PublicKey | string,
  blockhash: string,
): Transaction {
  const tx = new Transaction({
    feePayer: new PublicKey(payer),
    recentBlockhash: blockhash,
  });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    instruction(ix),
  );
  const raw = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (raw.length > MAX_TRANSACTION_BYTES)
    throw new Error(
      `Solana transaction exceeds ${MAX_TRANSACTION_BYTES} bytes (${raw.length})`,
    );
  return tx;
}

/**
 * Pre-funding check: proof-size and chain-ID limits from the library, plus the
 * transaction-size limit for every supplied source/execute/register instruction.
 */
export function admission({
  callbackBytes = 0,
  contextBytes = 0,
  sourceChainId,
  destinationChainId,
  instructions = [],
  payer = AXELAR_ORACLE_PROGRAM,
}: {
  callbackBytes?: number;
  contextBytes?: number;
  sourceChainId?: bigint | string | number;
  destinationChainId?: bigint | string | number;
  instructions?: AxelarInstruction[];
  payer?: string;
}): { fillBytes: number; notFilledBytes: number } {
  const limits = checkSolanaAxelarAdmission({
    callbackBytes,
    contextBytes,
    sourceChainId:
      sourceChainId === undefined ? undefined : BigInt(sourceChainId),
    destinationChainId:
      destinationChainId === undefined ? undefined : BigInt(destinationChainId),
  });
  for (const ix of instructions) transaction(ix, payer, PLACEHOLDER_BLOCKHASH);
  return limits;
}

function providerAccount(
  account: { owner: PublicKey; data: Buffer } | null,
  owner: string,
  name: string,
  size: number,
): asserts account is { owner: PublicKey; data: Buffer } {
  if (
    !account?.owner.equals(new PublicKey(owner)) ||
    account.data.length !== size ||
    !account.data
      .subarray(0, 8)
      .equals(Buffer.from(anchorDiscriminator("account", name)))
  )
    throw new Error(`Invalid ${name} account`);
}

export async function completed(
  connection: AccountReader,
  step: Pick<AxelarStep, "kind" | "account" | "position">,
  context: StepContext,
): Promise<boolean> {
  const a = await connection.getAccountInfo(
    new PublicKey(step.account),
    "finalized",
  );
  if (!a) return false;
  if (step.kind === "proof") {
    providerAccount(a, context.protocol, "Attestation", 9);
    return true;
  }
  if (step.kind === "session" || step.kind === "signature") {
    providerAccount(
      a,
      context.gateway,
      "SignatureVerificationSessionData",
      104,
    );
    if (step.kind === "session") return true;
    if (step.position === undefined)
      throw new Error("Signature step requires a signer position");
    const bits = a.data[24 + Math.floor(step.position / 8)] ?? 0;
    return Boolean(bits & (1 << step.position % 8));
  }
  providerAccount(a, context.gateway, "IncomingMessage", 78);
  if (
    a.data.subarray(14, 46).toString("hex") !== context.messageHash.slice(2) ||
    a.data.subarray(46, 78).toString("hex") !== context.payloadHash.slice(2)
  )
    throw new Error("Gateway message commitment mismatch");
  if (a.data[13] !== 0 && a.data[13] !== 1)
    throw new Error("Unknown gateway message state");
  return step.kind === "approved" || a.data[13] === 1;
}

type SolanaStoredTransaction = StoredTransaction & {
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function sendStep({
  connection,
  signer,
  journal,
  step,
  context,
}: {
  connection: Connection;
  signer: Keypair;
  journal: Journal;
  step: AxelarStep;
  context: StepContext;
}): Promise<void> {
  if (await completed(connection, step, context)) return;
  const name = `solana:${step.name}`;
  const lookup = async (tx: StoredTransaction) => {
    const result = (
      await connection.getSignatureStatuses([tx.id], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (result?.err)
      throw new Rejected(
        `Solana transaction ${tx.id} failed: ${JSON.stringify(result.err)}`,
      );
    return result?.confirmationStatus === "finalized" ? result : null;
  };
  try {
    await journal.transaction<SolanaStoredTransaction, unknown>(
      name,
      async () => {
        const latest = await connection.getLatestBlockhash("finalized");
        const tx = transaction(
          step.instruction,
          signer.publicKey,
          latest.blockhash,
        );
        tx.sign(signer);
        return {
          id: bs58.encode(tx.signature!),
          raw: tx.serialize().toString("base64"),
          ...latest,
        };
      },
      lookup,
      async (tx) => {
        const signature = await connection.sendRawTransaction(
          Buffer.from(tx.raw, "base64"),
        );
        const result = await connection.confirmTransaction(
          {
            signature,
            blockhash: tx.blockhash,
            lastValidBlockHeight: tx.lastValidBlockHeight,
          },
          "finalized",
        );
        if (result.value.err)
          throw new Rejected(
            `Solana execution failed: ${JSON.stringify(result.value.err)}`,
          );
        return result;
      },
    );
  } catch (error) {
    // A standard relayer may have won the race. Only exact authenticated account state establishes success.
    if (await completed(connection, step, context)) return;
    const previous = journal.state.transactions[name] as
      | SolanaStoredTransaction
      | undefined;
    if (
      previous &&
      (await connection.getBlockHeight("finalized")) >
        previous.lastValidBlockHeight &&
      !(await lookup(previous))
    ) {
      delete journal.state.transactions[name];
      await journal.save();
    }
    throw error;
  }
  if (!(await completed(connection, step, context)))
    throw new Error(`Expected Solana state missing after ${step.name}`);
}

export async function receiveContext(
  connection: AccountReader,
  job: Pick<Job, "message" | "payload" | "source" | "destination">,
  payer: string,
): Promise<ReceiveContext> {
  const program = new PublicKey(AXELAR_ORACLE_PROGRAM);
  const account = await connection.getAccountInfo(
    new PublicKey(axelarConfigAddress()),
    "finalized",
  );
  if (!account?.owner.equals(program))
    throw new Error("Missing Solana oracle configuration");
  const config = decodeAxelarConfig(account.data);
  if (
    config.gateway !== job.destination.gateway ||
    config.chainName !== job.message.destination_chain ||
    config.chainId !== BigInt(job.destination.chainId)
  )
    throw new Error("Immutable destination configuration mismatch");
  const routeAccount = await connection.getAccountInfo(
    new PublicKey(axelarRouteAddress(job.message.cc_id.source_chain)),
    "finalized",
  );
  if (!routeAccount?.owner.equals(program))
    throw new Error("Source chain has no Solana Axelar mapping");
  const route = decodeAxelarRoute(routeAccount.data);
  if (
    route.name !== job.message.cc_id.source_chain.toLowerCase() ||
    route.chainId !== BigInt(job.source.chainId) ||
    route.kind !== job.source.platform ||
    route.kind === "solana"
  )
    throw new Error("Source chain mapping mismatch");
  return {
    ...axelarReceiveSteps({
      gateway: config.gateway,
      payer,
      message: job.message,
      payload: `0x${job.payload}`,
      sourceChainId: route.chainId,
      sourceKind: route.kind,
    }),
    gateway: config.gateway,
  };
}
