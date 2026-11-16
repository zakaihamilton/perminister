import "server-only";

import { authMutationQueue } from "../mutation-queue";
import { newSubjectId, type SubjectRecord } from "../domain";
import {
  canonicalEmail,
  loadSubjectByEmailUnlocked,
  loadSubjectByUsernameUnlocked,
  normalizeProductUsername,
  persistRecord,
} from "./core";

export interface SystemConceptsLegacyIdentity {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  passwordHash: string;
}

export interface SystemConceptsImportConflict {
  id: string;
  reason: string;
}

export interface SystemConceptsImportSummary {
  total: number;
  imported: number;
  linked: number;
  skipped: number;
  applied: boolean;
  conflicts: SystemConceptsImportConflict[];
}

const PRODUCT_ID = "system-concepts";
const SOURCE_ID = "systemconcepts";
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(?:0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}$/;

function importedName(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function validSystemConceptsId(value: string): boolean {
  return /^[a-z0-9_-]{1,254}$/i.test(value);
}

/** Import bcrypt verifiers; matching Perminister accounts retain their existing credentials. */
export async function importSystemConceptsLegacyIdentities(
  identities: readonly SystemConceptsLegacyIdentity[],
  apply: boolean,
): Promise<SystemConceptsImportSummary> {
  const summary: SystemConceptsImportSummary = {
    total: identities.length,
    imported: 0,
    linked: 0,
    skipped: 0,
    applied: false,
    conflicts: [],
  };

  await authMutationQueue.run(async () => {
    const seenIds = new Set<string>();
    const linkedSubjectIds = new Map<string, string>();
    const seenEmails = new Map<string, string>();
    const pendingWrites: Array<{
      record: SubjectRecord;
      type: string;
      payload: { productId: string; sourceId: string };
    }> = [];

    for (const identity of identities) {
      const sourceId = typeof identity.id === "string" ? identity.id.trim().toLowerCase() : "";
      const conflict = (reason: string) =>
        summary.conflicts.push({ id: sourceId || "(missing)", reason });
      if (!validSystemConceptsId(sourceId)) {
        conflict("invalid System Concepts ID (max 254 characters; letters, numbers, underscore, or hyphen)");
        continue;
      }
      if (seenIds.has(sourceId)) {
        conflict("duplicate ID in the import file");
        continue;
      }
      seenIds.add(sourceId);
      if (typeof identity.passwordHash !== "string" || !BCRYPT_HASH_PATTERN.test(identity.passwordHash)) {
        conflict("missing or unsupported bcrypt password verifier");
        continue;
      }

      let email: string | null = null;
      if (typeof identity.email === "string" && identity.email.trim()) {
        try {
          email = canonicalEmail(identity.email);
        } catch {
          conflict("invalid email address");
          continue;
        }
      }
      if (email && seenEmails.has(email)) {
        conflict(`email is also assigned to ${seenEmails.get(email)}`);
        continue;
      }
      if (email) seenEmails.set(email, sourceId);

      let username: string;
      try {
        username = normalizeProductUsername(sourceId, PRODUCT_ID);
      } catch {
        conflict("invalid System Concepts ID");
        continue;
      }
      const [emailSubject, usernameSubject] = await Promise.all([
        email ? loadSubjectByEmailUnlocked(email) : Promise.resolve(null),
        loadSubjectByUsernameUnlocked(PRODUCT_ID, username),
      ]);
      if (emailSubject && usernameSubject && emailSubject.subjectId !== usernameSubject.subjectId) {
        conflict("email and System Concepts ID already belong to different Perminister accounts");
        continue;
      }

      const subject = emailSubject ?? usernameSubject;
      if (subject) {
        const priorSource = subject.legacySources?.find((source) => source.source === SOURCE_ID);
        if (priorSource && priorSource.accountId !== sourceId) {
          conflict("Perminister account is already linked to a different System Concepts ID");
          continue;
        }
        if (usernameSubject && email && subject.primaryEmail && subject.primaryEmail !== email) {
          conflict("System Concepts ID is already linked to a Perminister account with a different email");
          continue;
        }
        const linkedToThisBatch = linkedSubjectIds.get(subject.subjectId);
        if (linkedToThisBatch && linkedToThisBatch !== sourceId) {
          conflict(`Perminister account is also linked to ${linkedToThisBatch} in this import`);
          continue;
        }
        linkedSubjectIds.set(subject.subjectId, sourceId);

        const existingIdentifier = subject.loginIdentifiers?.find(
          (identifier) =>
            identifier.kind === "username" &&
            identifier.productId === PRODUCT_ID &&
            identifier.normalizedValue === username,
        );
        if (
          subject.loginIdentifiers?.some(
            (identifier) => identifier.kind === "username" && identifier.productId === PRODUCT_ID,
          ) && !existingIdentifier
        ) {
          conflict("Perminister account already has a different System Concepts ID");
          continue;
        }
        if (
          subject.legacySources?.some(
            (source) => source.source === SOURCE_ID && source.accountId === sourceId,
          ) && existingIdentifier
        ) {
          summary.skipped += 1;
          continue;
        }

        const now = new Date().toISOString();
        const next: SubjectRecord = {
          ...subject,
          ...(email && !subject.primaryEmail ? { primaryEmail: email } : {}),
          firstName: subject.firstName ?? importedName(identity.firstName),
          lastName: subject.lastName ?? importedName(identity.lastName),
          loginIdentifiers: existingIdentifier
            ? subject.loginIdentifiers
            : [
                ...(subject.loginIdentifiers ?? []),
                {
                  kind: "username",
                  productId: PRODUCT_ID,
                  value: username,
                  normalizedValue: username,
                },
              ],
          legacySources: priorSource
            ? subject.legacySources
            : [...(subject.legacySources ?? []), { source: SOURCE_ID, accountId: sourceId }],
          updatedAt: now,
        };
        pendingWrites.push({
          record: next,
          type: "identity.systemconcepts-linked",
          payload: { productId: PRODUCT_ID, sourceId },
        });
        summary.linked += 1;
        continue;
      }

      const now = new Date().toISOString();
      const created: SubjectRecord = {
        kind: "subject",
        schemaVersion: 1,
        subjectId: newSubjectId(),
        status: "active",
        firstName: importedName(identity.firstName),
        lastName: importedName(identity.lastName),
        primaryEmail: email,
        emailVerifiedAt: null,
        loginIdentifiers: [
          {
            kind: "username",
            productId: PRODUCT_ID,
            value: username,
            normalizedValue: username,
          },
        ],
        legacySources: [{ source: SOURCE_ID, accountId: sourceId }],
        legacyCredentialSource: SOURCE_ID,
        passwordCredential: {
          algorithm: "bcrypt",
          format: "legacy-bcrypt-v1",
          encodedVerifier: identity.passwordHash,
          updatedAt: now,
        },
        authVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      linkedSubjectIds.set(created.subjectId, sourceId);
      pendingWrites.push({
        record: created,
        type: "identity.systemconcepts-imported",
        payload: { productId: PRODUCT_ID, sourceId },
      });
      summary.imported += 1;
    }

    if (apply && summary.conflicts.length === 0) {
      for (const write of pendingWrites) {
        await persistRecord(write.record, write.type, { kind: "system" }, write.payload);
      }
      summary.applied = true;
    }
  });

  return summary;
}
