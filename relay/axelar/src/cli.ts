#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import {
  CosmWasmClient,
  SigningCosmWasmClient,
} from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Connection, Keypair } from "@solana/web3.js";
import { Keypair as StellarKeypair, rpc } from "@stellar/stellar-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import {
  destinationStatus,
  finishOrRenewProof,
  type DestinationDeps,
} from "./destination";
import { Pending, relayHub } from "./hub";
import { admission } from "./solana";
import { extract, validateJob } from "./source";
import { exclusive, Journal } from "./state";

// Secrets are read from explicit environment variables; never included in a job or journal.
function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
// Parser errors can echo the secret (JSON, ethers, cosmjs do); replace them with a fixed message.
async function redacted<T>(
  message: string,
  parse: () => T | Promise<T>,
): Promise<T> {
  try {
    return await parse();
  } catch {
    throw new Error(message);
  }
}
async function solanaKeypair(): Promise<Keypair> {
  const message =
    "OIF_SOLANA_KEYPAIR_FILE must contain a JSON array of 64 bytes";
  const bytes: unknown = await redacted(message, async () =>
    JSON.parse(await readFile(secret("OIF_SOLANA_KEYPAIR_FILE"), "utf8")),
  );
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  )
    throw new Error(message);
  return redacted(message, () => Keypair.fromSecretKey(Uint8Array.from(bytes)));
}

async function main() {
  const [command, file, ...args] = process.argv.slice(2);
  if (!file)
    throw new Error(
      "Commands: extract, admit, status, relay, finish. See README.md.",
    );
  if (command === "extract") {
    const [txHash, output, eventId] = args;
    if (!txHash || !output)
      throw new Error("extract CONFIG.json SOURCE_TX JOB.json [MESSAGE_ID]");
    const job = await extract(await json(file), txHash, eventId);
    await writeFile(output, JSON.stringify(job, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Saved verified source event to ${output}`);
    return;
  }
  if (command === "admit") {
    console.log(JSON.stringify(admission(await json(file)), null, 2));
    return;
  }
  if (command !== "relay" && command !== "status" && command !== "finish")
    throw new Error(
      "Commands: extract, admit, status, relay, finish. See README.md.",
    );
  const job = validateJob(await json(file)),
    d = job.destination;
  const deps: DestinationDeps = {};
  if (d.platform === "solana") {
    const connection = new Connection(d.rpcUrl, "finalized");
    if (!d.genesisHash || (await connection.getGenesisHash()) !== d.genesisHash)
      throw new Error("Solana genesis hash mismatch");
    deps.solana = {
      connection,
      signer: await solanaKeypair(),
      computeUnitPrice: d.computeUnitPrice,
    };
  } else if (d.platform === "evm")
    deps.evm = {
      signer: await redacted(
        "OIF_EVM_PRIVATE_KEY must be a 32-byte hex private key",
        () =>
          new Wallet(
            secret("OIF_EVM_PRIVATE_KEY"),
            new JsonRpcProvider(d.rpcUrl),
          ),
      ),
    };
  else
    deps.stellar = {
      server: new rpc.Server(d.rpcUrl, {
        allowHttp: d.rpcUrl.startsWith("http:"),
      }),
      signer: await redacted(
        "OIF_STELLAR_SECRET must be a Stellar secret seed",
        () => StellarKeypair.fromSecret(secret("OIF_STELLAR_SECRET")),
      ),
    };
  const journalPath = `${file}.journal.json`;
  await exclusive(journalPath, async () => {
    const journal = await new Journal(journalPath, job).load();
    const status = await destinationStatus({ job, ...deps });
    if (command === "status" || status.complete) {
      console.log(
        JSON.stringify({
          executed: status.executed,
          complete: status.complete,
        }),
      );
      return;
    }
    if (!args.includes("--broadcast"))
      throw new Error(
        "Use --broadcast to pay your own hub and destination transaction fees",
      );
    let executeData = journal.state.executeData;
    if (!status.approved && !executeData) {
      if (command === "finish")
        throw new Pending(
          "Destination approval is not available; use relay for the full path",
        );
      const wallet = await redacted(
        "OIF_AXELAR_MNEMONIC must be a valid BIP-39 mnemonic",
        () =>
          DirectSecp256k1HdWallet.fromMnemonic(secret("OIF_AXELAR_MNEMONIC"), {
            prefix: "axelar",
          }),
      );
      const client = await SigningCosmWasmClient.connectWithSigner(
        job.hub.rpcUrl,
        wallet,
      );
      try {
        const [account] = await wallet.getAccounts();
        executeData = await relayHub({
          client,
          sender: account!.address,
          job,
          journal,
        });
      } finally {
        client.disconnect();
      }
    }
    await finishOrRenewProof({
      job,
      journal,
      executeData,
      connectHub: () => CosmWasmClient.connect(job.hub.rpcUrl),
      ...deps,
    });
    console.log(
      "Destination proof registered. The order claimant can now submit finalisation, or anyone can submit an eligible refund.",
    );
  });
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = error instanceof Pending ? 2 : 1;
});
