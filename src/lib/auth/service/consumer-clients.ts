import "server-only";

import { randomBytes } from "node:crypto";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  type ConsumerClientRecord,
  effectiveConsumerSessionLifetimeMs,
  MAX_CONSUMER_SESSION_LIFETIME_MS,
  MIN_CONSUMER_SESSION_LIFETIME_MS,
  newConsumerClientId,
  type OAuthClientRegistrationRecord,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type ProductRecord,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { normalizeOAuthUri, normalizeOAuthUriList, parseOAuthScopeList } from "../oauth-uris";
import type { VersionedRecord } from "../storage/spaces";
import { requireProductRoleUnlocked } from "./core";
import { hashHex } from "./passwords";
import {
  listProductsByProductIdDuringRender,
  listRecordsWithRecovery,
  loadRecord,
  persistRecord,
  store,
} from "./persistence";
import { isActiveSharedInstallationForSource, isSharedProductSource } from "./products";
import { validateProductId } from "./validators";

export interface ConsumerClientSummary {
  clientId: string;
  productId: string;
  appName: string;
  appOrigin: string | null;
  redirectUris: readonly string[];
  resourceUris: readonly string[];
  oauthScopes: readonly string[];
  sessionLifetimeMs: number;
  selfRegistrationEnabled: boolean;
  status: ConsumerClientRecord["status"];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ConsumerClientCredential {
  clientId: string;
  secret: string;
}

export interface CreateConsumerClientOptions {
  appName: string;
  appOrigin: string;
  redirectUris?: readonly string[];
  resourceUris?: readonly string[];
  oauthScopes?: readonly string[];
  sessionLifetimeSeconds: number;
  selfRegistrationEnabled: boolean;
}

export interface ConsumerOAuthAuthorizationClient {
  oauthClientId: string;
  oauthClientType: "confidential" | "public";
  clientName: string;
  profile: ConsumerClientRecord;
  redirectUris: readonly string[];
  registrationScopes: readonly string[] | null;
}

function consumerClientSummary(record: ConsumerClientRecord): ConsumerClientSummary {
  return {
    clientId: record.consumerClientId,
    productId: record.productId,
    appName: record.appName,
    appOrigin: record.appOrigin,
    redirectUris: record.redirectUris ?? [],
    resourceUris: record.resourceUris ?? [],
    oauthScopes: record.oauthScopes ?? [],
    sessionLifetimeMs: effectiveConsumerSessionLifetimeMs(record.sessionLifetimeMs),
    selfRegistrationEnabled: record.selfRegistrationEnabled,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

async function consumerClientPublisherProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  if (product.pendingMove) {
    throw new Error("A product move is in progress. Resume it before making changes.");
  }
  const reference = product.sharedProductRef;
  if (!reference) return product;

  const publisher = await store().readProduct(
    reference.sourceOrganizationId,
    reference.sourceProductId,
  );
  if (
    !publisher ||
    publisher.sharedProductRef ||
    publisher.productRecordId !== reference.sourceProductRecordId ||
    publisher.productId !== productId ||
    publisher.visibility !== "public"
  ) {
    throw new Error("The product publisher is unavailable.");
  }
  return publisher;
}

async function consumerClientOrganizationsForPublisherUnlocked(
  publisher: ProductRecord,
  products?: readonly ProductRecord[],
): Promise<Set<string>> {
  const organizationIds = new Set<string>([publisher.organizationId]);
  if (!isSharedProductSource(publisher)) return organizationIds;

  const productRecords = products ?? (await store().listProductsByProductId(publisher.productId));
  for (const product of productRecords) {
    if (isActiveSharedInstallationForSource(product, publisher)) {
      organizationIds.add(product.organizationId);
    }
  }
  return organizationIds;
}

async function requireManagedConsumerClientUnlocked(
  organizationId: string,
  productId: string,
  clientId: string,
  requireActive: boolean,
  errorMessage: string,
): Promise<VersionedRecord<ConsumerClientRecord>> {
  const found = await loadRecord("consumer-client", clientId);
  const publisher = await consumerClientPublisherProductUnlocked(organizationId, productId);
  const manageableOrganizations = await consumerClientOrganizationsForPublisherUnlocked(publisher);
  if (
    !found ||
    found.record.productId !== productId ||
    (requireActive && found.record.status !== "active") ||
    !found.record.organizationId ||
    !manageableOrganizations.has(found.record.organizationId)
  ) {
    throw new Error(errorMessage);
  }
  return found;
}

async function requirePublisherManagedConsumerClientProductUnlocked(
  organizationId: string,
  productId: string,
): Promise<ProductRecord> {
  const product = await store().readProduct(organizationId, productId);
  if (!product) throw new Error("Product not found.");
  if (product.sharedProductRef) {
    throw new Error("App clients are managed by the product publisher.");
  }
  return product;
}

function validateConsumerClientOptions(_productId: string, options: CreateConsumerClientOptions) {
  const appName = options.appName.trim().replace(/\s+/g, " ");
  if (!appName || appName.length > 80 || /[\u0000-\u001f\u007f]/.test(appName)) {
    throw new Error("Enter an application name up to 80 characters.");
  }
  let appOrigin: string | null = null;
  const enteredAppOrigin = options.appOrigin.trim();
  if (enteredAppOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(enteredAppOrigin);
    } catch {
      throw new Error("Enter a valid app origin.");
    }
    const isAllowedProtocol =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
    if (
      !isAllowedProtocol ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        "Use an HTTPS app origin, or an HTTP localhost or 127.0.0.1 origin, without a path, query, or fragment.",
      );
    }
    appOrigin = parsed.origin;
  }
  if (
    !Number.isSafeInteger(options.sessionLifetimeSeconds) ||
    options.sessionLifetimeSeconds < MIN_CONSUMER_SESSION_LIFETIME_MS / 1000 ||
    options.sessionLifetimeSeconds > MAX_CONSUMER_SESSION_LIFETIME_MS / 1000
  ) {
    throw new Error("Session lifetime must be between 5 minutes and 30 days.");
  }
  if (typeof options.selfRegistrationEnabled !== "boolean") {
    throw new Error("Choose whether self-registration is enabled.");
  }
  const redirectUris = normalizeOAuthUriList(options.redirectUris ?? [], "redirect URIs");
  const resourceUris = normalizeOAuthUriList(options.resourceUris ?? [], "resource URIs");
  const oauthScopes = parseOAuthScopeList((options.oauthScopes ?? []).join(" "));
  if ((resourceUris.length === 0) !== (oauthScopes.length === 0)) {
    throw new Error("Configure both resource URIs and OAuth scopes, or leave both empty.");
  }
  if (oauthScopes.some((scope) => ["openid", "profile", "email", "perminister_api"].includes(scope))) {
    throw new Error("OpenID identity scopes are reserved and cannot be configured as permission actions.");
  }
  return { appName, appOrigin, redirectUris, resourceUris, oauthScopes };
}

