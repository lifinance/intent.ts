import { Connection, PublicKey, type LoadedAddresses } from "@solana/web3.js";
import { rpc, scValToNative, StrKey } from "@stellar/stellar-sdk";
import bs58 from "bs58";
import { Interface, JsonRpcProvider, keccak256 } from "ethers";
import {
  anchorDiscriminator,
  type AxelarMessage,
} from "../../../src/axelar/index";

export type Platform = "solana" | "evm" | "stellar";
export type ChainConfig = {
  platform: Platform;
  chainName: string;
  /** Decimal string; JSON numbers above 2^53 are already rounded. */
  chainId: string | number;
  rpcUrl: string;
  oracle: string;
  gateway: string;
  gasService?: string;
  networkPassphrase?: string;
  genesisHash?: string;
};
export type HubConfig = {
  rpcUrl: string;
  chainId: string;
  gasPrice: string;
  sourceGateway: string;
  votingVerifier: string;
  destinationGateway: string;
  destinationProver: string;
  fullMessagePayloads?: boolean;
};
export type RelayConfig = {
  source: ChainConfig;
  destination: ChainConfig;
  hub: HubConfig;
};
/** A verified source export. `payload` and `message.payload_hash` are unprefixed hex. */
export type Job = RelayConfig & { message: AxelarMessage; payload: string };

const sameAddress = (a: string, b: string, platform: Platform) =>
  platform === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;

export function validateJob(job: Job): Job {
  const { message: m, source: s, destination: d, payload } = job;
  if (
    !m ||
    !/^(?:[a-fA-F0-9]{2})+$/.test(payload) ||
    keccak256(`0x${payload}`).slice(2) !== m.payload_hash
  )
    throw new Error("Payload hash mismatch");
  if (
    m.cc_id.source_chain !== s.chainName ||
    m.destination_chain !== d.chainName ||
    !sameAddress(m.source_address, s.oracle, s.platform) ||
    !sameAddress(m.destination_address, d.oracle, d.platform)
  )
    throw new Error(
      "Message route does not match the selected source and destination",
    );
  for (const c of [s, d]) {
    if (!["solana", "evm", "stellar"].includes(c.platform))
      throw new Error("Unknown platform");
    const url = new URL(c.rpcUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid RPC URL");
    if (
      BigInt(c.chainId) <= 0n ||
      BigInt(c.chainId) >=
        1n << (s.platform === "solana" || d.platform === "solana" ? 128n : 256n)
    )
      throw new Error("Chain ID outside route limits");
    if (c.platform === "solana") {
      new PublicKey(c.oracle);
      new PublicKey(c.gateway);
    }
    if (c.platform === "stellar") {
      StrKey.decodeContract(c.oracle);
      StrKey.decodeContract(c.gateway);
      if (!c.networkPassphrase) throw new Error("Stellar passphrase required");
    }
  }
  return job;
}

class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  take(n: number): Buffer {
    if (n < 0 || this.offset + n > this.data.length)
      throw new Error("Truncated gateway event");
    const b = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return b;
  }
  bytes(): Buffer {
    return this.take(this.take(4).readUInt32LE());
  }
}

type SourceEvent = Omit<AxelarMessage, "cc_id"> & {
  id: string;
  payload: string;
};
/** The fields of a `getTransaction` response that gateway extraction reads. */
export type GatewayTransaction = {
  meta: {
    err?: unknown;
    loadedAddresses?: LoadedAddresses;
    innerInstructions?:
      | {
          index: number;
          instructions: { programIdIndex: number; data: string }[];
        }[]
      | null;
  } | null;
  transaction: {
    message: {
      getAccountKeys(args: {
        accountKeysFromLookups?: LoadedAddresses | null;
      }): { get(index: number): PublicKey | undefined };
    };
  };
};

const EVENT_IX_TAG = "e445a52e51cb9a1d";
export function solanaEvents(
  tx: GatewayTransaction | null,
  signature: string,
  gateway: string,
): SourceEvent[] {
  if (!tx?.meta || tx.meta.err)
    throw new Error("Missing or failed Solana transaction");
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  const callContract = Buffer.from(
    anchorDiscriminator("event", "CallContractEvent"),
  );
  const found: SourceEvent[] = [];
  for (const group of tx.meta.innerInstructions ?? [])
    for (const [index, ix] of group.instructions.entries()) {
      if (keys.get(ix.programIdIndex)?.toString() !== gateway) continue;
      const b = Buffer.from(bs58.decode(ix.data));
      if (
        b.length < 16 ||
        b.subarray(0, 8).toString("hex") !== EVENT_IX_TAG ||
        !b.subarray(8, 16).equals(callContract)
      )
        continue;
      const r = new Reader(b.subarray(16)),
        source_address = new PublicKey(r.take(32)).toString(),
        payload_hash = r.take(32).toString("hex");
      const destination_chain = r.bytes().toString("utf8"),
        destination_address = r.bytes().toString("utf8"),
        payload = r.bytes().toString("hex");
      if (r.offset !== r.data.length)
        throw new Error("Trailing gateway event bytes");
      found.push({
        id: `${signature}-${group.index + 1}.${index + 1}`,
        source_address,
        destination_chain,
        destination_address,
        payload_hash,
        payload,
      });
    }
  return found;
}

