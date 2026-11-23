import "server-only";

import { mapWithConcurrency } from "../concurrency";
import {
  assertOpaqueId,
  newSubjectId,
  type OrganizationMembershipRecord,
  type OrganizationRole,
  type SubjectId,
  type SubjectRecord,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { withRequestPerformanceSpan } from "../performance";
import {
  createPasswordCredential,
  createScryptPasswordCredential,
  LEGACY_BCRYPT_CREDENTIAL_FORMAT,
  needsPasswordRehash,
} from "./passwords";
import {
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectUnlocked,
  persistRecord,
  store,
} from "./persistence";
import {
  consumerProductState,
  isAdministrator,
  requireVerifiedActiveSubject,
  validateProductId,
} from "./validators";

export async function checkAuthStorageReadiness(): Promise<void> {
  await store().checkReadiness();
}

export async function consumeLoginRequestRateLimit(callerKey: string): Promise<boolean> {
  return store().consumeRateLimit("login-ip", callerKey, 60, 15 * 60 * 1000);
}

export async function consumeConsumerLoginRequestRateLimit(
  clientId: string,
  callerKey: string | null,
): Promise<boolean> {
  return store().consumeRateLimit(
    "consumer-login",
    `${clientId}\0${callerKey ?? "unattributed"}`,
    6_000,
    15 * 60 * 1000,
  );
}

export async function consumeOAuthClientRegistrationRateLimit(
  callerKey: string | null,
): Promise<boolean> {
  return store().consumeRateLimit(
    "oauth-dcr",
    callerKey ?? "unattributed",
    50,
    15 * 60 * 1000,
  );
}

export async function createAdminProvisionedSubject(
  email: string | null,
  password: string,
  actorId: SubjectId,
): Promise<SubjectRecord> {
  const now = new Date().toISOString();
  const subject: SubjectRecord = {
    kind: "subject",
    schemaVersion: 1,
    subjectId: newSubjectId(),
    status: "active",
    primaryEmail: email,
    emailVerifiedAt: null,
    emailVerificationExempt: true,
    loginIdentifiers: [],
    legacySources: [],
    passwordCredential: await createPasswordCredential(password),
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await persistRecord(subject, "identity.admin-provisioned", {
    kind: "subject",
    subjectId: actorId,
  });
  return subject;
}

export async function rehashAfterLogin(
  subject: SubjectRecord,
  verifiedPassword: string,
): Promise<void> {
  if (!needsPasswordRehash(subject.passwordCredential)) return;
  const passwordCredential =
    subject.passwordCredential?.algorithm === "bcrypt" &&
    subject.passwordCredential.format === LEGACY_BCRYPT_CREDENTIAL_FORMAT
      ? await createScryptPasswordCredential(verifiedPassword)
      : await createPasswordCredential(verifiedPassword);
  await authMutationQueue.run(async () => {
    const current = await loadSubjectUnlocked(subject.subjectId);
    if (
      !current ||
      current.status !== "active" ||
      current.passwordCredential?.encodedVerifier !== subject.passwordCredential?.encodedVerifier ||
      current.passwordCredential?.algorithm !== subject.passwordCredential?.algorithm
    ) {
      return;
    }
    await persistRecord(
      { ...current, passwordCredential, updatedAt: new Date().toISOString() },
      "credential.password-rehashed",
      { kind: "subject", subjectId: subject.subjectId },
    );
  });
}

/**
 * Consumer app access is granted by public registration, an active product membership in an
 * approved organization, organization ownership of the app client, or system-administrator status.
 */
export async function hasActiveConsumerProductEntitlement(
  subjectId: SubjectId,
  productId: string,
  clientId?: string,
  subjectRecord?: SubjectRecord,
): Promise<boolean> {
  return withRequestPerformanceSpan("auth.consumer-entitlement", async () => {
    const normalizedProductId = validateProductId(productId);
    const subject = subjectRecord ?? (await loadSubjectUnlocked(subjectId));
    if (!subject || subject.subjectId !== subjectId || subject.status !== "active") return false;

    const client = clientId ? await loadRecord("consumer-client", clientId) : null;
    if (
      client &&
      (client.record.status !== "active" ||
        client.record.productId.trim().toLowerCase() !== normalizedProductId)
    ) {
      return false;
    }

    const systemAdministrator = isAdministrator(subject);
    let organizationOwner = false;
    const organizationId = client?.record.organizationId;
    if (organizationId && (await loadApprovedOrganizationUnlocked(organizationId))) {
      const organizationMembership = await store().readOrganizationMembership(
        organizationId,
        subjectId,
      );
      organizationOwner =
        organizationMembership?.status === "active" && organizationMembership.role === "owner";
    }

    if (
      consumerProductState(subject, normalizedProductId).status !== "active" &&
      !systemAdministrator &&
      !organizationOwner
    ) {
      return false;
    }
    if (systemAdministrator || client?.record.selfRegistrationEnabled || organizationOwner) {
      return true;
    }

    const memberships = (await store().listMembershipsForSubject(subjectId)).filter(
      (membership) =>
        membership.subjectId === subjectId &&
        membership.status === "active" &&
        membership.productId?.trim().toLowerCase() === normalizedProductId,
    );
    if (memberships.length === 0) return false;

    const organizationIds = [
      ...new Set(memberships.map((membership) => membership.organizationId)),
    ];
    const approvedOrganizations = await mapWithConcurrency(organizationIds, (organizationId) =>
      loadApprovedOrganizationUnlocked(organizationId),
    );
    return approvedOrganizations.some(Boolean);
  });
}

export async function requireProductRoleUnlocked(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationMembershipRecord> {
  assertOpaqueId(organizationId);
  const [actor, organization, product, membership] = await Promise.all([
    loadSubjectUnlocked(actorId),
    loadApprovedOrganizationUnlocked(organizationId),
    store().readProduct(organizationId, productId),
    store().readOrganizationMembership(organizationId, actorId, productId),
  ]);
  requireVerifiedActiveSubject(actor);
  if (!organization || !product) throw new Error("Product not found.");
  if (product.archivedAt) {
    throw new Error("This product is archived. Restore it before making changes.");
  }
  if (product.pendingMove) {
    throw new Error("A product move is in progress. Resume it before making changes.");
  }
  if (!membership || membership.status !== "active" || !roles.includes(membership.role)) {
    throw new Error("You do not have permission to manage this product.");
  }
  return membership;
}
