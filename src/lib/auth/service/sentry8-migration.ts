import "server-only";

import { consumerRoleActions } from "../consumer-policy";
import {
  type MembershipRecord,
  newMembershipId,
  newOrganizationMembershipId,
  newSubjectId,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type PasswordCredential,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { createRoleMembershipRecord } from "./membership-record";
import { loadApprovedOrganizationUnlocked, loadRecord, loadSubjectByEmailUnlocked, loadSubjectUnlocked, persistRecord, store } from "./persistence";
import { canonicalEmail, validateProductId, validateScope } from "./validators";

export interface Sentry8LegacyMembership {
  sentry8UserId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  organizationId: string | null;
  productId: string | null;
  resourceId: string | null;
  resourceUri: string | null;
  email: string;
  displayName: string;
  passwordHash: string | null;
  perministerSubjectId: string | null;
  role: "viewer" | "manager" | "administrator";
  status: "active" | "locked";
  perministerRole: "viewer" | "editor" | "admin";
}

export interface Sentry8ImportConflict {
  userId: string;
  reason: string;
}

export interface Sentry8ImportSummary {
  total: number;
  created: number;
  linked: number;
  memberships: number;
  applied: boolean;
  conflicts: Sentry8ImportConflict[];
  subjectMappings: Array<{ sentry8UserId: string; subjectId: string }>;
}

const PRODUCT_ID = "sentry8";
const SOURCE_ID = "sentry8";
const ARGON2ID_PATTERN = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

type IdentityGroup = {
  email: string;
  passwordHash: string | null;
  perministerSubjectId: string | null;
  rows: Sentry8LegacyMembership[];
};

function expectedPerministerRole(
  role: Sentry8LegacyMembership["role"],
): Sentry8LegacyMembership["perministerRole"] {
  return role === "viewer" ? "viewer" : role === "manager" ? "editor" : "admin";
}

function importedName(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 80) : undefined;
}

function importedCredential(passwordHash: string): PasswordCredential {
  return {
    algorithm: "argon2id",
    format: "argon2id-phc",
    encodedVerifier: passwordHash,
    updatedAt: new Date().toISOString(),
  };
}

function sourceForEmail(email: string) {
  return { source: SOURCE_ID, accountId: email };
}

function hasSource(subject: SubjectRecord, email: string): boolean {
  return subject.legacySources?.some(
    (source) => source.source === SOURCE_ID && source.accountId === email,
  ) === true;
}

function roleGrant(
  subjectId: SubjectId,
  row: Sentry8LegacyMembership,
  existing?: MembershipRecord,
): MembershipRecord {
  const organizationId = row.organizationId as OrganizationId;
  const scope = validateScope({
    kind: "project",
    organizationId,
    productId: PRODUCT_ID,
    projectId: row.resourceId!,
  });
  const role = expectedPerministerRole(row.role);
  const actions = consumerRoleActions(PRODUCT_ID, role, "project");
  if (!actions) throw new Error("Unsupported Sentry8 access role.");
  return createRoleMembershipRecord(
    PRODUCT_ID,
    subjectId,
    scope,
    role,
    actions,
    existing,
    row.status === "active" ? "active" : "disabled",
  );
}

