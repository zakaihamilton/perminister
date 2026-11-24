import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  assertOpaqueId,
  effectiveConsumerSessionLifetimeMs,
  MAX_CONSUMER_SESSION_LIFETIME_MS,
  MIN_CONSUMER_SESSION_LIFETIME_MS,
  newSessionId,
  type SessionId,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { withRequestPerformanceSpan } from "../performance";
import { hasActiveConsumerProductEntitlement } from "./core";
import { rememberSessionSubject, sessionSubjectCache } from "./dashboard-cache";
import { equalHex, hashHex } from "./passwords";
import {
  listRecordsWithRecovery,
  loadRecord,
  loadSubjectUnlocked,
  persistRecord,
} from "./persistence";
import {
  ConsumerProductAccessDeniedError,
  consumerProductState,
  requireVerifiedActiveSubject,
  validateProductId,
} from "./validators";

const SESSION_COOKIE = "perminister_session";
const SESSION_LIFETIME_MS = MAX_CONSUMER_SESSION_LIFETIME_MS;

export interface AuthenticatedSession {
  session: SessionRecord;
  subject: SubjectRecord;
}

function hasSessionExpired(record: SessionRecord, now: number): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return true;
  if (!record.applicationClientId && !record.productId) return false;

  const createdAt = Date.parse(record.createdAt);
  return !Number.isFinite(createdAt) || createdAt + MAX_CONSUMER_SESSION_LIFETIME_MS <= now;
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
  sessionLifetimeMs = MAX_CONSUMER_SESSION_LIFETIME_MS,
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

export async function createConsumerSessionUnlocked(
  subject: SubjectRecord,
  clientId: string,
  productId: string,
  sessionLifetimeMs: number,
  oauthBinding?: {
    oauthClientId?: string;
    resource: string;
    scopes: readonly string[];
    scope: string;
  },
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
    ...(oauthBinding?.oauthClientId ? { oauthClientId: oauthBinding.oauthClientId } : {}),
    productId,
    productSessionVersion: productState.sessionVersion,
    ...(oauthBinding
      ? {
          resource: oauthBinding.resource,
          oauthScopes: [...oauthBinding.scopes],
          oauthGrantScope: oauthBinding.scope,
        }
      : {}),
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
      if (record.oauthClientId) {
        const registeredClient = await loadRecord("oauth-client-registration", record.oauthClientId);
        if (!registeredClient || registeredClient.record.status !== "active") return null;
      }
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
