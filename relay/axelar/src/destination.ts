import type { Connection, Keypair } from "@solana/web3.js";
import {
  Address,
  Contract,
  Keypair as StellarKeypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  Contract as EvmContract,
  Interface,
  keccak256,
  toUtf8Bytes,
  type TransactionRequest,
  type Wallet,
} from "ethers";
import {
  axelarApprovalSteps,
  type AxelarMessage,
} from "../../../src/axelar/index";
import { Pending } from "./hub";
import {
  completed,
  receiveContext,
  sendStep,
  type ReceiveContext,
} from "./solana";
import type { Job } from "./source";
import type { Journal, StoredTransaction } from "./state";

export type SolanaDestination = { connection: Connection; signer: Keypair };
export type EvmDestination = { signer: Wallet };
export type StellarDestination = { server: rpc.Server; signer: StellarKeypair };
export type DestinationDeps = {
  solana?: SolanaDestination;
  evm?: EvmDestination;
  stellar?: StellarDestination;
};
export type DestinationStatus = {
  approved: boolean;
  executed: boolean;
  complete: boolean;
  context?: ReceiveContext;
};

const evmAbi = [
  "function isMessageApproved(string,string,string,address,bytes32) view returns(bool)",
  "function isMessageExecuted(string,string) view returns(bool)",
  "function execute(bytes32,string,string,bytes)",
];
const approvalAbi = new Interface([
  "function approveMessages((string sourceChain,string messageId,string sourceAddress,address contractAddress,bytes32 payloadHash)[] messages,(((address signer,uint128 weight)[] signers,uint128 threshold,bytes32 nonce) signers,bytes[] signatures) proof)",
]);

export function validateEvmApproval(
  data: string,
  message: AxelarMessage,
  oracle: string,
): void {
  const call = approvalAbi.parseTransaction({ data: `0x${data}` });
  const messages = call?.args.messages;
  if (call?.name !== "approveMessages" || messages.length !== 1)
    throw new Error("Expected one EVM message approval");
  const m = messages[0];
  if (
    m.sourceChain !== message.cc_id.source_chain ||
    m.messageId !== message.cc_id.message_id ||
    m.sourceAddress !== message.source_address ||
    m.contractAddress.toLowerCase() !== oracle.toLowerCase() ||
    m.payloadHash.slice(2) !== message.payload_hash
  )
    throw new Error("EVM signed approval message mismatch");
}

export async function evmSend(
  signer: Wallet,
  journal: Journal,
  name: string,
  request: TransactionRequest,
) {
  const provider = signer.provider!;
  return journal.transaction(
    `evm:${name}`,
    async () => {
      const tx = await signer.populateTransaction(request);
      const raw = await signer.signTransaction(tx);
      return { id: keccak256(raw), raw };
    },
    async (tx: StoredTransaction) => {
      const receipt = await provider.getTransactionReceipt(tx.id);
      if (receipt && receipt.status !== 1)
        throw new Error(`EVM transaction ${tx.id} reverted`);
      return receipt;
    },
    async (tx) => {
      const result = await provider.broadcastTransaction(tx.raw);
      const receipt = await result.wait();
      if (receipt?.status !== 1) throw new Error("EVM transaction reverted");
      return receipt;
    },
  );
}

