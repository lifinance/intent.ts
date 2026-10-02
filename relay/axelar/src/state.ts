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

export class Journal {
  state: JournalState;

  constructor(
    readonly path: string,
    readonly job: unknown,
  ) {
    this.state = { jobHash: digest(job), transactions: {} };
  }

  async load(): Promise<this> {
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (this.state.jobHash !== digest(this.job))
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
