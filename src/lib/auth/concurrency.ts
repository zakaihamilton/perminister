const MAX_CONCURRENT_READS = 12;

export async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  operation: (value: Value, index: number) => Promise<Result>,
  maxConcurrency = MAX_CONCURRENT_READS,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(maxConcurrency)), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await operation(values[index]!, index);
      }
    }),
  );
  return results;
}