export async function extract(
  config: RelayConfig,
  txHash: string,
  eventId?: string,
): Promise<Job> {
  const source = config.source;
  let events: SourceEvent[];
  if (source.platform === "solana") {
    const connection = new Connection(source.rpcUrl, "finalized");
    if (
      !source.genesisHash ||
      (await connection.getGenesisHash()) !== source.genesisHash
    )
      throw new Error("Solana genesis hash mismatch");
    events = solanaEvents(
      await connection.getTransaction(txHash, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      }),
      txHash,
      source.gateway,
    );
  } else if (source.platform === "evm") {
    const provider = new JsonRpcProvider(source.rpcUrl);
    if ((await provider.getNetwork()).chainId !== BigInt(source.chainId))
      throw new Error("EVM source network mismatch");
    const tx = await provider.getTransactionReceipt(txHash);
    if (!tx || tx.status !== 1)
      throw new Error("Missing or failed source transaction");
    const finalized = await provider.getBlock("finalized");
    if (!finalized || tx.blockNumber > finalized.number)
      throw new Error("Source transaction is not finalized");
    const abi = new Interface([
      "event ContractCall(address indexed sender,string destinationChain,string destinationContractAddress,bytes32 indexed payloadHash,bytes payload)",
    ]);
    events = tx.logs
      .filter((l) => l.address.toLowerCase() === source.gateway.toLowerCase())
      .flatMap((l) => {
        const event = abi.parseLog(l);
        if (!event) return [];
        return [
          {
            id: `${txHash.toLowerCase()}-${l.index}`,
            source_address: event.args.sender,
            destination_chain: event.args.destinationChain,
            destination_address: event.args.destinationContractAddress,
            payload_hash: event.args.payloadHash.slice(2),
            payload: event.args.payload.slice(2),
          },
        ];
      });
  } else if (source.platform === "stellar") {
    const server = new rpc.Server(source.rpcUrl, {
      allowHttp: source.rpcUrl.startsWith("http:"),
    });
    if ((await server.getNetwork()).passphrase !== source.networkPassphrase)
      throw new Error("Stellar source network mismatch");
    const hash = txHash.replace(/^0x/, "");
    const tx = await server.getTransaction(hash);
    if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS)
      throw new Error("Missing or failed Stellar source transaction");
    const result = tx.resultXdr.result();
    if (
      result.switch().name === "txFeeBumpInnerSuccess" &&
      result.innerResultPair().transactionHash().toString("hex") !==
        hash.toLowerCase()
    )
      throw new Error("Use the inner Stellar transaction hash");
    const meta = tx.resultMetaXdr;
    let list;
    if (meta.switch() === 3) list = meta.v3().sorobanMeta()?.events() ?? [];
    else if (meta.switch() === 4) {
      const ops = tx.events?.contractEventsXdr;
      if (!ops || ops.length !== 1 || !ops[0])
        throw new Error(
          "Expected RPC contract events for one Stellar operation",
        );
      list = ops[0];
    } else throw new Error("Unsupported Stellar transaction metadata");
    events = list.flatMap((event, i) => {
      const contractId = event.contractId();
      // XDR `Hash` is typed as opaque bytes but decodes as a Buffer.
      if (
        !contractId ||
        StrKey.encodeContract(contractId as unknown as Buffer) !==
          source.gateway
      )
        return [];
      const b = event.body().v0(),
        topics = b.topics().map((t) => scValToNative(t));
      if (topics.length !== 5 || topics[0] !== "contract_called") return [];
      const payload = scValToNative(b.data());
      if (!(payload instanceof Uint8Array))
        throw new Error("Invalid Stellar gateway payload");
      return [
        {
          id: `0x${hash.toLowerCase()}-${i}`,
          source_address: topics[1],
          destination_chain: topics[2],
          destination_address: topics[3],
          payload_hash: Buffer.from(topics[4]).toString("hex"),
          payload: Buffer.from(payload).toString("hex"),
        },
      ];
    });
  } else throw new Error("Unknown source platform");
  events = events.filter(
    (e) =>
      (eventId === undefined || e.id === eventId) &&
      sameAddress(e.source_address, source.oracle, source.platform),
  );
  if (events.length !== 1 || !events[0])
    throw new Error(
      `Expected one gateway event, found ${events.length}; specify its complete message ID`,
    );
  const { id, payload, ...m } = events[0];
  // Preserve the exact provider sender string for signature verification, including EVM case.
  return validateJob({
    ...config,
    source: { ...source, oracle: m.source_address },
    payload,
    message: {
      cc_id: { source_chain: source.chainName, message_id: id },
      ...m,
    },
  });
}