/** Imports encrypted-manifest identities and project grants after endpoint decryption. */
export async function importSentry8LegacyMemberships(
  memberships: readonly Sentry8LegacyMembership[],
  apply: boolean,
): Promise<Sentry8ImportSummary> {
  const summary: Sentry8ImportSummary = {
    total: memberships.length,
    created: 0,
    linked: 0,
    memberships: 0,
    applied: false,
    conflicts: [],
    subjectMappings: [],
  };

  await authMutationQueue.run(async () => {
    const conflict = (userId: string, reason: string) =>
      summary.conflicts.push({ userId, reason });
    const groups = new Map<string, IdentityGroup>();
    const projectOwners = new Map<string, string>();
    const subjectOwners = new Map<string, string>();

    for (const row of memberships) {
      let email: string;
      try {
        email = canonicalEmail(row.email);
        validateProductId(row.productId ?? "");
      } catch {
        conflict(row.sentry8UserId || "(missing)", "invalid email or product ID");
        continue;
      }
      if (
        !row.sentry8UserId ||
        !row.projectSlug ||
        !row.projectId ||
        !row.organizationId ||
        !row.resourceId ||
        !row.resourceUri ||
        row.productId?.trim().toLowerCase() !== PRODUCT_ID ||
        !["viewer", "manager", "administrator"].includes(row.role) ||
        !["active", "locked"].includes(row.status) ||
        row.perministerRole !== expectedPerministerRole(row.role)
      ) {
        conflict(row.sentry8UserId || "(missing)", "incomplete project binding or role");
        continue;
      }
      try {
        validateScope({
          kind: "project",
          organizationId: row.organizationId as OrganizationId,
          productId: PRODUCT_ID,
          projectId: row.resourceId,
        });
      } catch {
        conflict(row.sentry8UserId, "invalid project binding");
        continue;
      }
      if (
        row.passwordHash !== null &&
        !ARGON2ID_PATTERN.test(row.passwordHash)
      ) {
        conflict(row.sentry8UserId, "unsupported Argon2id verifier");
        continue;
      }
      if (row.perministerSubjectId) {
        try {
          const subjectId = row.perministerSubjectId as SubjectId;
          const loaded = await loadSubjectUnlocked(subjectId);
          if (!loaded) throw new Error("Missing subject.");
        } catch {
          conflict(row.sentry8UserId, "linked Perminister subject does not exist");
          continue;
        }
      }

      const projectEmailKey = `${row.projectId}:${email}`;
      const otherUser = projectOwners.get(projectEmailKey);
      if (otherUser && otherUser !== row.sentry8UserId) {
        conflict(row.sentry8UserId, "duplicate normalized email in one project");
        continue;
      }
      projectOwners.set(projectEmailKey, row.sentry8UserId);

      const group = groups.get(email);
      if (!group) {
        groups.set(email, {
          email,
          passwordHash: row.passwordHash,
          perministerSubjectId: row.perministerSubjectId,
          rows: [row],
        });
        continue;
      }
      if (
        group.passwordHash &&
        row.passwordHash &&
        group.passwordHash !== row.passwordHash
      ) {
        conflict(row.sentry8UserId, "same email has different password verifiers");
        continue;
      }
      if (
        group.perministerSubjectId &&
        row.perministerSubjectId &&
        group.perministerSubjectId !== row.perministerSubjectId
      ) {
        conflict(row.sentry8UserId, "same email links to different Perminister subjects");
        continue;
      }
      if (
        group.rows.some((existing) => existing.projectId === row.projectId)
      ) {
        conflict(row.sentry8UserId, "duplicate project membership");
        continue;
      }
      group.passwordHash ??= row.passwordHash;
      group.perministerSubjectId ??= row.perministerSubjectId;
      group.rows.push(row);
    }

    const plannedSubjects = new Map<string, {
      subject: SubjectRecord;
      isNew: boolean;
      changed: boolean;
    }>();
    for (const group of groups.values()) {
      const source = sourceForEmail(group.email);
      const bySubjectId = group.perministerSubjectId
        ? await loadSubjectUnlocked(group.perministerSubjectId as SubjectId)
        : null;
      const byEmail = await loadSubjectByEmailUnlocked(group.email);
      if (bySubjectId && byEmail && bySubjectId.subjectId !== byEmail.subjectId) {
        conflict(group.rows[0].sentry8UserId, "email and subject ID identify different accounts");
        continue;
      }
      const existing = bySubjectId ?? byEmail;
      if (!existing && !group.passwordHash) {
        conflict(group.rows[0].sentry8UserId, "account has no password verifier or linked subject");
        continue;
      }
      if (
        existing?.primaryEmail &&
        canonicalEmail(existing.primaryEmail) !== group.email
      ) {
        conflict(group.rows[0].sentry8UserId, "Perminister subject has a different email");
        continue;
      }
      if (existing && existing.status !== "active") {
        conflict(group.rows[0].sentry8UserId, "Perminister account is disabled");
        continue;
      }
      const existingSource = existing?.legacySources?.find(
        (item) => item.source === SOURCE_ID,
      );
      if (existingSource && existingSource.accountId !== group.email) {
        conflict(group.rows[0].sentry8UserId, "Perminister subject is linked to another Sentry8 identity");
        continue;
      }
      if (existing) {
        const otherEmail = subjectOwners.get(existing.subjectId);
        if (otherEmail && otherEmail !== group.email) {
          conflict(group.rows[0].sentry8UserId, "Perminister subject is assigned to multiple Sentry8 email identities");
          continue;
        }
        subjectOwners.set(existing.subjectId, group.email);
      }
      if (
        existing &&
        group.passwordHash &&
        existing.passwordCredential &&
        existing.passwordCredential.encodedVerifier !== group.passwordHash &&
        !hasSource(existing, group.email)
      ) {
        conflict(group.rows[0].sentry8UserId, "existing Perminister password differs; refusing to overwrite it");
        continue;
      }

      const now = new Date().toISOString();
      const createdSubject: SubjectRecord = existing
        ? {
            ...existing,
            ...(existing.primaryEmail ? {} : { primaryEmail: group.email }),
            firstName:
              existing.firstName ?? importedName(group.rows[0].displayName),
            emailVerificationExemptProducts: Array.from(
              new Set([
                ...(existing.emailVerificationExemptProducts ?? []),
                PRODUCT_ID,
              ]),
            ),
            legacySources: existingSource
              ? existing.legacySources
              : [...(existing.legacySources ?? []), source],
            ...(group.passwordHash && !existing.passwordCredential
              ? {
                  passwordCredential: importedCredential(group.passwordHash),
                  legacyCredentialSource: SOURCE_ID,
                }
              : {}),
            updatedAt: now,
          }
        : {
            kind: "subject",
            schemaVersion: 1,
            subjectId: newSubjectId(),
            status: "active",
            firstName: importedName(group.rows[0].displayName),
            primaryEmail: group.email,
            emailVerifiedAt: null,
            emailVerificationExemptProducts: [PRODUCT_ID],
            loginIdentifiers: [],
            legacySources: [source],
            legacyCredentialSource: SOURCE_ID,
            passwordCredential: importedCredential(group.passwordHash!),
            authVersion: 1,
            createdAt: now,
            updatedAt: now,
          };
      const changed =
        !existing ||
        existing.primaryEmail !== createdSubject.primaryEmail ||
        existing.firstName !== createdSubject.firstName ||
        existing.passwordCredential?.encodedVerifier !==
          createdSubject.passwordCredential?.encodedVerifier ||
        !existing.emailVerificationExemptProducts?.includes(PRODUCT_ID) ||
        !hasSource(existing, group.email);
      plannedSubjects.set(group.email, {
        subject: createdSubject,
        isNew: !existing,
        changed,
      });
      if (!existing) summary.created += 1;
      else summary.linked += 1;
    }

    const plannedMemberships = new Map<
      string,
      { membership: OrganizationMembershipRecord; changed: boolean }
    >();
    for (const group of groups.values()) {
      const plannedSubject = plannedSubjects.get(group.email);
      if (!plannedSubject) continue;
      const subject = plannedSubject.subject;
      for (const row of group.rows) {
        const organizationId = row.organizationId as OrganizationId;
        const organization = await loadApprovedOrganizationUnlocked(organizationId);
        const product = await store().readProduct(organizationId, PRODUCT_ID);
        if (!organization || !product || product.archivedAt || product.deletedAt) {
          conflict(row.sentry8UserId, "Sentry8 product is unavailable in the configured organization");
          continue;
        }
        const key = `${organizationId}:${subject.subjectId}:${PRODUCT_ID}`;
        let planned = plannedMemberships.get(key);
        if (!planned) {
          const existing = await store().readOrganizationMembership(
            organizationId,
            subject.subjectId,
            PRODUCT_ID,
          );
          const membership: OrganizationMembershipRecord = existing ?? {
            kind: "organization-membership",
            schemaVersion: 1,
            organizationMembershipId: newOrganizationMembershipId(),
            organizationId,
            productId: PRODUCT_ID,
            subjectId: subject.subjectId,
            role: "member",
            status: "active",
            permissionGrants: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          planned = { membership, changed: !existing };
          plannedMemberships.set(key, planned);
        }
        const existingGrant = planned.membership.permissionGrants?.find(
          (grant) =>
            grant.scope.kind === "project" &&
            grant.scope.projectId === row.resourceId!.toLowerCase(),
        );
        const grant = roleGrant(subject.subjectId, row, existingGrant);
        const priorRole = existingGrant?.accessRole?.name;
        const priorStatus = existingGrant?.status;
        const grants = planned.membership.permissionGrants ?? [];
        planned.membership = {
          ...planned.membership,
          permissionGrants: existingGrant
            ? grants.map((item) =>
                item.membershipId === existingGrant.membershipId ? grant : item,
              )
            : [...grants, grant],
          updatedAt: new Date().toISOString(),
        };
        planned.changed ||=
          !existingGrant || priorRole !== grant.accessRole?.name || priorStatus !== grant.status;
      }
    }

    summary.memberships = [...groups.values()].reduce(
      (count, group) => count + group.rows.length,
      0,
    );
    if (apply && summary.conflicts.length === 0) {
      for (const item of plannedSubjects.values()) {
        if (item.changed) {
          await persistRecord(
            item.subject,
            item.isNew ? "identity.sentry8-imported" : "identity.sentry8-linked",
            { kind: "system" },
            { productId: PRODUCT_ID },
          );
        }
      }
      for (const item of plannedMemberships.values()) {
        if (item.changed) {
          await persistRecord(
            item.membership,
            "identity.sentry8-project-access-imported",
            { kind: "system" },
            { productId: PRODUCT_ID },
          );
        }
      }
      for (const group of groups.values()) {
        const subject = plannedSubjects.get(group.email)?.subject;
        if (!subject) continue;
        for (const row of group.rows) {
          summary.subjectMappings.push({
            sentry8UserId: row.sentry8UserId,
            subjectId: subject.subjectId,
          });
        }
      }
      summary.applied = true;
    }
  });

  return summary;
}
