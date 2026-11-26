import "server-only";

import { randomBytes } from "node:crypto";
import {
  assertOpaqueId,
  type EmailActionId,
  type EmailActionRecord,
  type ExternalIdentity,
  newEmailActionId,
  newSubjectId,
  type PasswordCredential,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { processLocalLoginThrottle } from "../login-throttle";
import { authMutationQueue } from "../mutation-queue";
import { withRequestPerformanceSpan } from "../performance";
import { rehashAfterLogin } from "./core";
import { createPasswordCredential, equalHex, hashHex, verifyPassword } from "./passwords";
import {
  loadRecord,
  loadSubjectByEmailUnlocked,
  loadSubjectByExternalIdentityUnlocked,
  loadSubjectByUsernameUnlocked,
  loadSubjectUnlocked,
  persistRecord,
} from "./persistence";
import {
  canonicalEmail,
  consumerProductState,
  InvalidAuthActionError,
  normalizedPersonName,
  normalizeProductUsername,
} from "./validators";

const EMAIL_ACTION_LIFETIME_MS = 30 * 60 * 1000;

export class GoogleAccountLinkRequiredError extends Error {
  constructor() {
    super("Sign in with the existing Perminister account before linking Google.");
    this.name = "GoogleAccountLinkRequiredError";
  }
}

export class FederatedAccountLinkRequiredError extends Error {
  constructor() {
    super("Sign in with the existing Perminister account before linking this identity provider.");
    this.name = "FederatedAccountLinkRequiredError";
  }
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

export async function signInWithGoogle(input: {
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}): Promise<SubjectRecord> {
  try {
    return await signInWithExternalIdentity({ ...input, provider: "google" });
  } catch (error) {
    if (error instanceof FederatedAccountLinkRequiredError) {
      throw new GoogleAccountLinkRequiredError();
    }
    throw error;
  }
}

export async function signInWithExternalIdentity(input: {
  provider: string;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}): Promise<SubjectRecord> {
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(input.provider) ||
    typeof input.providerSubject !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(input.providerSubject) ||
    input.emailVerified !== true
  ) {
    throw new Error("The identity provider did not return a verified account.");
  }

  const email = canonicalEmail(input.email);
  const identity: ExternalIdentity = { provider: input.provider, subject: input.providerSubject };
  const firstName = normalizedPersonName(input.firstName?.slice(0, 80), "First");
  const lastName = normalizedPersonName(input.lastName?.slice(0, 80), "Last");

  return authMutationQueue.run(async () => {
    const linkedSubject = await loadSubjectByExternalIdentityUnlocked(
      input.provider,
      identity.subject,
    );
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
        throw new FederatedAccountLinkRequiredError();
      }
      if (existingSubject.externalIdentities?.some(({ provider }) => provider === input.provider)) {
        throw new FederatedAccountLinkRequiredError();
      }

      const now = new Date().toISOString();
      const linked: SubjectRecord = {
        ...existingSubject,
        emailVerifiedAt: existingSubject.emailVerifiedAt ?? now,
        externalIdentities: [...(existingSubject.externalIdentities ?? []), identity],
        updatedAt: now,
      };
      await persistRecord(linked, `identity.${input.provider}-linked`, {
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
    await persistRecord(subject, `identity.${input.provider}-registered`, {
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
  options: { minimumLength?: number } = {},
): Promise<void> {
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subjectId);
    if (!current || current.status !== "active")
      throw new Error("This account cannot change its password.");
    if (!(await verifyPassword(currentPassword, current.passwordCredential))) {
      throw new Error("Current password is incorrect.");
    }
    if (currentPassword === newPassword) {
      throw new Error("Choose a different password from your current one.");
    }
    const passwordCredential = await createPasswordCredential(
      newPassword,
      options.minimumLength ?? 15,
    );
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
  options: { minimumLength?: number; markEmailVerified?: boolean } = {},
): Promise<void> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
  if (!match) throw new InvalidAuthActionError();
  let passwordCredential: PasswordCredential | undefined;
  if (purpose === "recover-password") {
    if (!newPassword) throw new Error("Enter a new password.");
    passwordCredential = await createPasswordCredential(
      newPassword,
      options.minimumLength ?? 15,
    );
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
        emailVerifiedAt:
          options.markEmailVerified === false
            ? subject.emailVerifiedAt
            : subject.emailVerifiedAt ?? new Date().toISOString(),
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

export async function getSubjectById(subjectId: string): Promise<SubjectRecord | null> {
  assertOpaqueId(subjectId);
  return authMutationQueue.run(() => loadSubjectUnlocked(subjectId));
}

export async function findAccountByEmail(emailInput: string): Promise<SubjectRecord | null> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() => loadSubjectByEmailUnlocked(email));
}
