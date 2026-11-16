import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { authMutationQueue } from "../mutation-queue";
import { processLocalLoginThrottle } from "../login-throttle";
import { withRequestPerformanceSpan } from "../performance";
import {
  assertOpaqueId,
  newConsumerAuthorizationCodeId,
  newEmailActionId,
  newSessionId,
  newSubjectId,
  DEFAULT_CONSUMER_SESSION_LIFETIME_MS,
  MAX_CONSUMER_SESSION_LIFETIME_MS,
  MIN_CONSUMER_SESSION_LIFETIME_MS,
  effectiveConsumerSessionLifetimeMs,
  type ConsumerAuthorizationCodeRecord,
  type EmailActionId,
  type EmailActionRecord,
  type ExternalIdentity,
  type PasswordCredential,
  type SessionId,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import {
  InvalidAuthActionError,
  canonicalEmail,
  consumerProductState,
  createPasswordCredential,
  equalHex,
  hasActiveConsumerProductEntitlement,
  hashHex,
  listRecordsWithRecovery,
  loadRecord,
  loadSubjectByEmailUnlocked,
  loadSubjectByExternalIdentityUnlocked,
  loadSubjectByUsernameUnlocked,
  loadSubjectUnlocked,
  normalizeProductUsername,
  normalizedPersonName,
  persistRecord,
  rehashAfterLogin,
  rememberSessionSubject,
  requireVerifiedActiveSubject,
  sessionSubjectCache,
  validateProductId,
  verifyPassword,
} from "./core";

const SESSION_COOKIE = "perminister_session";
const SESSION_LIFETIME_MS = DEFAULT_CONSUMER_SESSION_LIFETIME_MS;
const EMAIL_ACTION_LIFETIME_MS = 30 * 60 * 1000;

function hasSessionExpired(record: SessionRecord, now: number): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return true;
  if (!record.applicationClientId && !record.productId) return false;

  const createdAt = Date.parse(record.createdAt);
  return !Number.isFinite(createdAt) || createdAt + MAX_CONSUMER_SESSION_LIFETIME_MS <= now;
}