async function assertOAuthResourcesAvailable(
  consumerClientId: string | null,
  resourceUris: readonly string[],
): Promise<void> {
  if (!resourceUris.length) return;
  const requested = new Set(resourceUris);
  const conflict = (await listRecordsWithRecovery("consumer-client")).some(
    ({ record }) =>
      record.consumerClientId !== consumerClientId &&
      record.status === "active" &&
      (record.resourceUris ?? []).some((resource) => requested.has(resource)),
  );
  if (conflict) throw new Error("Each OAuth resource URI can be assigned to only one active client.");
}

export async function getConsumerClientRecord(
  clientId: string,
): Promise<ConsumerClientRecord | null> {
  assertOpaqueId(clientId);
  return authMutationQueue.read(async () => {
    const found = await loadRecord("consumer-client", clientId);
    return found?.record ?? null;
  });
}

export async function getOAuthClientRegistration(
  clientId: string,
): Promise<OAuthClientRegistrationRecord | null> {
  assertOpaqueId(clientId);
  return authMutationQueue.read(async () => {
    const found = await loadRecord("oauth-client-registration", clientId);
    return found?.record ?? null;
  });
}

export async function findConsumerClientForResource(
  resourceUri: string,
): Promise<ConsumerClientRecord | null> {
  const normalized = normalizeOAuthUri(resourceUri, "resource URI");
  return authMutationQueue.read(async () => {
    const matches = (await listRecordsWithRecovery("consumer-client"))
      .map(({ record }) => record)
      .filter(
        (record) =>
          record.status === "active" && (record.resourceUris ?? []).includes(normalized),
      );
    return matches.length === 1 ? matches[0] : null;
  });
}

