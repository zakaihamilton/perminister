export interface AuthObjectClient {
  supportsDistributedCoordination?: boolean;
  checkReadiness(): Promise<void>;
  assertWritable(): void;
  readJson<Value>(key: string): Promise<Value | null>;
  writeJson(key: string, value: unknown): Promise<void>;
  deleteObjectAtKey(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  listCommonPrefixes(prefix: string, delimiter?: string): Promise<string[]>;
  consumeRateLimit?(
    namespace: string,
    digest: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean>;
  consumeRateLimits?(
    charges: readonly {
      namespace: string;
      digest: string;
      limit: number;
      windowMs: number;
    }[],
  ): Promise<boolean>;
}

export function storageBackendFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): "spaces" | "s3" | "postgres" {
  const backend = env.PERMINISTER_STORAGE_BACKEND?.trim().toLowerCase() || "spaces";
  if (backend !== "spaces" && backend !== "s3" && backend !== "postgres") {
    throw new Error("PERMINISTER_STORAGE_BACKEND must be spaces, s3, or postgres");
  }
  return backend;
}