export async function registerAccount(
  emailInput: string,
  password: string,
  profile: { firstName?: string; lastName?: string } = {},
  consumerLoginIdentifier?: { productId: string; username: string },
): Promise<SubjectRecord> {
  const email = canonicalEmail(emailInput);
  const firstName = normalizedPersonName(profile.firstName, "First");
  const lastName = normalizedPersonName(profile.lastName, "Last");
  const passwordCredential = await createPasswordCredential(password);
  const username = consumerLoginIdentifier
    ? normalizeProductUsername(consumerLoginIdentifier.username, consumerLoginIdentifier.productId)
    : null;
  if (
    consumerLoginIdentifier &&
    consumerLoginIdentifier.productId.trim().toLowerCase() !== "system-concepts"
  ) {
    throw new Error("Product-specific self-registration is not enabled for this application.");
  }
  return authMutationQueue.run(async () => {
    if (await loadSubjectByEmailUnlocked(email)) {
      throw new Error("An account with this email address already exists.");
    }
    if (
      username &&
      (await loadSubjectByUsernameUnlocked(consumerLoginIdentifier!.productId, username))
    ) {
      throw new Error("That System Concepts ID is already in use.");
    }
    const now = new Date().toISOString();
    const subject: SubjectRecord = {
      kind: "subject",
      schemaVersion: 1,
      subjectId: newSubjectId(),
      status: "active",
      firstName,
      lastName,
      primaryEmail: email,
      emailVerifiedAt: null,
      emailVerificationExempt: false,
      loginIdentifiers:
        consumerLoginIdentifier && username
          ? [
              {
                kind: "username",
                productId: consumerLoginIdentifier.productId,
                value: username,
                normalizedValue: username,
              },
            ]
          : [],
      legacySources: [],
      passwordCredential,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(subject, "identity.registered", {
      kind: "subject",
      subjectId: subject.subjectId,
    });
    return subject;
  });
}

export class GoogleAccountLinkRequiredError extends Error {
  constructor() {
    super("Sign in with the existing Perminister account before linking Google.");
    this.name = "GoogleAccountLinkRequiredError";
  }
}

export async function signInWithGoogle(input: {
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}): Promise<SubjectRecord> {
  if (
    typeof input.providerSubject !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(input.providerSubject) ||
    input.emailVerified !== true
  ) {
    throw new Error("Google did not return a verified account.");
  }

  const email = canonicalEmail(input.email);
  const identity: ExternalIdentity = { provider: "google", subject: input.providerSubject };
  const firstName = normalizedPersonName(input.firstName?.slice(0, 80), "First");
  const lastName = normalizedPersonName(input.lastName?.slice(0, 80), "Last");

  return authMutationQueue.run(async () => {
    const linkedSubject = await loadSubjectByExternalIdentityUnlocked("google", identity.subject);
    if (linkedSubject) {
      if (linkedSubject.status !== "active" || linkedSubject.deletedAt) {
        throw new Error("This Perminister account cannot sign in.");
      }
      return linkedSubject;
    }

    const existingSubject = await loadSubjectByEmailUnlocked(email);
    if (existingSubject) {
      if (existingSubject.status !== "active" || existingSubject.deletedAt) {
        throw new Error("This Perminister account cannot sign in.");
      }
      if (!existingSubject.primaryEmail || canonicalEmail(existingSubject.primaryEmail) !== email) {
        throw new GoogleAccountLinkRequiredError();
      }
      if (existingSubject.externalIdentities?.some(({ provider }) => provider === "google")) {
        throw new GoogleAccountLinkRequiredError();
      }

      const now = new Date().toISOString();
      const linked: SubjectRecord = {
        ...existingSubject,
        emailVerifiedAt: existingSubject.emailVerifiedAt ?? now,
        externalIdentities: [...(existingSubject.externalIdentities ?? []), identity],
        updatedAt: now,
      };
      await persistRecord(linked, "identity.google-linked", {
        kind: "subject",
        subjectId: linked.subjectId,
      });
      return linked;
    }

    const now = new Date().toISOString();
    const subject: SubjectRecord = {
      kind: "subject",
      schemaVersion: 1,
      subjectId: newSubjectId(),
      status: "active",
      firstName,
      lastName,
      primaryEmail: email,
      emailVerifiedAt: now,
      emailVerificationExempt: false,
      loginIdentifiers: [],
      legacySources: [],
      externalIdentities: [identity],
      passwordCredential: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await persistRecord(subject, "identity.google-registered", {
      kind: "subject",
      subjectId: subject.subjectId,
    });
    return subject;
  });
}

export async function updateAccountProfile(
  subjectId: SubjectId,
  profile: { firstName: string; lastName: string },
): Promise<void> {
  const firstName = normalizedPersonName(profile.firstName, "First");
  const lastName = normalizedPersonName(profile.lastName, "Last");
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subjectId);
    if (!current || current.status !== "active") {
      throw new Error("This account cannot update its profile.");
    }
    if (current.firstName === firstName && current.lastName === lastName) return;
    const next: SubjectRecord = {
      ...current,
      firstName,
      lastName,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, "identity.profile-updated", {
      kind: "subject",
      subjectId,
    });
  });
}

export async function authenticate(
  identifierInput: string,
  password: string,
  productId?: string,
): Promise<SubjectRecord> {
  const identifier = productId
    ? normalizeProductUsername(identifierInput, productId)
    : canonicalEmail(identifierInput);
  const attempt = processLocalLoginThrottle.beginAttempt(
    productId ? `${productId}:${identifier}` : identifier,
  );
  try {
    if (attempt.delayMs > 0) {
      await withRequestPerformanceSpan(
        "auth.password.throttle-delay",
        () => new Promise<void>((resolve) => setTimeout(resolve, attempt.delayMs)),
      );
    }
    const subject = await withRequestPerformanceSpan("auth.password.account-lookup", () =>
      authMutationQueue.run(async () => {
        if (!productId) return loadSubjectByEmailUnlocked(identifier);
        const [emailSubject, usernameSubject] = await Promise.all([
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
            ? loadSubjectByEmailUnlocked(identifier)
            : Promise.resolve(null),
          loadSubjectByUsernameUnlocked(productId, identifier),
        ]);
        if (
          emailSubject &&
          usernameSubject &&
          emailSubject.subjectId !== usernameSubject.subjectId
        ) {
          return null;
        }
        return emailSubject ?? usernameSubject;
      }),
    );
    const matched = await withRequestPerformanceSpan("auth.password.verification", () =>
      verifyPassword(password, subject?.passwordCredential ?? null),
    );
    if (
      !subject ||
      subject.status !== "active" ||
      !matched ||
      (productId !== undefined && consumerProductState(subject, productId).status !== "active")
    ) {
      attempt.recordFailure();
      throw new Error("Email or password is incorrect.");
    }
    attempt.recordSuccess();
    await withRequestPerformanceSpan("auth.password.rehash", () =>
      rehashAfterLogin(subject, password),
    );
    return subject;
  } catch (error) {
    attempt.release();
    throw error;
  }
}

