import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { recordAuthStorageOperation } from "../performance";
import { OBJECT_ROOT } from "./keys-and-validation";

type Environment = Readonly<Record<string, string | undefined>>;

function storageAttempts(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  const metadata = (value as { $metadata?: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null) return 1;
  const attempts = (metadata as { attempts?: unknown }).attempts;
  return typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts > 0
    ? attempts
    : 1;
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    (candidate.name === "NotFound" && candidate.$metadata?.httpStatusCode === 404)
  );
}

export class SpacesS3Client {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly readOnly: boolean;

  constructor(options: { client: S3Client; bucket: string; readOnly?: boolean }) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.readOnly = options.readOnly ?? false;
  }

  async checkReadiness(): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: OBJECT_ROOT, MaxKeys: 1 }),
      );
    } finally {
      recordAuthStorageOperation("list", performance.now() - startedAt);
    }
  }

  assertWritable(): void {
    if (this.readOnly) {
      throw new Error("Spaces store is configured as read-only in this runtime");
    }
  }

  async readJson<Value>(key: string): Promise<Value | null> {
    const startedAt = performance.now();
    let attempts = 1;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      attempts = storageAttempts(result);
      if (!result.Body) throw new Error(`Object body is missing at ${key}`);
      return JSON.parse(await result.Body.transformToString()) as Value;
    } catch (error) {
      attempts = Math.max(attempts, storageAttempts(error));
      if (isMissingObject(error)) return null;
      throw error;
    } finally {
      recordAuthStorageOperation("get", performance.now() - startedAt, attempts);
    }
  }

  private async recordWriteOperation(
    operation: "put" | "delete",
    send: () => Promise<unknown>,
  ): Promise<void> {
    this.assertWritable();
    const startedAt = performance.now();
    try {
      await send();
    } finally {
      recordAuthStorageOperation(operation, performance.now() - startedAt);
    }
  }

  async writeJson(key: string, value: unknown): Promise<void> {
    await this.recordWriteOperation("put", () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(value),
          ContentType: "application/json",
          ACL: "private",
          CacheControl: "no-store",
        }),
      ),
    );
  }

  async deleteObjectAtKey(key: string): Promise<void> {
    await this.recordWriteOperation("delete", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  async listKeys(prefix: string): Promise<string[]> {
    return (await this.listObjects(prefix)).keys;
  }

  async listCommonPrefixes(prefix: string): Promise<string[]> {
    return (await this.listObjects(prefix, "/")).commonPrefixes;
  }

  private async listObjects(
    prefix: string,
    delimiter?: string,
  ): Promise<{ keys: string[]; commonPrefixes: string[] }> {
    const keys: string[] = [];
    const prefixes: string[] = [];
    const seenTokens = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const startedAt = performance.now();
      let page: ListObjectsV2CommandOutput;
      let attempts = 1;
      try {
        page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ...(delimiter ? { Delimiter: delimiter } : {}),
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }),
        );
        attempts = storageAttempts(page);
      } catch (error) {
        attempts = storageAttempts(error);
        throw error;
      } finally {
        recordAuthStorageOperation("list", performance.now() - startedAt, attempts);
      }
      keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
      prefixes.push(
        ...(page.CommonPrefixes ?? []).flatMap(({ Prefix }) => (Prefix ? [Prefix] : [])),
      );
      if (!page.IsTruncated) break;
      const nextToken = page.NextContinuationToken;
      if (!nextToken || seenTokens.has(nextToken)) throw new Error("S3 listing did not advance");
      seenTokens.add(nextToken);
      continuationToken = nextToken;
    } while (true);
    return { keys, commonPrefixes: prefixes };
  }
}

function requiredEnvironmentValue(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function isReadOnlySpacesRuntime(env: Environment, bucket: string): boolean {
  if (env.VERCEL === "1" && env.VERCEL_ENV !== "development") return true;
  if (env.PERMINISTER_WRITE_PROXY_URL?.trim()) return true;
  const normalizedBucket = bucket.trim().toLowerCase();
  const isProductionBucket =
    normalizedBucket === "perminister" ||
    normalizedBucket.endsWith("-prod") ||
    normalizedBucket.endsWith("-production");
  if (isProductionBucket && env.PERMINISTER_WRITER_MODE !== "true") {
    return true;
  }
  return false;
}

export function createSpacesClientConfigFromEnv(env: Environment = process.env): {
  client: S3Client;
  bucket: string;
  identityIndexSecret: string;
  readOnly: boolean;
} {
  const endpoint = requiredEnvironmentValue(env, "PERMINISTER_SPACES_ENDPOINT");
  const region = requiredEnvironmentValue(env, "PERMINISTER_SPACES_REGION");
  const bucket = requiredEnvironmentValue(env, "PERMINISTER_SPACES_BUCKET");
  const parsedEndpoint = new URL(endpoint);
  if (
    parsedEndpoint.protocol !== "https:" ||
    parsedEndpoint.pathname !== "/" ||
    parsedEndpoint.port !== "" ||
    parsedEndpoint.search ||
    parsedEndpoint.hash ||
    parsedEndpoint.username ||
    parsedEndpoint.password ||
    parsedEndpoint.hostname.toLowerCase() !==
      `${bucket.toLowerCase()}.${region.toLowerCase()}.digitaloceanspaces.com`
  ) {
    throw new Error("Spaces endpoint must be the bucket's HTTPS endpoint");
  }

  const client = new S3Client({
    endpoint: `https://${region.toLowerCase()}.digitaloceanspaces.com`,
    region,
    credentials: {
      accessKeyId: requiredEnvironmentValue(env, "PERMINISTER_SPACES_ACCESS_KEY"),
      secretAccessKey: requiredEnvironmentValue(env, "PERMINISTER_SPACES_SECRET_KEY"),
    },
    maxAttempts: 3,
  });

  return {
    client,
    bucket,
    identityIndexSecret: requiredEnvironmentValue(env, "PERMINISTER_IDENTITY_INDEX_SECRET"),
    readOnly: isReadOnlySpacesRuntime(env, bucket),
  };
}
