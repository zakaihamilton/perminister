import "server-only";

import { withOrganizationMutationLock } from "../coordination";
import {
  type ApiKeyRecord,
  assertOpaqueId,
  type MembershipRecord,
  type SessionRecord,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { type AuditEntry, auditEntriesForEvents } from "./activity-formatting";
import {
  listRecordsWithRecovery,
  loadRecord,
  loadSubjectUnlocked,
  persistRecord,
  requireAdministrator,
  store,
} from "./persistence";
import { listSessionsForSubjectUnlocked } from "./sessions";
import { configuredAdministrators, isAdministrator, isEmailVerifiedOrExempt } from "./validators";

export interface PublicAccount {
  subjectId: SubjectId;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  status: SubjectRecord["status"];
  emailVerified: boolean;
  administrator: boolean;
  createdAt: string;
}

export interface DashboardData {
  memberships: MembershipRecord[];
  apiKeys: ApiKeyRecord[];
  sessions: SessionRecord[];
  audit: AuditEntry[];
  accounts: PublicAccount[] | null;
}

function publicAccount(subject: SubjectRecord): PublicAccount {
  return {
    subjectId: subject.subjectId,
    email: subject.primaryEmail,
    firstName: subject.firstName ?? null,
    lastName: subject.lastName ?? null,
    status: subject.status,
    emailVerified: !!subject.emailVerifiedAt,
    administrator: isAdministrator(subject),
    createdAt: subject.createdAt,
  };
}

export async function currentAccountProfile(subject: SubjectRecord): Promise<PublicAccount> {
  return publicAccount(subject);
}

export async function listAccountsForAdministrator(actorId: SubjectId): Promise<PublicAccount[]> {
  return authMutationQueue.run(async () => {
    return listAccountsForAdministratorUnlocked(actorId);
  });
}

async function listAccountsForAdministratorUnlocked(actorId: SubjectId): Promise<PublicAccount[]> {
  await requireAdministrator(actorId);
  const accounts = (await listRecordsWithRecovery("subject"))
    .filter((entry) => !entry.record.deletedAt)
    .map((entry) => publicAccount(entry.record))
    .sort((left, right) => (left.email ?? "").localeCompare(right.email ?? ""));
  return accounts.sort((left, right) => (left.email ?? "").localeCompare(right.email ?? ""));
}

export async function retireLegacyAccess(
  actorId: SubjectId,
): Promise<{ grants: number; keys: number }> {
  return authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const legacyMemberships = (await listRecordsWithRecovery("membership"))
      .map((item) => item.record)
      .filter((record) => record.status === "active" && !record.scope.organizationId);
    const legacyKeys = (await listRecordsWithRecovery("api-key"))
      .map((item) => item.record)
      .filter((record) => record.status === "active" && !record.scope.organizationId);
    for (const membership of legacyMemberships) {
      await persistRecord(
        { ...membership, status: "disabled", updatedAt: new Date().toISOString() },
        "migration.legacy-grant-disabled",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }
    for (const key of legacyKeys) {
      await persistRecord(
        { ...key, status: "revoked", revokedAt: new Date().toISOString() },
        "migration.legacy-api-key-revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }
    return { grants: legacyMemberships.length, keys: legacyKeys.length };
  });
}

export async function previewLegacyAccessRetirement(
  actorId: SubjectId,
): Promise<{ grants: number; keys: number }> {
  return authMutationQueue.run(async () => {
    await requireAdministrator(actorId);
    const memberships = (await listRecordsWithRecovery("membership")).map((item) => item.record);
    const keys = (await listRecordsWithRecovery("api-key")).map((item) => item.record);
    return {
      grants: memberships.filter(
        (record) => record.status === "active" && !record.scope.organizationId,
      ).length,
      keys: keys.filter((record) => record.status === "active" && !record.scope.organizationId)
        .length,
    };
  });
}

export async function updateAccountStatus(
  actorId: SubjectId,
  subjectId: string,
  status: "active" | "disabled",
): Promise<void> {
  assertOpaqueId(subjectId);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    const current = await loadRecord("subject", subjectId);
    if (!current) throw new Error("Account not found.");
    if (current.record.deletedAt) throw new Error("Account not found.");
    if (
      status === "disabled" &&
      current.record.primaryEmail &&
      configuredAdministrators().has(current.record.primaryEmail.toLowerCase())
    ) {
      throw new Error(
        "Remove this address from PERMINISTER_ADMIN_EMAILS before disabling the account.",
      );
    }
    if (current.record.status === status) return;
    const next: SubjectRecord = {
      ...current.record,
      status,
      authVersion: current.record.authVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    await persistRecord(next, status === "disabled" ? "identity.disabled" : "identity.enabled", {
      kind: "subject",
      subjectId: actor.subjectId,
    });
  });
}

export async function deleteAccountForAdministrator(
  actorId: SubjectId,
  subjectIdInput: string,
): Promise<void> {
  assertOpaqueId(subjectIdInput);
  await authMutationQueue.run(async () => {
    const actor = await requireAdministrator(actorId);
    if (subjectIdInput === actor.subjectId) throw new Error("You cannot delete your own account.");

    const initial = await loadRecord("subject", subjectIdInput);
    if (!initial) throw new Error("Account not found.");
    if (initial.record.deletedAt) return;
    if (initial.record.status !== "disabled")
      throw new Error("Disable the account before deleting it.");
    if (
      initial.record.primaryEmail &&
      configuredAdministrators().has(initial.record.primaryEmail.toLowerCase())
    ) {
      throw new Error(
        "Remove this address from PERMINISTER_ADMIN_EMAILS before deleting the account.",
      );
    }

    const initialMemberships = await store().listMembershipsForSubject(initial.record.subjectId);
    const initialKeys = await store().listApiKeysForSubject(initial.record.subjectId);
    const organizationIds = [
      ...new Set(
        [
          ...initialMemberships.map((membership) => membership.organizationId),
          ...initialKeys.map((key) => key.scope.organizationId),
        ].filter(Boolean),
      ),
    ].sort();

    const withOrganizationLocks = async (
      index: number,
      operation: () => Promise<void>,
    ): Promise<void> => {
      if (index >= organizationIds.length) return operation();
      return withOrganizationMutationLock(organizationIds[index], () =>
        withOrganizationLocks(index + 1, operation),
      );
    };

    await withOrganizationLocks(0, async () => {
      const current = await loadRecord("subject", subjectIdInput);
      if (!current) throw new Error("Account not found.");
      if (current.record.deletedAt) return;
      if (current.record.status !== "disabled") {
        throw new Error("Disable the account before deleting it.");
      }
      if (
        current.record.primaryEmail &&
        configuredAdministrators().has(current.record.primaryEmail.toLowerCase())
      ) {
        throw new Error(
          "Remove this address from PERMINISTER_ADMIN_EMAILS before deleting the account.",
        );
      }

      const memberships = (
        await store().listMembershipsForSubject(current.record.subjectId)
      ).filter((membership) => organizationIds.includes(membership.organizationId));
      for (const membership of memberships) {
        if (membership.status !== "active" || membership.role !== "owner") continue;
        const organizationMemberships = await store().listOrganizationMemberships(
          membership.organizationId,
          membership.productId ?? null,
        );
        let hasAnotherActiveOwner = false;
        for (const candidate of organizationMemberships) {
          if (
            candidate.subjectId === current.record.subjectId ||
            candidate.productId !== membership.productId ||
            candidate.role !== "owner" ||
            candidate.status !== "active"
          ) {
            continue;
          }
          const owner = await loadSubjectUnlocked(candidate.subjectId);
          if (owner?.status === "active" && isEmailVerifiedOrExempt(owner)) {
            hasAnotherActiveOwner = true;
            break;
          }
        }
        if (!hasAnotherActiveOwner) {
          throw new Error(
            "Transfer organization and product ownership to another active owner before deleting this account.",
          );
        }
      }

      const now = new Date().toISOString();
      for (const membership of memberships) {
        const permissionGrants = (membership.permissionGrants ?? []).map((grant) =>
          grant.status === "active"
            ? { ...grant, status: "disabled" as const, updatedAt: now }
            : grant,
        );
        if (
          membership.status === "disabled" &&
          permissionGrants.every(
            (grant, index) => grant === (membership.permissionGrants ?? [])[index],
          )
        ) {
          continue;
        }
        await persistRecord(
          {
            ...membership,
            status: "disabled",
            permissionGrants,
            updatedAt: now,
          },
          "identity.deleted-membership-revoked",
          { kind: "subject", subjectId: actor.subjectId },
        );
      }

      const keys = await store().listApiKeysForSubject(current.record.subjectId);
      for (const key of keys) {
        if (key.status !== "active") continue;
        await persistRecord(
          { ...key, status: "revoked", revokedAt: now },
          "identity.deleted-api-key-revoked",
          { kind: "subject", subjectId: actor.subjectId },
        );
      }

      await persistRecord(
        {
          ...current.record,
          status: "disabled",
          deletedAt: now,
          firstName: undefined,
          lastName: undefined,
          primaryEmail: null,
          emailVerifiedAt: null,
          emailVerificationExempt: false,
          loginIdentifiers: [],
          legacySources: [],
          externalIdentities: [],
          legacyCredentialSource: undefined,
          consumerProductStates: [],
          passwordCredential: null,
          authVersion: current.record.authVersion + 1,
          updatedAt: now,
        },
        "identity.deleted",
        { kind: "subject", subjectId: actor.subjectId },
      );
    });
  });
}

export async function loadDashboardData(subject: SubjectRecord): Promise<DashboardData> {
  return authMutationQueue.run(async () => {
    const events = await store().listAllEvents();
    const [membershipRecords, keyRecords, sessions, accounts] = await Promise.all([
      listRecordsWithRecovery("membership"),
      listRecordsWithRecovery("api-key"),
      listSessionsForSubjectUnlocked(subject),
      isAdministrator(subject)
        ? listAccountsForAdministratorUnlocked(subject.subjectId)
        : Promise.resolve(null),
    ]);
    const memberships = membershipRecords
      .map((item) => item.record)
      .filter((record) => isAdministrator(subject) || record.subjectId === subject.subjectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const apiKeys = keyRecords
      .map((item) => item.record)
      .filter(
        (record) => record.owner.kind === "subject" && record.owner.subjectId === subject.subjectId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      memberships,
      apiKeys,
      sessions,
      audit: auditEntriesForEvents(events, subject),
      accounts,
    };
  });
}