export async function changePasswordForSubject(
  subjectId: SubjectId,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subjectId);
    if (!current || current.status !== "active")
      throw new Error("This account cannot change its password.");
    if (!(await verifyPassword(currentPassword, current.passwordCredential))) {
      throw new Error("Current password is incorrect.");
    }
    const passwordCredential = await createPasswordCredential(newPassword);
    const next: SubjectRecord = {
      ...current,
      passwordCredential,
      authVersion: current.authVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, "credential.password-changed", {
      kind: "subject",
      subjectId,
    });
  });
}

export async function createSession(
  subjectId: SubjectId,
): Promise<{ session: SessionRecord; token: string }> {
  return withRequestPerformanceSpan("auth.session.create", () =>
    authMutationQueue.run(async () => {
      const subject = await withRequestPerformanceSpan("auth.session.subject-lookup", () =>
        loadSubjectUnlocked(subjectId),
      );
      if (!subject || subject.status !== "active") {
        throw new Error("This account cannot sign in.");
      }
      const sessionId = newSessionId();
      const secret = randomBytes(32).toString("base64url");
      const token = `${sessionId}.${secret}`;
      const now = new Date();
      const session: SessionRecord = {
        kind: "session",
        schemaVersion: 1,
        sessionId,
        subjectId,
        verifierDigestHex: hashHex(token),
        authVersion: subject.authVersion,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
        revokedAt: null,
      };
      await withRequestPerformanceSpan("auth.session.persist", () =>
        persistRecord(session, "session.created", { kind: "subject", subjectId }),
      );
      return { session, token };
    }),
  );
}

export async function createConsumerSession(
  subjectId: SubjectId,
  clientId: string,
  productId: string,
  sessionLifetimeMs = DEFAULT_CONSUMER_SESSION_LIFETIME_MS,
): Promise<{ session: SessionRecord; token: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clientId)) {
    throw new Error("Choose a valid application client.");
  }
  const normalizedProductId = validateProductId(productId);
  if (
    !Number.isSafeInteger(sessionLifetimeMs) ||
    sessionLifetimeMs < MIN_CONSUMER_SESSION_LIFETIME_MS
  ) {
    throw new Error("Choose a valid consumer session lifetime.");
  }
  const effectiveLifetimeMs = effectiveConsumerSessionLifetimeMs(sessionLifetimeMs);
  return withRequestPerformanceSpan("auth.consumer-session.create", () =>
    authMutationQueue.run(async () => {
      const subject = await withRequestPerformanceSpan("auth.consumer-session.subject-lookup", () =>
        loadSubjectUnlocked(subjectId),
      );
      requireVerifiedActiveSubject(subject, normalizedProductId);
      if (
        !(await hasActiveConsumerProductEntitlement(
          subjectId,
          normalizedProductId,
          clientId,
          subject,
        ))
      ) {
        if (consumerProductState(subject, normalizedProductId).status !== "active") {
          throw new Error("This account is disabled for the application.");
        }
        throw new ConsumerProductAccessDeniedError();
      }
      return createConsumerSessionUnlocked(
        subject,
        clientId,
        normalizedProductId,
        effectiveLifetimeMs,
      );
    }),
  );
}

