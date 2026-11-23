import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  assertOpaqueId,
  type ConsumerAuthorizationCodeRecord,
  effectiveConsumerSessionLifetimeMs,
  newConsumerAuthorizationCodeId,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { normalizeOAuthUri, parseOAuthScopeList } from "../oauth-uris";
import { withRequestPerformanceSpan } from "../performance";
import { hasActiveConsumerProductEntitlement } from "./core";
import { equalHex, hashHex } from "./passwords";
import { loadRecord, loadSubjectUnlocked, persistRecord } from "./persistence";
import { createConsumerSessionUnlocked } from "./sessions";
import {
  ConsumerProductAccessDeniedError,
  consumerProductState,
  requireVerifiedActiveSubject,
} from "./validators";

export class InvalidConsumerAuthorizationCodeError extends Error {
  constructor() {
    super("The authorization code is invalid, expired, or already used.");
    this.name = "InvalidConsumerAuthorizationCodeError";
  }
}

export class InvalidConsumerAuthorizationScopeError extends Error {
  constructor() {
    super("The requested scope does not match the authorization grant.");
    this.name = "InvalidConsumerAuthorizationScopeError";
  }
}

export async function createConsumerAuthorizationCode(
  subjectId: SubjectId,
  oauthClientId: string,
  codeChallenge: string,
  nonce: string | null,
  redirectUri: string,
  scope: string | null,
  resource: string | null = null,
  consumerClientId: string = oauthClientId,
): Promise<string> {
  assertOpaqueId(consumerClientId);
  assertOpaqueId(oauthClientId);
  let normalizedRedirectUri: string;
  let normalizedResource: string | null = null;
  let scopes: string[] = [];
  try {
    normalizedRedirectUri = normalizeOAuthUri(redirectUri, "redirect URI");
    if (resource) normalizedResource = normalizeOAuthUri(resource, "resource URI");
    if (scope) scopes = parseOAuthScopeList(scope);
  } catch {
    throw new Error("Choose a valid OAuth authorization request.");
  }
  const legacyRequest = nonce === null && scope === null && resource === null;
  const identityScopes = new Set(["openid", "profile", "email", "perminister_api"]);
  const oidcRequest =
    nonce !== null && /^[A-Za-z0-9_-]{43}$/.test(nonce) && scope === "openid profile email perminister_api";
  const oauthScopes = scope ? scopes : [];
  const permissionScopes = oauthScopes.filter((requested) => !identityScopes.has(requested));
  const oidcResourceRequest =
    nonce !== null &&
    /^[A-Za-z0-9_-]{43}$/.test(nonce) &&
    oauthScopes.includes("openid") &&
    oauthScopes.every((requested) => identityScopes.has(requested) || /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(requested));
  const oauthRequest =
    Boolean(scope && normalizedResource && permissionScopes.length > 0) &&
    ((nonce === null && !oauthScopes.some((requested) => identityScopes.has(requested))) ||
      oidcResourceRequest);
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    (!legacyRequest && !oidcRequest && !oauthRequest)
  ) {
    throw new Error("Choose a valid OAuth authorization request.");
  }
  return authMutationQueue.run(async () => {
    const [client, registration] = await withRequestPerformanceSpan(
      "auth.oidc.client-lookup",
      () =>
        Promise.all([
          loadRecord("consumer-client", consumerClientId),
          oauthClientId === consumerClientId
            ? Promise.resolve(null)
            : loadRecord("oauth-client-registration", oauthClientId),
        ]),
    );
    if (!client || client.record.status !== "active") {
      throw new Error("Choose an active application client.");
    }
    const profile = client.record;
    const legacyRedirectUri = profile.appOrigin
      ? new URL("/auth/perminister/callback", profile.appOrigin).toString()
      : null;
    const allowedRedirectUris = profile.redirectUris?.length
      ? profile.redirectUris
      : legacyRedirectUri
        ? [legacyRedirectUri]
        : [];
    if (
      (oauthClientId !== consumerClientId &&
        (!registration ||
          registration.record.status !== "active" ||
          !registration.record.redirectUris.includes(normalizedRedirectUri))) ||
      (!allowedRedirectUris.length && oauthClientId === consumerClientId) ||
      (oauthClientId === consumerClientId && !allowedRedirectUris.includes(normalizedRedirectUri)) ||
      (normalizedResource && !profile.resourceUris?.includes(normalizedResource)) ||
      (!normalizedResource && profile.resourceUris?.length) ||
      (oauthRequest &&
        permissionScopes.some((requested) => !profile.oauthScopes?.includes(requested))) ||
      (oauthRequest &&
        registration?.record.scopes &&
        permissionScopes.some((requested) => !registration.record.scopes?.includes(requested)))
    ) {
      throw new Error("Choose an active OAuth client with matching redirect, resource, and scope settings.");
    }
    const subject = await withRequestPerformanceSpan("auth.oidc.authorizing-subject-lookup", () =>
      loadSubjectUnlocked(subjectId),
    );
    requireVerifiedActiveSubject(subject, client.record.productId);
    const productState = consumerProductState(subject, client.record.productId);
    if (
      !(await hasActiveConsumerProductEntitlement(
        subjectId,
        client.record.productId,
        client.record.consumerClientId,
        subject,
      ))
    ) {
      throw new ConsumerProductAccessDeniedError();
    }
    const codeId = newConsumerAuthorizationCodeId();
    const code = `${codeId}.${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const record: ConsumerAuthorizationCodeRecord = {
      kind: "consumer-authorization-code",
      schemaVersion: 1,
      consumerAuthorizationCodeId: codeId,
      consumerClientId: profile.consumerClientId,
      ...(oauthClientId !== profile.consumerClientId
        ? { oauthClientId: oauthClientId as typeof profile.consumerClientId }
        : {}),
      subjectId,
      authVersion: subject.authVersion,
      productSessionVersion: productState.sessionVersion,
      codeDigestHex: hashHex(code),
      codeChallenge,
      nonce,
      redirectUri: normalizedRedirectUri,
      ...(normalizedResource ? { resource: normalizedResource } : {}),
      scope,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      consumedAt: null,
    };
    await withRequestPerformanceSpan("auth.oidc.authorization-code.persist", () =>
      persistRecord(record, "consumer-authorization-code.issued", {
        kind: "subject",
        subjectId,
      }),
    );
    return code;
  });
}

export async function exchangeConsumerAuthorizationCode(
  code: string,
  oauthClientId: string,
  codeVerifier: string,
  redirectUri?: string,
  resource: string | null = null,
  requestedScope?: string,
  options: {
    requireOAuthTokenResponse?: boolean;
    beforeConsume?: (authorization: { nonce: string | null; scope: string | null }) => void;
  } = {},
): Promise<{
  session: SessionRecord;
  token: string;
  subject: SubjectRecord;
  productId: string;
  nonce: string | null;
  scope: string | null;
}> {
  assertOpaqueId(oauthClientId);
  if (code.length > 128 || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    throw new InvalidConsumerAuthorizationCodeError();
  }
  let normalizedRedirectUri: string | null = null;
  let normalizedResource: string | null = null;
  try {
    if (redirectUri) normalizedRedirectUri = normalizeOAuthUri(redirectUri, "redirect URI");
    if (resource) normalizedResource = normalizeOAuthUri(resource, "resource URI");
  } catch {
    throw new InvalidConsumerAuthorizationCodeError();
  }
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(code);
  if (!match) throw new InvalidConsumerAuthorizationCodeError();
  const codeChallenge = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return authMutationQueue.run(async () => {
    const authorization = await withRequestPerformanceSpan(
      "auth.oidc.exchange-record-lookup",
      () => loadRecord("consumer-authorization-code", match[1]),
    );
    if (!authorization) throw new InvalidConsumerAuthorizationCodeError();
    const codeRecord = authorization.record;
    const boundOAuthClientId = codeRecord.oauthClientId ?? codeRecord.consumerClientId;
    const [client, registration] = await Promise.all([
      loadRecord("consumer-client", codeRecord.consumerClientId),
      boundOAuthClientId === codeRecord.consumerClientId
        ? Promise.resolve(null)
        : loadRecord("oauth-client-registration", oauthClientId),
    ]);
    const profile = client?.record;
    const legacyRedirectUri = profile?.appOrigin
      ? new URL("/auth/perminister/callback", profile.appOrigin).toString()
      : null;
    const allowedRedirectUris = profile?.redirectUris?.length
      ? profile.redirectUris
      : legacyRedirectUri
        ? [legacyRedirectUri]
        : [];
    const oauthRedirectUris =
      boundOAuthClientId === codeRecord.consumerClientId
        ? allowedRedirectUris
        : registration?.record.redirectUris ?? [];
    const needsRedirectBinding = Boolean(
      codeRecord.oauthClientId || codeRecord.scope || codeRecord.nonce || codeRecord.resource,
    );
    if (
      !profile ||
      profile.status !== "active" ||
      boundOAuthClientId !== oauthClientId ||
      (needsRedirectBinding &&
        (!normalizedRedirectUri ||
          normalizedRedirectUri !== codeRecord.redirectUri ||
          !oauthRedirectUris.includes(normalizedRedirectUri))) ||
      (!needsRedirectBinding &&
        normalizedRedirectUri &&
        normalizedRedirectUri !== codeRecord.redirectUri) ||
      (codeRecord.resource
        ? codeRecord.resource !== normalizedResource
        : normalizedResource !== null) ||
      (codeRecord.resource && !profile.resourceUris?.includes(codeRecord.resource)) ||
      (!codeRecord.resource && profile.resourceUris?.length) ||
      (boundOAuthClientId !== codeRecord.consumerClientId &&
        (!registration ||
          registration.record.status !== "active" ||
          !registration.record.redirectUris.includes(codeRecord.redirectUri))) ||
      codeRecord.consumedAt ||
      Date.parse(codeRecord.expiresAt) <= Date.now() ||
      !equalHex(codeRecord.codeDigestHex, hashHex(code))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const grantedScopes = codeRecord.scope ? parseOAuthScopeList(codeRecord.scope) : [];
    const identityScopes = new Set(["openid", "profile", "email", "perminister_api"]);
    const grantedPermissionScopes = grantedScopes.filter((scope) => !identityScopes.has(scope));
    if (
      (codeRecord.resource &&
        grantedPermissionScopes.some((scope) => !profile.oauthScopes?.includes(scope))) ||
      (registration?.record.scopes &&
        grantedPermissionScopes.some((scope) => !registration.record.scopes?.includes(scope)))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const expectedChallenge = Buffer.from(authorization.record.codeChallenge, "utf8");
    const actualChallenge = Buffer.from(codeChallenge, "utf8");
    if (
      expectedChallenge.length !== actualChallenge.length ||
      !timingSafeEqual(expectedChallenge, actualChallenge)
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    if (
      options.requireOAuthTokenResponse &&
      (!codeRecord.scope || (!codeRecord.nonce && !codeRecord.resource))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    if (requestedScope !== undefined && requestedScope !== codeRecord.scope) {
      throw new InvalidConsumerAuthorizationScopeError();
    }
    const productStateSubject = await withRequestPerformanceSpan(
      "auth.oidc.exchange-subject-lookup",
      () => loadSubjectUnlocked(authorization.record.subjectId),
    );
    const productState = productStateSubject
      ? consumerProductState(productStateSubject, profile.productId)
      : null;
    if (
      !productStateSubject ||
      productStateSubject.status !== "active" ||
      productStateSubject.authVersion !== authorization.record.authVersion ||
      !productState ||
      productState.sessionVersion !== authorization.record.productSessionVersion
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    if (
      !(await hasActiveConsumerProductEntitlement(
        authorization.record.subjectId,
        profile.productId,
        profile.consumerClientId,
        productStateSubject,
      ))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    options.beforeConsume?.({ nonce: codeRecord.nonce, scope: codeRecord.scope });
    const consumedAt = new Date().toISOString();
    await withRequestPerformanceSpan("auth.oidc.code-consume.persist", () =>
      persistRecord(
        { ...codeRecord, consumedAt },
        "consumer-authorization-code.consumed",
        { kind: "subject", subjectId: codeRecord.subjectId },
      ),
    );
    const created = await createConsumerSessionUnlocked(
      productStateSubject,
      profile.consumerClientId,
      profile.productId,
      effectiveConsumerSessionLifetimeMs(profile.sessionLifetimeMs),
      codeRecord.resource
        ? {
            ...(boundOAuthClientId !== profile.consumerClientId
              ? { oauthClientId: boundOAuthClientId }
              : {}),
            resource: codeRecord.resource,
            scopes: grantedPermissionScopes,
            scope: codeRecord.scope ?? "",
          }
        : undefined,
    );
    return {
      ...created,
      subject: productStateSubject,
      productId: profile.productId,
      nonce: codeRecord.nonce,
      scope: codeRecord.scope,
    };
  });
}
