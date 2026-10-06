import "server-only";

/**
 * Serializes mutations in this Node.js process only. It is not a distributed
 * lock and must not be used as one when more than one writer process is active.
 */
export class SingleWriterMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const authMutationQueue = new SingleWriterMutationQueue();