async function createConsumerSessionUnlocked(
  subject: SubjectRecord,
  clientId: string,
  productId: string,
  sessionLifetimeMs: number,
): Promise<{ session: SessionRecord; token: string }> {
  const subjectId = subject.subjectId;
  requireVerifiedActiveSubject(subject, productId);
  const productState = consumerProductState(subject, productId);
  const sessionId = newSessionId();
  const token = `${sessionId}.${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const session: SessionRecord = {
    kind: "session",
    schemaVersion: 1,
    sessionId,
    subjectId,
    verifierDigestHex: hashHex(token),
    authVersion: subject.authVersion,
    applicationClientId: clientId,
    productId,
    productSessionVersion: productState.sessionVersion,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
    revokedAt: null,
  };
  await withRequestPerformanceSpan("auth.consumer-session.persist", () =>
    persistRecord(session, "session.consumer-created", {
      kind: "subject",
      subjectId,
    }),
  );
  return { session, token };
}

export class InvalidConsumerAuthorizationCodeError extends Error {
  constructor() {
    super("The authorization code is invalid, expired, or already used.");
    this.name = "InvalidConsumerAuthorizationCodeError";
  }
}

export class ConsumerProductAccessDeniedError extends Error {
  constructor(message = "This account is not authorized to use the application.") {
    super(message);
    this.name = "ConsumerProductAccessDeniedError";
  }
}

export async function createConsumerAuthorizationCode(
  subjectId: SubjectId,
  clientId: string,
  codeChallenge: string,
  nonce: string | null,
  redirectUri: string,
  scope: string | null,
): Promise<string> {
  assertOpaqueId(clientId);
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    !(
      (nonce === null && scope === null) ||
      (typeof nonce === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(nonce) &&
        scope === "openid profile email perminister_api")
    ) ||
    redirectUri.length > 2048
  ) {
    throw new Error("Choose a valid OpenID Connect authorization request.");
  }
  return authMutationQueue.run(async () => {
    const client = await withRequestPerformanceSpan("auth.oidc.client-lookup", () =>
      loadRecord("consumer-client", clientId),
    );
    if (!client || client.record.status !== "active" || !client.record.appOrigin) {
      throw new Error("Choose an active application client with an app origin.");
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
      consumerClientId: client.record.consumerClientId,
      subjectId,
      authVersion: subject.authVersion,
      productSessionVersion: productState.sessionVersion,
      codeDigestHex: hashHex(code),
      codeChallenge,
      nonce,
      redirectUri,
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
  clientId: string,
  codeVerifier: string,
  redirectUri?: string,
): Promise<{
  session: SessionRecord;
  token: string;
  subject: SubjectRecord;
  productId: string;
  nonce: string | null;
  scope: string | null;
}> {
  assertOpaqueId(clientId);
  if (code.length > 128 || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    throw new InvalidConsumerAuthorizationCodeError();
  }
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(code);
  if (!match) throw new InvalidConsumerAuthorizationCodeError();
  const codeChallenge = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return authMutationQueue.run(async () => {
    const [authorization, client] = await withRequestPerformanceSpan(
      "auth.oidc.exchange-record-lookup",
      () =>
        Promise.all([
          loadRecord("consumer-authorization-code", match[1]),
          loadRecord("consumer-client", clientId),
        ]),
    );
    if (
      !authorization ||
      !client ||
      client.record.status !== "active" ||
      authorization.record.consumerClientId !== clientId ||
      (authorization.record.redirectUri &&
        redirectUri &&
        authorization.record.redirectUri !== redirectUri) ||
      ((authorization.record.scope || authorization.record.nonce) &&
        (!redirectUri ||
          !authorization.record.scope ||
          !authorization.record.nonce ||
          authorization.record.redirectUri !== redirectUri)) ||
      authorization.record.consumedAt ||
      Date.parse(authorization.record.expiresAt) <= Date.now() ||
      !equalHex(authorization.record.codeDigestHex, hashHex(code))
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
    const productStateSubject = await withRequestPerformanceSpan(
      "auth.oidc.exchange-subject-lookup",
      () => loadSubjectUnlocked(authorization.record.subjectId),
    );
    const productState = productStateSubject
      ? consumerProductState(productStateSubject, client.record.productId)
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
        client.record.productId,
        client.record.consumerClientId,
        productStateSubject,
      ))
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const consumedAt = new Date().toISOString();
    await withRequestPerformanceSpan("auth.oidc.code-consume.persist", () =>
      persistRecord(
        { ...authorization.record, consumedAt },
        "consumer-authorization-code.consumed",
        { kind: "subject", subjectId: authorization.record.subjectId },
      ),
    );
    const created = await createConsumerSessionUnlocked(
      productStateSubject,
      client.record.consumerClientId,
      client.record.productId,
      effectiveConsumerSessionLifetimeMs(client.record.sessionLifetimeMs),
    );
    return {
      ...created,
      subject: productStateSubject,
      productId: client.record.productId,
      nonce: authorization.record.nonce,
      scope: authorization.record.scope,
    };
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_LIFETIME_MS / 1000,
    priority: "high" as const,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export interface AuthenticatedSession {
  session: SessionRecord;
  subject: SubjectRecord;
}

export async function getSessionFromToken(
  token: string | null | undefined,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
  if (!match) return null;
  try {
    assertOpaqueId(match[1]);
  } catch {
    return null;
  }
  return withRequestPerformanceSpan("auth.session.validate", () =>
    authMutationQueue.read(async () => {
      const sessionId = match[1] as SessionId;
      const knownSubjectId = sessionSubjectCache.get(sessionId);
      const [session, knownSubject] = await Promise.all([
        loadRecord("session", sessionId),
        knownSubjectId ? loadRecord("subject", knownSubjectId) : Promise.resolve(null),
      ]);
      if (!session) return null;
      const record = session.record;
      if (
        record.revokedAt ||
        hasSessionExpired(record, Date.now()) ||
        !equalHex(record.verifierDigestHex, hashHex(token))
      )
        return null;
      const subject =
        knownSubjectId === record.subjectId
          ? knownSubject
          : await loadRecord("subject", record.subjectId);
      if (
        !subject ||
        subject.record.status !== "active" ||
        subject.record.authVersion !== record.authVersion ||
        (!!record.productId &&
          (consumerProductState(subject.record, record.productId).sessionVersion !==
            (record.productSessionVersion ?? 1) ||
            !(await hasActiveConsumerProductEntitlement(
              record.subjectId,
              record.productId,
              record.applicationClientId,
              subject.record,
            ))))
      )
        return null;
      rememberSessionSubject(sessionId, record.subjectId);
      return { session: record, subject: subject.record };
    }),
  );
}

export const getCurrentSession = cache(
  async function getCurrentSession(): Promise<AuthenticatedSession | null> {
    const cookieStore = await cookies();
    const current = await getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
    return current?.session.applicationClientId ? null : current;
  },
);

export async function getConsumerSessionFromToken(
  token: string | null | undefined,
  clientId: string,
): Promise<AuthenticatedSession | null> {
  const current = await getSessionFromToken(token);
  if (!current || current.session.applicationClientId !== clientId || !current.session.productId) {
    return null;
  }
  return current;
}

export async function revokeConsumerSession(
  token: string | null | undefined,
  clientId: string,
): Promise<void> {
  const current = await getConsumerSessionFromToken(token, clientId);
  if (current) await revokeSession(current.session.sessionId, current.subject.subjectId);
}

export async function revokeSession(sessionId: string, actorSubjectId: SubjectId): Promise<void> {
  assertOpaqueId(sessionId);
  await authMutationQueue.run(async () => {
    const current = await loadRecord("session", sessionId);
    if (!current || current.record.subjectId !== actorSubjectId) return;
    if (current.record.revokedAt) return;
    const next: SessionRecord = { ...current.record, revokedAt: new Date().toISOString() };
    await persistRecord(next, "session.revoked", { kind: "subject", subjectId: actorSubjectId });
  });
}

export async function signOutCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  try {
    const current = await getSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
    if (current) await revokeSession(current.session.sessionId, current.subject.subjectId);
  } finally {
    cookieStore.delete(SESSION_COOKIE);
  }
}

export async function issueEmailAction(
  subjectId: SubjectId,
  purpose: EmailActionRecord["purpose"],
): Promise<{ email: string; token: string } | null> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active" || !subject.primaryEmail) return null;
    if (purpose === "verify-email" && subject.emailVerifiedAt) return null;
    const actionId = newEmailActionId();
    const secret = randomBytes(32).toString("base64url");
    const token = `${actionId}.${secret}`;
    const now = new Date();
    const record: EmailActionRecord = {
      kind: "email-action",
      schemaVersion: 1,
      actionId,
      subjectId,
      purpose,
      verifierDigestHex: hashHex(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EMAIL_ACTION_LIFETIME_MS).toISOString(),
      consumedAt: null,
    };
    await persistRecord(record, `email.${purpose}.issued`, { kind: "subject", subjectId });
    return { email: subject.primaryEmail, token };
  });
}

export async function issueRecoveryAction(
  emailInput: string,
): Promise<{ email: string; token: string } | null> {
  const email = canonicalEmail(emailInput);
  const subject = await authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
  if (!subject) return null;
  return issueEmailAction(subject.subjectId, "recover-password");
}

export async function completeEmailAction(
  token: string,
  purpose: EmailActionRecord["purpose"],
  newPassword?: string,
): Promise<void> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
  if (!match) throw new InvalidAuthActionError();
  let passwordCredential: PasswordCredential | undefined;
  if (purpose === "recover-password") {
    if (!newPassword) throw new Error("Enter a new password.");
    passwordCredential = await createPasswordCredential(newPassword);
  }
  await authMutationQueue.run(async () => {
    const currentAction = await loadRecord("email-action", match[1] as EmailActionId);
    if (
      !currentAction ||
      currentAction.record.purpose !== purpose ||
      currentAction.record.consumedAt ||
      Date.parse(currentAction.record.expiresAt) <= Date.now() ||
      !equalHex(currentAction.record.verifierDigestHex, hashHex(token))
    )
      throw new InvalidAuthActionError();
    const currentSubject = await loadRecord("subject", currentAction.record.subjectId);
    if (!currentSubject || currentSubject.record.status !== "active")
      throw new InvalidAuthActionError();
    const subject = currentSubject.record;
    let nextSubject = subject;
    if (purpose === "verify-email") {
      if (!subject.emailVerifiedAt) {
        nextSubject = {
          ...subject,
          emailVerifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      nextSubject = {
        ...subject,
        passwordCredential: passwordCredential!,
        emailVerifiedAt: subject.emailVerifiedAt ?? new Date().toISOString(),
        authVersion: subject.authVersion + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    await persistRecord(
      { ...currentAction.record, consumedAt: new Date().toISOString() },
      `email.${purpose}.consumed`,
      { kind: "subject", subjectId: subject.subjectId },
    );
    if (nextSubject !== subject) {
      await persistRecord(
        nextSubject,
        purpose === "verify-email" ? "identity.email-verified" : "credential.password-reset",
        { kind: "subject", subjectId: subject.subjectId },
      );
    }
  });
}

export async function listSessionsForSubject(subjectId: SubjectId): Promise<SessionRecord[]> {
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject) return [];
    return listSessionsForSubjectUnlocked(subject);
  });
}

export async function listSessionsForSubjectUnlocked(
  subject: SubjectRecord,
): Promise<SessionRecord[]> {
  return (await listRecordsWithRecovery("session"))
    .map((item) => item.record)
    .filter(
      (record) =>
        record.subjectId === subject.subjectId &&
        record.authVersion === subject.authVersion &&
        (!record.productId ||
          (consumerProductState(subject, record.productId).status === "active" &&
            consumerProductState(subject, record.productId).sessionVersion ===
              (record.productSessionVersion ?? 1))) &&
        !record.revokedAt &&
        Date.parse(record.expiresAt) > Date.now(),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getSubjectById(subjectId: string): Promise<SubjectRecord | null> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() => loadSubjectUnlocked(subjectId));
}

export async function findAccountByEmail(emailInput: string): Promise<SubjectRecord | null> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
}
