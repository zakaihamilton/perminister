import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

type StorageOperation = "get" | "list" | "put" | "delete";
type StoragePerformanceSpan = {
  calls: number;
  durationMs: number;
  attempts: number;
  retries: number;
};

type RequestPerformance = {
  storageCalls: number;
  storageMs: number;
  storageAttempts: number;
  storageRetries: number;
  storageByOperation: Record<StorageOperation, number>;
  storageMsByOperation: Record<StorageOperation, number>;
  storageBySpan: Record<string, StoragePerformanceSpan>;
  cacheEvents: Record<string, number>;
};

const requestPerformance = new AsyncLocalStorage<RequestPerformance>();
const requestPerformanceSpan = new AsyncLocalStorage<string | null>();

export function recordAuthStorageOperation(
  operation: StorageOperation,
  durationMs: number,
  attempts = 1,
): void {
  const current = requestPerformance.getStore();
  if (!current) return;
  const normalizedAttempts = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const roundedDurationMs = Math.max(0, durationMs);
  current.storageCalls += 1;
  current.storageMs += roundedDurationMs;
  current.storageAttempts += normalizedAttempts;
  current.storageRetries += normalizedAttempts - 1;
  current.storageByOperation[operation] += 1;
  current.storageMsByOperation[operation] += roundedDurationMs;

  const span = requestPerformanceSpan.getStore();
  if (span) {
    const metric = (current.storageBySpan[span] ??= {
      calls: 0,
      durationMs: 0,
      attempts: 0,
      retries: 0,
    });
    metric.calls += 1;
    metric.durationMs += roundedDurationMs;
    metric.attempts += normalizedAttempts;
    metric.retries += normalizedAttempts - 1;
  }
}

export function recordAuthCacheEvent(cache: string, outcome: "hit" | "miss"): void {
  const current = requestPerformance.getStore();
  if (!current) return;
  const key = `${cache}.${outcome}`;
  current.cacheEvents[key] = (current.cacheEvents[key] ?? 0) + 1;
}

export function withRequestPerformanceSpan<Result>(
  span: string,
  work: () => Promise<Result>,
): Promise<Result> {
  if (!requestPerformance.getStore()) return work();
  return requestPerformanceSpan.run(span, work);
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
    storageAttempts: 0,
    storageRetries: 0,
    storageByOperation: { get: 0, list: 0, put: 0, delete: 0 },
    storageMsByOperation: { get: 0, list: 0, put: 0, delete: 0 },
    storageBySpan: {},
    cacheEvents: {},
  };
  return requestPerformanceSpan.run(null, () =>
    requestPerformance.run(metrics, async () => {
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
            ...(process.env.VERCEL_REGION ? { region: process.env.VERCEL_REGION } : {}),
            storageCalls: metrics.storageCalls,
            storageMs: Math.round(metrics.storageMs),
            storageAttempts: metrics.storageAttempts,
            storageRetries: metrics.storageRetries,
            storageByOperation: metrics.storageByOperation,
            storageMsByOperation: Object.fromEntries(
              Object.entries(metrics.storageMsByOperation).map(([operation, duration]) => [
                operation,
                Math.round(duration),
              ]),
            ),
            storageBySpan: Object.fromEntries(
              Object.entries(metrics.storageBySpan).map(([span, metric]) => [
                span,
                { ...metric, durationMs: Math.round(metric.durationMs) },
              ]),
            ),
            cacheEvents: metrics.cacheEvents,
          }),
        );
      }
    }),
  );
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
