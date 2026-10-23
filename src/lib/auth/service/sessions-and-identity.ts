import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { authMutationQueue } from "../mutation-queue";
import { processLocalLoginThrottle } from "../login-throttle";
import {
  assertOpaqueId,
  newConsumerAuthorizationCodeId,
  newEmailActionId,
  newSessionId,
  newSubjectId,
  type ConsumerAuthorizationCodeRecord,
  type EmailActionId,
  type EmailActionRecord,
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
  hashHex,
  listRecordsWithRecovery,
  loadRecord,
  loadSubjectByEmailUnlocked,
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
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const EMAIL_ACTION_LIFETIME_MS = 30 * 60 * 1000;

export async function registerAccount(
  emailInput: string,
  password: string,
  profile: { firstName?: string; lastName?: string } = {},
): Promise<SubjectRecord> {
  const email = canonicalEmail(emailInput);
  const firstName = normalizedPersonName(profile.firstName, "First");
  const lastName = normalizedPersonName(profile.lastName, "Last");
  const passwordCredential = await createPasswordCredential(password);
  return authMutationQueue.run(async () => {
    if (await loadSubjectByEmailUnlocked(email)) {
      throw new Error("An account with this email address already exists.");
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
      loginIdentifiers: [],
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
    ? normalizeProductUsername(identifierInput)
    : canonicalEmail(identifierInput);
  const attempt = processLocalLoginThrottle.beginAttempt(
    productId ? `${productId}:${identifier}` : identifier,
  );
  try {
    const subject = await authMutationQueue.run(async () => {
      if (!productId) return loadSubjectByEmailUnlocked(identifier);
      const emailSubject = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        ? await loadSubjectByEmailUnlocked(identifier)
        : null;
      const usernameSubject = await loadSubjectByUsernameUnlocked(productId, identifier);
      if (emailSubject && usernameSubject && emailSubject.subjectId !== usernameSubject.subjectId) {
        return null;
      }
      return emailSubject ?? usernameSubject;
    });
    const matched = await verifyPassword(password, subject?.passwordCredential ?? null);
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
    await rehashAfterLogin(subject, password);
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
  return authMutationQueue.run(async () => {
    const subject = await loadSubjectUnlocked(subjectId);
    if (!subject || subject.status !== "active") throw new Error("This account cannot sign in.");
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
    await persistRecord(session, "session.created", { kind: "subject", subjectId });
    return { session, token };
  });
}

export async function createConsumerSession(
  subjectId: SubjectId,
  clientId: string,
  productId: string,
  sessionLifetimeMs = SESSION_LIFETIME_MS,
): Promise<{ session: SessionRecord; token: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clientId)) {
    throw new Error("Choose a valid application client.");
  }
  const normalizedProductId = validateProductId(productId);
  if (
    !Number.isSafeInteger(sessionLifetimeMs) ||
    sessionLifetimeMs < 5 * 60 * 1000 ||
    sessionLifetimeMs > 90 * 24 * 60 * 60 * 1000
  ) {
    throw new Error("Choose a valid consumer session lifetime.");
  }
  return authMutationQueue.run(() =>
    createConsumerSessionUnlocked(subjectId, clientId, normalizedProductId, sessionLifetimeMs),
  );
}

async function createConsumerSessionUnlocked(
  subjectId: SubjectId,
  clientId: string,
  productId: string,
  sessionLifetimeMs: number,
): Promise<{ session: SessionRecord; token: string }> {
  const subject = await loadSubjectUnlocked(subjectId);
  requireVerifiedActiveSubject(subject);
  const productState = consumerProductState(subject, productId);
  if (productState.status !== "active") {
    throw new Error("This account is disabled for the application.");
  }
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
  await persistRecord(session, "session.consumer-created", {
    kind: "subject",
    subjectId,
  });
  return { session, token };
}

export class InvalidConsumerAuthorizationCodeError extends Error {
  constructor() {
    super("The authorization code is invalid, expired, or already used.");
    this.name = "InvalidConsumerAuthorizationCodeError";
  }
}

export async function createConsumerAuthorizationCode(
  subjectId: SubjectId,
  clientId: string,
  codeChallenge: string,
): Promise<string> {
  assertOpaqueId(clientId);
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new Error("Choose a valid PKCE challenge.");
  }
  return authMutationQueue.run(async () => {
    const client = await loadRecord("consumer-client", clientId);
    if (!client || client.record.status !== "active" || !client.record.appOrigin) {
      throw new Error("Choose an active application client with an app origin.");
    }
    const subject = await loadSubjectUnlocked(subjectId);
    requireVerifiedActiveSubject(subject);
    const productState = consumerProductState(subject, client.record.productId);
    if (productState.status !== "active") {
      throw new Error("This account is disabled for the application.");
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
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      consumedAt: null,
    };
    await persistRecord(record, "consumer-authorization-code.issued", {
      kind: "subject",
      subjectId,
    });
    return code;
  });
}

export async function exchangeConsumerAuthorizationCode(
  code: string,
  clientId: string,
  codeVerifier: string,
): Promise<{ session: SessionRecord; token: string; subject: SubjectRecord; productId: string }> {
  assertOpaqueId(clientId);
  if (code.length > 128 || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    throw new InvalidConsumerAuthorizationCodeError();
  }
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(code);
  if (!match) throw new InvalidConsumerAuthorizationCodeError();
  const codeChallenge = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return authMutationQueue.run(async () => {
    const [authorization, client] = await Promise.all([
      loadRecord("consumer-authorization-code", match[1]),
      loadRecord("consumer-client", clientId),
    ]);
    if (
      !authorization ||
      !client ||
      client.record.status !== "active" ||
      authorization.record.consumerClientId !== clientId ||
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
    const productStateSubject = await loadSubjectUnlocked(authorization.record.subjectId);
    const productState = productStateSubject
      ? consumerProductState(productStateSubject, client.record.productId)
      : null;
    if (
      !productStateSubject ||
      productStateSubject.status !== "active" ||
      productStateSubject.authVersion !== authorization.record.authVersion ||
      productState?.status !== "active" ||
      productState.sessionVersion !== authorization.record.productSessionVersion
    ) {
      throw new InvalidConsumerAuthorizationCodeError();
    }
    const consumedAt = new Date().toISOString();
    await persistRecord(
      { ...authorization.record, consumedAt },
      "consumer-authorization-code.consumed",
      { kind: "subject", subjectId: authorization.record.subjectId },
    );
    const created = await createConsumerSessionUnlocked(
      authorization.record.subjectId,
      client.record.consumerClientId,
      client.record.productId,
      client.record.sessionLifetimeMs,
    );
    return {
      ...created,
      subject: productStateSubject,
      productId: client.record.productId,
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
  return authMutationQueue.read(async () => {
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
      Date.parse(record.expiresAt) <= Date.now() ||
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
        (consumerProductState(subject.record, record.productId).status !== "active" ||
          consumerProductState(subject.record, record.productId).sessionVersion !==
            (record.productSessionVersion ?? 1)))
    )
      return null;
    rememberSessionSubject(sessionId, record.subjectId);
    return { session: record, subject: subject.record };
  });
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