export async function getOAuthAuthorizationClient(
  clientId: string,
  resourceUri: string | null,
): Promise<ConsumerOAuthAuthorizationClient | null> {
  assertOpaqueId(clientId);
  let normalizedResourceUri: string | null = null;
  try {
    if (resourceUri) normalizedResourceUri = normalizeOAuthUri(resourceUri, "resource URI");
  } catch {
    return null;
  }
  const confidential = await getConsumerClientRecord(clientId);
  if (confidential?.status === "active") {
    if (
      (confidential.resourceUris?.length &&
        (!normalizedResourceUri || !confidential.resourceUris.includes(normalizedResourceUri))) ||
      (normalizedResourceUri && !confidential.resourceUris?.includes(normalizedResourceUri))
    ) {
      return null;
    }
    const legacyRedirect = confidential.appOrigin
      ? new URL("/auth/perminister/callback", confidential.appOrigin).toString()
      : null;
    const redirectUris = confidential.redirectUris?.length
      ? confidential.redirectUris
      : legacyRedirect
        ? [legacyRedirect]
        : [];
    if (!redirectUris.length) return null;
    return {
      oauthClientId: clientId,
      oauthClientType: "confidential",
      clientName: confidential.appName,
      profile: confidential,
      redirectUris,
      registrationScopes: null,
    };
  }

  const registration = await getOAuthClientRegistration(clientId);
  if (
    !registration ||
    registration.status !== "active" ||
    !normalizedResourceUri ||
    !registration.redirectUris.length
  ) {
    return null;
  }
  const profile = await findConsumerClientForResource(normalizedResourceUri);
  if (!profile) return null;
  return {
    oauthClientId: clientId,
    oauthClientType: "public",
    clientName: registration.clientName,
    profile,
    redirectUris: registration.redirectUris,
    registrationScopes: registration.scopes ?? null,
  };
}

export async function registerOAuthClient(
  clientNameInput: string,
  redirectUrisInput: readonly string[],
  scopesInput?: readonly string[],
): Promise<OAuthClientRegistrationRecord> {
  const clientName = clientNameInput.trim().replace(/\s+/g, " ") || "OAuth client";
  if (clientName.length > 80 || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw new Error("Enter a client name up to 80 characters.");
  }
  const redirectUris = normalizeOAuthUriList(redirectUrisInput, "redirect URIs");
  if (!redirectUris.length) throw new Error("Register at least one redirect URI.");
  const scopes = scopesInput ? parseOAuthScopeList(scopesInput.join(" ")) : [];
  const now = new Date().toISOString();
  const record: OAuthClientRegistrationRecord = {
    kind: "oauth-client-registration",
    schemaVersion: 1,
    oauthClientId: newConsumerClientId(),
    clientName,
    redirectUris,
    ...(scopes.length ? { scopes } : {}),
    createdAt: now,
    updatedAt: now,
    status: "active",
    revokedAt: null,
  };
  await authMutationQueue.run(() =>
    persistRecord(record, "oauth-client-registration.created", { kind: "system" }),
  );
  return record;
}

