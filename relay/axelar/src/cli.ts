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
  finishDestination,
  type DestinationDeps,
} from "./destination";
import { discardRotatedProof, Pending, relayHub } from "./hub";
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
      signer: Keypair.fromSecretKey(
        Uint8Array.from(await json(secret("OIF_SOLANA_KEYPAIR_FILE"))),
      ),
    };
  } else if (d.platform === "evm")
    deps.evm = {
      signer: new Wallet(
        secret("OIF_EVM_PRIVATE_KEY"),
        new JsonRpcProvider(d.rpcUrl),
      ),
    };
  else
    deps.stellar = {
      server: new rpc.Server(d.rpcUrl, {
        allowHttp: d.rpcUrl.startsWith("http:"),
      }),
      signer: StellarKeypair.fromSecret(secret("OIF_STELLAR_SECRET")),
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
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        secret("OIF_AXELAR_MNEMONIC"),
        { prefix: "axelar" },
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
    try {
      await finishDestination({ job, journal, executeData, ...deps });
    } catch (error) {
      if (
        error instanceof Pending ||
        !executeData ||
        (await destinationStatus({ job, ...deps })).approved
      )
        throw error;
      const hub = await CosmWasmClient.connect(job.hub.rpcUrl);
      let discarded;
      try {
        discarded = await discardRotatedProof({ client: hub, job, journal });
      } finally {
        hub.disconnect();
      }
      if (!discarded) throw error;
      throw new Pending(
        `Destination rejected a proof signed by a rotated-out Axelar verifier set (${(error as Error).message}); run relay to sign a replacement`,
      );
    }
    console.log(
      "Destination proof registered. The order claimant can now submit finalisation, or anyone can submit an eligible refund.",
    );
  });
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = error instanceof Pending ? 2 : 1;
});
