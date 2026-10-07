import "server-only";

type QueueEntry = {
  kind: "read" | "write";
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

/**
 * Serializes mutations in this Node.js process only. It is not a distributed
 * lock and must not be used as one when more than one writer process is active.
 * The Spaces store has no conditional PutObject support, so deploy one writer
 * process per bucket until auth mutations use a transactional shared store.
 * Read operations may run together, but wait behind earlier writes and prevent
 * later writes from starting until the current read batch has finished.
 */
export class SingleWriterMutationQueue {
  private readonly pending: QueueEntry[] = [];
  private activeReaders = 0;
  private activeWriter = false;

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue("write", operation);
  }

  read<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue("read", operation);
  }

  private enqueue<T>(kind: QueueEntry["kind"], operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        kind,
        execute: operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeWriter) return;

    if (this.activeReaders > 0) {
      while (this.pending[0]?.kind === "read") this.startRead(this.pending.shift()!);
      return;
    }

    if (this.pending[0]?.kind === "read") {
      while (this.pending[0]?.kind === "read") this.startRead(this.pending.shift()!);
      return;
    }

    const next = this.pending.shift();
    if (next) this.startWrite(next);
  }

  private startRead(entry: QueueEntry): void {
    this.activeReaders += 1;
    void Promise.resolve()
      .then(entry.execute)
      .then(entry.resolve, entry.reject)
      .then(() => {
        this.activeReaders -= 1;
        this.drain();
      });
  }

  private startWrite(entry: QueueEntry): void {
    this.activeWriter = true;
    void Promise.resolve()
      .then(entry.execute)
      .then(entry.resolve, entry.reject)
      .then(() => {
        this.activeWriter = false;
        this.drain();
      });
  }
}

export const authMutationQueue = new SingleWriterMutationQueue();