export async function stellarCall(
  server: rpc.Server,
  signer: StellarKeypair,
  passphrase: string,
  journal: Journal,
  name: string,
  contract: string,
  method: string,
  args: xdr.ScVal[],
) {
  const lookup = async (tx: StoredTransaction) => {
    const result = await server.getTransaction(tx.id);
    if (result.status === rpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Stellar transaction ${tx.id} failed`);
    return result.status === rpc.Api.GetTransactionStatus.SUCCESS
      ? result
      : null;
  };
  return journal.transaction(
    `stellar:${name}`,
    async () => {
      const raw = new TransactionBuilder(
        await server.getAccount(signer.publicKey()),
        { fee: "100", networkPassphrase: passphrase },
      )
        .addOperation(new Contract(contract).call(method, ...args))
        .setTimeout(300)
        .build();
      const simulation = await server.simulateTransaction(raw);
      if (rpc.Api.isSimulationRestore(simulation))
        throw new Error(
          "Restore archived Stellar state, then resume this journal",
        );
      if (!rpc.Api.isSimulationSuccess(simulation))
        throw new Error(
          `Stellar simulation failed: ${"error" in simulation ? simulation.error : "unexpected response"}`,
        );
      // Proof approval/execution is permissionless. Refuse unexpected spending authorizations.
      if (simulation.result?.auth?.length)
        throw new Error("Unexpected destination authorization request");
      const tx = rpc.assembleTransaction(raw, simulation).build();
      tx.sign(signer);
      return { id: tx.hash().toString("hex"), raw: tx.toXDR() };
    },
    lookup,
    async (tx) => {
      const result = await server.sendTransaction(
        TransactionBuilder.fromXDR(tx.raw, passphrase),
      );
      if (result.status !== "PENDING" && result.status !== "DUPLICATE")
        throw new Error(
          `Stellar submission ${result.status}; signed transaction retained`,
        );
      throw new Pending(`Waiting for Stellar transaction ${tx.id}`);
    },
  );
}

async function stellarView(
  server: rpc.Server,
  source: string,
  passphrase: string,
  contract: string,
  method: string,
  args: xdr.ScVal[],
): Promise<boolean> {
  const tx = new TransactionBuilder(await server.getAccount(source), {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(60)
    .build();
  const s = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(s) || !s.result)
    throw new Error(
      `Stellar status query failed: ${"error" in s ? s.error : "archived state"}`,
    );
  return scValToNative(s.result.retval);
}

export async function destinationStatus({
  job,
  solana,
  evm,
  stellar,
}: DestinationDeps & { job: Job }): Promise<DestinationStatus> {
  const m = job.message,
    d = job.destination;
  if (d.platform === "solana") {
    const { connection, signer } = solana!;
    const ctx = await receiveContext(
      connection,
      job,
      signer.publicKey.toString(),
    );
    const [execute, register] = ctx.steps;
    if (!execute || !register)
      throw new Error("Expected execute and register receive steps");
    return {
      context: ctx,
      approved: await completed(
        connection,
        { ...execute, kind: "approved" },
        ctx,
      ),
      executed: await completed(connection, execute, ctx),
      complete: await completed(connection, register, ctx),
    };
  }
  if (d.platform === "evm") {
    const signer = evm!.signer;
    if ((await signer.provider!.getNetwork()).chainId !== BigInt(d.chainId))
      throw new Error("EVM RPC chain mismatch");
    const gateway = new EvmContract(d.gateway, evmAbi, signer);
    const executed: boolean = await gateway.getFunction("isMessageExecuted")(
      m.cc_id.source_chain,
      m.cc_id.message_id,
    );
    return {
      executed,
      complete: executed,
      approved:
        executed ||
        (await gateway.getFunction("isMessageApproved")(
          m.cc_id.source_chain,
          m.cc_id.message_id,
          m.source_address,
          d.oracle,
          `0x${m.payload_hash}`,
        )),
    };
  }
  if (d.platform !== "stellar")
    throw new Error("Unsupported destination platform");
  const { server, signer } = stellar!;
  const passphrase = d.networkPassphrase!;
  if ((await server.getNetwork()).passphrase !== passphrase)
    throw new Error("Stellar RPC network mismatch");
  const args = [
    nativeToScVal(m.cc_id.source_chain, { type: "string" }),
    nativeToScVal(m.cc_id.message_id, { type: "string" }),
  ];
  const executed = await stellarView(
    server,
    signer.publicKey(),
    passphrase,
    d.gateway,
    "is_message_executed",
    args,
  );
  const approved =
    executed ||
    (await stellarView(
      server,
      signer.publicKey(),
      passphrase,
      d.gateway,
      "is_message_approved",
      [
        ...args,
        nativeToScVal(m.source_address, { type: "string" }),
        new Address(d.oracle).toScVal(),
        nativeToScVal(Buffer.from(m.payload_hash, "hex"), { type: "bytes" }),
      ],
    ));
  return { executed, complete: executed, approved };
}

export async function finishDestination({
  job,
  journal,
  executeData,
  solana,
  evm,
  stellar,
}: DestinationDeps & {
  job: Job;
  journal: Journal;
  executeData?: string;
}): Promise<void> {
  const d = job.destination,
    m = job.message,
    // Approvals are journaled per signing session: a replacement proof after a
    // verifier-set rotation must not replay the rejected session's signed approval.
    approval = `approve:${journal.state.sessionId}`;
  const status = await destinationStatus({ job, solana, evm, stellar });
  if (status.complete) return;
  if (d.platform === "solana") {
    const deps = solana!,
      context = status.context!;
    if (!status.approved) {
      const { steps } = axelarApprovalSteps({
        gateway: d.gateway,
        payer: deps.signer.publicKey.toString(),
        message: m,
        executeData: `0x${executeData}`,
      });
      for (const step of steps)
        await sendStep({
          ...deps,
          journal,
          step: { ...step, name: `${approval}:${step.name}` },
          context,
        });
    }
    for (const step of context.steps)
      await sendStep({ ...deps, journal, step, context });
  } else if (d.platform === "evm") {
    const signer = evm!.signer;
    if (!status.approved) {
      validateEvmApproval(executeData!, m, d.oracle);
      await evmSend(signer, journal, approval, {
        to: d.gateway,
        data: `0x${executeData}`,
      });
    }
    const data = new Interface(evmAbi).encodeFunctionData("execute", [
      // EVM Amplifier gateways derive command IDs with "_"; Solana's gateway uses "-".
      keccak256(toUtf8Bytes(`${m.cc_id.source_chain}_${m.cc_id.message_id}`)),
      m.cc_id.source_chain,
      m.source_address,
      `0x${job.payload}`,
    ]);
    try {
      await evmSend(signer, journal, "execute", { to: d.oracle, data });
    } catch (e) {
      if (!(await destinationStatus({ job, evm })).complete) throw e;
    }
  } else {
    const { server, signer } = stellar!;
    const passphrase = d.networkPassphrase!;
    if (!status.approved) {
      const args = xdr.ScVal.fromXDR(Buffer.from(executeData!, "hex")).vec();
      if (!args || args.length !== 2 || args[0]!.switch().name !== "scvVec")
        throw new Error("Expected Stellar message approval arguments");
      const messages = scValToNative(args[0]!);
      if (
        messages.length !== 1 ||
        messages[0].contract_address !== d.oracle ||
        messages[0].source_chain !== m.cc_id.source_chain ||
        messages[0].message_id !== m.cc_id.message_id ||
        messages[0].source_address !== m.source_address ||
        Buffer.from(messages[0].payload_hash).toString("hex") !== m.payload_hash
      )
        throw new Error("Stellar signed approval message mismatch");
      await stellarCall(
        server,
        signer,
        passphrase,
        journal,
        approval,
        d.gateway,
        "approve_messages",
        args,
      );
    }
    const values = [
      m.cc_id.source_chain,
      m.cc_id.message_id,
      m.source_address,
    ].map((s) => nativeToScVal(s, { type: "string" }));
    values.push(
      nativeToScVal(Buffer.from(job.payload, "hex"), { type: "bytes" }),
    );
    try {
      await stellarCall(
        server,
        signer,
        passphrase,
        journal,
        "execute",
        d.oracle,
        "execute",
        values,
      );
    } catch (e) {
      if (!(await destinationStatus({ job, stellar })).complete) throw e;
    }
  }
}
