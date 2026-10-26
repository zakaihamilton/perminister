import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

type StorageOperation = "get" | "list" | "put" | "delete";

type RequestPerformance = {
  storageCalls: number;
  storageMs: number;
  storageByOperation: Record<StorageOperation, number>;
};

const requestPerformance = new AsyncLocalStorage<RequestPerformance>();

export function recordAuthStorageOperation(operation: StorageOperation, durationMs: number): void {
  const current = requestPerformance.getStore();
  if (!current) return;
  current.storageCalls += 1;
  current.storageMs += durationMs;
  current.storageByOperation[operation] += 1;
}

export async function withRequestPerformance<Result>(
  route: string,
  work: () => Promise<Result>,
  statusOf?: (result: Result) => number | undefined,
): Promise<Result> {
  const startedAt = performance.now();
  const metrics: RequestPerformance = {
    storageCalls: 0,
    storageMs: 0,
    storageByOperation: { get: 0, list: 0, put: 0, delete: 0 },
  };
  return requestPerformance.run(metrics, async () => {
    let status: number | undefined;
    let failed = false;
    try {
      const result = await work();
      status = statusOf?.(result);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      console.info(
        JSON.stringify({
          event: "perminister.request.performance",
          route,
          ...(status === undefined ? {} : { status }),
          failed,
          durationMs: Math.round(performance.now() - startedAt),
          storageCalls: metrics.storageCalls,
          storageMs: Math.round(metrics.storageMs),
          storageByOperation: metrics.storageByOperation,
        }),
      );
    }
  });
}

export function withApiRoutePerformance<Arguments extends readonly unknown[]>(
  route: string,
  handler: (...args: Arguments) => Promise<Response>,
): (...args: Arguments) => Promise<Response> {
  return (...args) =>
    withRequestPerformance(
      route,
      () => handler(...args),
      (response) => response.status,
    );
}
