import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

/** Signed bytes persisted before broadcast, plus chain-specific replay metadata. */
export type StoredTransaction = { id: string; raw: string };

export type JournalState = {
  jobHash: string;
  transactions: Record<string, StoredTransaction>;
  pendingVerification?: string;
  proofRequest?: string;
  sessionId?: string;
  sessionExpiresAt?: number;
  sessionVerifierSet?: string;
  executeData?: string;
};

export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Endpoint and fee settings may change between runs without changing which message is relayed.
const OPERATIONAL_KEYS: Record<string, true> = {
  rpcUrl: true,
  gasPrice: true,
  computeUnitPrice: true,
};
const identity = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(identity)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !Object.hasOwn(OPERATIONAL_KEYS, key))
            .map(([key, item]) => [key, identity(item)]),
        )
      : value;

/** Hash of the message, route, and contract identities; excludes RPC endpoints and fee settings. */
export const jobHash = (job: unknown): string => digest(identity(job));

export class Journal {
  state: JournalState;

  constructor(
    readonly path: string,
    readonly job: unknown,
  ) {
    this.state = { jobHash: jobHash(job), transactions: {} };
  }

  async load(): Promise<this> {
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (this.state.jobHash !== jobHash(this.job))
      throw new Error(
        "Journal belongs to a different message or configuration",
      );
    return this;
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2) + "\n", {
      mode: 0o600,
    });
    const file = await open(temp, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, this.path);
    // Persist the rename itself; without a directory fsync a crash can revert to the old journal.
    const dir = await open(dirname(this.path), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }

  // Persist the exact signed bytes before broadcast. A lost response cannot trigger a new payment.
  async transaction<T extends StoredTransaction, R>(
    name: string,
    prepare: () => Promise<T>,
    lookup: (tx: T) => Promise<R | null | undefined>,
    broadcast: (tx: T) => Promise<R>,
  ): Promise<R> {
    let tx = this.state.transactions[name] as T | undefined;
    if (!tx) {
      tx = await prepare();
      this.state.transactions[name] = tx;
      await this.save();
    }
    const found = await lookup(tx);
    if (found) return found;
    return broadcast(tx);
  }
}

export async function exclusive<T>(
  path: string,
  run: () => Promise<T>,
): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const fd = await open(lock, "wx", 0o600).catch((e: unknown) => {
    throw new Error(
      `Relay lock exists: ${lock}. Check the other process before removing it.`,
      { cause: e },
    );
  });
  try {
    await fd.writeFile(String(process.pid));
    return await run();
  } finally {
    await fd.close();
    await unlink(lock);
  }
}