export async function listConsumerClientsForProduct(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<ConsumerClientSummary[]> {
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.read(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
      "owner",
      "admin",
    ]);
    const publisher = await consumerClientPublisherProductUnlocked(
      organizationId,
      normalizedProductId,
    );
    const products = isSharedProductSource(publisher)
      ? await listProductsByProductIdDuringRender(publisher.productId)
      : undefined;
    const manageableOrganizations = await consumerClientOrganizationsForPublisherUnlocked(
      publisher,
      products,
    );
    return (await listRecordsWithRecovery("consumer-client"))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.productId === normalizedProductId &&
          !!record.organizationId &&
          manageableOrganizations.has(record.organizationId),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(consumerClientSummary);
  });
}

async function withConsumerClientManager<Result>(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  operation: (actor: OrganizationMembershipRecord, normalizedProductId: string) => Promise<Result>,
): Promise<Result> {
  assertOpaqueId(organizationId);
  const normalizedProductId = validateProductId(productId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, normalizedProductId, [
        "owner",
        "admin",
      ]);
      await requirePublisherManagedConsumerClientProductUnlocked(
        organizationId,
        normalizedProductId,
      );
      return operation(actor, normalizedProductId);
    }),
  );
}

export async function createConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientCredential> {
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      await assertOAuthResourcesAvailable(null, validated.resourceUris);
      const consumerClientId = newConsumerClientId();
      const secret = `pmc_${consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const now = new Date().toISOString();
      const record: ConsumerClientRecord = {
        kind: "consumer-client",
        schemaVersion: 1,
        consumerClientId,
        organizationId: organizationId as OrganizationId,
        productId: normalizedProductId,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        redirectUris: validated.redirectUris,
        resourceUris: validated.resourceUris,
        oauthScopes: validated.oauthScopes,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        status: "active",
        createdBySubjectId: actor.subjectId,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      };
      await persistRecord(record, "consumer-client.created", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: consumerClientId, secret };
    },
  );
}

export async function updateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
  options: CreateConsumerClientOptions,
): Promise<ConsumerClientSummary> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const validated = validateConsumerClientOptions(normalizedProductId, options);
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
      await assertOAuthResourcesAvailable(found.record.consumerClientId, validated.resourceUris);
      const next: ConsumerClientRecord = {
        ...found.record,
        appName: validated.appName,
        appOrigin: validated.appOrigin,
        redirectUris: validated.redirectUris,
        resourceUris: validated.resourceUris,
        oauthScopes: validated.oauthScopes,
        sessionLifetimeMs: options.sessionLifetimeSeconds * 1000,
        selfRegistrationEnabled: options.selfRegistrationEnabled,
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.updated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return consumerClientSummary(next);
    },
  );
}

export async function rotateConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<ConsumerClientCredential> {
  assertOpaqueId(clientId);
  return withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        true,
        "Choose an active application client for this product.",
      );
      const secret = `pmc_${found.record.consumerClientId}_${randomBytes(32).toString("base64url")}`;
      const next: ConsumerClientRecord = {
        ...found.record,
        verifier: { algorithm: "sha256", digestHex: hashHex(secret) },
        updatedAt: new Date().toISOString(),
      };
      await persistRecord(next, "consumer-client.secret-rotated", {
        kind: "subject",
        subjectId: actor.subjectId,
      });
      return { clientId: next.consumerClientId, secret };
    },
  );
}

export async function revokeConsumerClient(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  clientId: string,
): Promise<void> {
  assertOpaqueId(clientId);
  await withConsumerClientManager(
    actorId,
    organizationId,
    productId,
    async (actor, normalizedProductId) => {
      const found = await requireManagedConsumerClientUnlocked(
        organizationId,
        normalizedProductId,
        clientId,
        false,
        "Application client not found.",
      );
      if (found.record.status === "revoked") return;
      const now = new Date().toISOString();
      await persistRecord(
        {
          ...found.record,
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        },
        "consumer-client.revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    },
  );
}
