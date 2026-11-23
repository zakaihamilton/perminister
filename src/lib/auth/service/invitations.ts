import "server-only";

import { randomBytes } from "node:crypto";
import { withOrganizationMutationLock } from "../coordination";
import {
  assertOpaqueId,
  newInvitationId,
  newOrganizationMembershipId,
  type OrganizationId,
  type OrganizationInvitationRecord,
  type OrganizationMembershipRecord,
  type SubjectId,
} from "../domain";
import { authMutationQueue } from "../mutation-queue";
import { requireProductRoleUnlocked } from "./core";
import { equalHex, hashHex } from "./passwords";
import {
  listRecordsWithRecovery,
  loadApprovedOrganizationUnlocked,
  loadRecord,
  loadSubjectByEmailUnlocked,
  loadSubjectUnlocked,
  organizationMembershipUnlocked,
  persistRecord,
  requireOrganizationRoleUnlocked,
  store,
} from "./persistence";
import { canonicalEmail } from "./validators";

const ORGANIZATION_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function createInvitationDraft(
  actorId: SubjectId,
  organizationId: string,
  email: string,
  role: OrganizationInvitationRecord["role"],
  productId?: string,
): { invitation: OrganizationInvitationRecord; token: string } {
  const invitationId = newInvitationId();
  const token = `${invitationId}.${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  return {
    token,
    invitation: {
      kind: "organization-invitation",
      schemaVersion: 1,
      invitationId,
      organizationId: organizationId as OrganizationId,
      ...(productId ? { productId } : {}),
      email,
      role,
      verifierDigestHex: hashHex(token),
      createdBySubjectId: actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ORGANIZATION_INVITATION_LIFETIME_MS).toISOString(),
      consumedAt: null,
      revokedAt: null,
    },
  };
}

function activeInvitationsForScope(
  invitations: OrganizationInvitationRecord[],
  organizationId: string,
  productId?: string,
): OrganizationInvitationRecord[] {
  return invitations
    .filter(
      (invite) =>
        invite.organizationId === organizationId &&
        (productId === undefined ? !invite.productId : invite.productId === productId) &&
        !invite.consumedAt &&
        !invite.revokedAt &&
        Date.parse(invite.expiresAt) > Date.now(),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  emailInput: string,
  role: "admin",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      if (actorMembership.role !== "owner") {
        throw new Error("Only an organization owner can invite an administrator.");
      }
      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
      }
      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const previous of invites.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.email === email &&
          !item.consumedAt &&
          !item.revokedAt,
      )) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorId },
        );
      }
      const { invitation, token } = createInvitationDraft(actorId, organizationId, email, role);
      await persistRecord(
        invitation,
        "organization.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function prepareOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<{ invitation: OrganizationInvitationRecord; token: string; organizationName: string }> {
  assertOpaqueId(invitationId);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }

      const organization = await loadRecord("organization", organizationId);
      if (!organization) throw new Error("Organization not found.");
      const target = await loadSubjectByEmailUnlocked(current.record.email);
      if (target && (await organizationMembershipUnlocked(organizationId, target.subjectId))) {
        throw new Error("This person is already a catalog manager.");
      }

      const { invitation, token } = createInvitationDraft(
        actorMembership.subjectId,
        organizationId,
        current.record.email,
        current.record.role,
      );
      await persistRecord(
        invitation,
        "organization.invitation-created",
        { kind: "subject", subjectId: actorMembership.subjectId },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
          resendOfInvitationId: current.record.invitationId,
        },
      );
      return { invitation, token, organizationName: organization.record.name };
    }),
  );
}

export async function completeOrganizationInvitationResend(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
  resentInvitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  assertOpaqueId(resentInvitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
      ]);
      const resent = await loadRecord("organization-invitation", resentInvitationId);
      const previous = await loadRecord("organization-invitation", invitationId);
      if (
        !resent ||
        resent.record.organizationId !== organizationId ||
        resent.record.productId ||
        resent.record.createdBySubjectId !== actorMembership.subjectId ||
        resent.record.consumedAt ||
        resent.record.revokedAt ||
        Date.parse(resent.record.expiresAt) <= Date.now()
      ) {
        throw new Error("Invitation not found.");
      }
      if (
        !previous ||
        previous.record.organizationId !== organizationId ||
        previous.record.productId ||
        previous.record.email !== resent.record.email
      ) {
        throw new Error("Invitation not found.");
      }

      const invites = (await listRecordsWithRecovery("organization-invitation")).map(
        (item) => item.record,
      );
      for (const item of invites.filter(
        (entry) =>
          entry.organizationId === organizationId &&
          !entry.productId &&
          entry.email === resent.record.email &&
          entry.invitationId !== resentInvitationId &&
          !entry.consumedAt &&
          !entry.revokedAt,
      )) {
        await persistRecord(
          { ...item, revokedAt: new Date().toISOString() },
          "organization.invitation-replaced",
          { kind: "subject", subjectId: actorMembership.subjectId },
        );
      }
    }),
  );
}

export async function createProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  emailInput: string,
  role: "admin" | "member",
): Promise<{ invitation: OrganizationInvitationRecord; token: string; productName: string }> {
  const email = canonicalEmail(emailInput);
  return authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      if (role === "admin" && actor.role !== "owner") {
        throw new Error("Only a product owner can invite a product administrator.");
      }
      const product = await store().readProduct(organizationId, productId);
      if (!product) throw new Error("Product not found.");
      const target = await loadSubjectByEmailUnlocked(email);
      if (target) {
        const existing = await store().readOrganizationMembership(
          organizationId,
          target.subjectId,
          productId,
        );
        if (existing?.status === "active")
          throw new Error("This person is already a product member.");
      }
      const invitations = (await listRecordsWithRecovery("organization-invitation"))
        .map((entry) => entry.record)
        .filter(
          (invite) =>
            invite.organizationId === organizationId &&
            invite.productId === productId &&
            invite.email === email &&
            !invite.consumedAt &&
            !invite.revokedAt,
        );
      for (const previous of invitations) {
        await persistRecord(
          { ...previous, revokedAt: new Date().toISOString() },
          "product.invitation-replaced",
          { kind: "subject", subjectId: actorId },
        );
      }
      const { invitation, token } = createInvitationDraft(
        actorId,
        organizationId,
        email,
        role,
        productId,
      );
      await persistRecord(
        invitation,
        "product.invitation-created",
        {
          kind: "subject",
          subjectId: actorId,
        },
        {
          invitationRole: invitation.role,
          invitationExpiresAt: invitation.expiresAt,
        },
      );
      return { invitation, token, productName: product.name };
    }),
  );
}

export async function listOrganizationInvitations(
  actorId: SubjectId,
  organizationId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireOrganizationRoleUnlocked(actorId, organizationId, ["owner", "admin"]);
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId);
  });
}

export async function listProductInvitations(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
): Promise<OrganizationInvitationRecord[]> {
  return authMutationQueue.run(async () => {
    await requireProductRoleUnlocked(actorId, organizationId, productId, ["owner", "admin"]);
    const invitations = (await listRecordsWithRecovery("organization-invitation")).map(
      (item) => item.record,
    );
    return activeInvitationsForScope(invitations, organizationId, productId);
  });
}

export async function revokeOrganizationInvitation(
  actorId: SubjectId,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actorMembership = await requireOrganizationRoleUnlocked(actorId, organizationId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (!current || current.record.organizationId !== organizationId)
        throw new Error("Invitation not found.");
      if (current.record.productId) throw new Error("Invitation not found.");
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "organization.invitation-revoked",
        { kind: "subject", subjectId: actorMembership.subjectId },
      );
    }),
  );
}

export async function revokeProductInvitation(
  actorId: SubjectId,
  organizationId: string,
  productId: string,
  invitationId: string,
): Promise<void> {
  assertOpaqueId(invitationId);
  await authMutationQueue.run(() =>
    withOrganizationMutationLock(organizationId, async () => {
      const actor = await requireProductRoleUnlocked(actorId, organizationId, productId, [
        "owner",
        "admin",
      ]);
      const current = await loadRecord("organization-invitation", invitationId);
      if (
        !current ||
        current.record.organizationId !== organizationId ||
        current.record.productId !== productId
      ) {
        throw new Error("Invitation not found.");
      }
      if (current.record.consumedAt || current.record.revokedAt) return;
      await persistRecord(
        { ...current.record, revokedAt: new Date().toISOString() },
        "product.invitation-revoked",
        { kind: "subject", subjectId: actor.subjectId },
      );
    }),
  );
}

export async function acceptOrganizationInvitation(
  subjectId: SubjectId,
  token: string,
): Promise<OrganizationId> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) throw new Error("This invitation is invalid or expired.");
  assertOpaqueId(match[1]);
  return authMutationQueue.run(async () => {
    const initial = await loadRecord("organization-invitation", match[1]);
    if (!initial) throw new Error("This invitation is invalid or expired.");
    return withOrganizationMutationLock(initial.record.organizationId, async () => {
      const subject = await loadSubjectUnlocked(subjectId);
      if (!subject || subject.status !== "active" || !subject.primaryEmail)
        throw new Error("An active account is required to accept an invitation.");
      const current = await loadRecord("organization-invitation", match[1]);
      if (
        !current ||
        current.record.consumedAt ||
        current.record.revokedAt ||
        Date.parse(current.record.expiresAt) <= Date.now() ||
        current.record.email !== subject.primaryEmail.toLowerCase() ||
        !equalHex(current.record.verifierDigestHex, hashHex(token))
      ) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      if (!(await loadApprovedOrganizationUnlocked(current.record.organizationId))) {
        throw new Error(
          "This invitation is invalid or expired, or it was sent to another email address.",
        );
      }
      if (current.record.productId) {
        const product = await store().readProduct(
          current.record.organizationId,
          current.record.productId,
        );
        if (!product || product.archivedAt) {
          throw new Error(
            "This invitation is invalid or expired, or it was sent to another email address.",
          );
        }
      }
      const existing = await store().readOrganizationMembership(
        current.record.organizationId,
        subjectId,
        current.record.productId,
      );
      if (!existing || existing.status !== "active") {
        const now = new Date().toISOString();
        const membership: OrganizationMembershipRecord = existing
          ? {
              ...existing,
              ...(current.record.productId
                ? {
                    productId: current.record.productId,
                    permissionGrants: existing.permissionGrants ?? [],
                  }
                : {}),
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              updatedAt: now,
            }
          : {
              kind: "organization-membership",
              schemaVersion: 1,
              organizationMembershipId: newOrganizationMembershipId(),
              organizationId: current.record.organizationId,
              ...(current.record.productId
                ? { productId: current.record.productId, permissionGrants: [] }
                : {}),
              subjectId,
              role: current.record.productId ? current.record.role : "admin",
              status: "active",
              createdAt: now,
              updatedAt: now,
            };
        await persistRecord(
          membership,
          current.record.productId
            ? "product.invitation-accepted"
            : "organization.catalog-manager-invitation-accepted",
          {
            kind: "subject",
            subjectId,
          },
        );
      }
      if (!subject.emailVerifiedAt) {
        await persistRecord(
          {
            ...subject,
            emailVerifiedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          "identity.email-verified-by-invitation",
          { kind: "subject", subjectId },
        );
      }
      await persistRecord(
        { ...current.record, consumedAt: new Date().toISOString() },
        "organization.invitation-consumed",
        { kind: "subject", subjectId },
      );
      return current.record.organizationId;
    });
  });
}
