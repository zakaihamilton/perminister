import "server-only";

import { createHash } from "node:crypto";
import type { ProductAccessRole } from "../access-roles";
import {
  type AuthEvent,
  assertOpaqueId,
  type ConsumerProductState,
  type MembershipRecord,
  type OrganizationApprovalStatus,
  type OrganizationId,
  type OrganizationMembershipRecord,
  type OrganizationRecord,
  type PermissionGrant,
  type ResourceScope,
  type SubjectRecord,
} from "../domain";

const PERSON_NAME_MAX_LENGTH = 80;

export class InvalidAuthActionError extends Error {
  constructor(message = "This link is invalid or expired.") {
    super(message);
    this.name = "InvalidAuthActionError";
  }
}

export class MailDeliveryUnavailableError extends Error {
  constructor() {
    super("Email delivery is not configured. No email was sent.");
    this.name = "MailDeliveryUnavailableError";
  }
}

export class ConsumerProductAccessDeniedError extends Error {
  constructor(message = "This account is not authorized to use the application.") {
    super(message);
    this.name = "ConsumerProductAccessDeniedError";
  }
}

export function canonicalEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes("..")) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function isEmailVerifiedOrExempt(subject: SubjectRecord): boolean {
  return (
    subject.primaryEmail === null || !!subject.emailVerifiedAt || !!subject.emailVerificationExempt
  );
}

export function isEmailVerifiedOrExemptForProduct(
  subject: SubjectRecord,
  productId: string,
): boolean {
  const importedSystemConceptsAccount =
    ["system-concepts", "systemconcepts"].includes(productId.trim().toLowerCase()) &&
    subject.legacySources?.some((source) => source.source === "systemconcepts") === true;
  return (
    isEmailVerifiedOrExempt(subject) ||
    subject.emailVerificationExemptProducts?.includes(productId) === true ||
    importedSystemConceptsAccount
  );
}

export function requireVerifiedActiveSubject(
  subject: SubjectRecord | null,
  productId?: string,
): asserts subject is SubjectRecord {
  if (
    !subject ||
    subject.status !== "active" ||
    !(productId
      ? isEmailVerifiedOrExemptForProduct(subject, productId)
      : isEmailVerifiedOrExempt(subject))
  ) {
    throw new Error("An active account with a verified email is required.");
  }
}

export function consumerProductState(
  subject: SubjectRecord,
  productId: string,
): ConsumerProductState {
  return (
    subject.consumerProductStates?.find((state) => state.productId === productId) ?? {
      productId,
      status: "active",
      sessionVersion: 1,
    }
  );
}

export function updateConsumerProductState(
  subject: SubjectRecord,
  productId: string,
  status: "active" | "disabled",
  revokeSessions = false,
): ConsumerProductState[] {
  const current = consumerProductState(subject, productId);
  const next: ConsumerProductState = {
    productId,
    status,
    sessionVersion: current.sessionVersion + (current.status !== status || revokeSessions ? 1 : 0),
  };
  return [
    ...(subject.consumerProductStates ?? []).filter((state) => state.productId !== productId),
    next,
  ];
}

export function normalizedPersonName(
  value: string | undefined,
  label: "First" | "Last",
): string | undefined {
  if (value === undefined) return undefined;
  const name = value.trim();
  if (name.length > PERSON_NAME_MAX_LENGTH) {
    throw new Error(`${label} name must be ${PERSON_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return name || undefined;
}

export function normalizeProductUsername(value: string, productId?: string): string {
  const username = value.trim().toLowerCase();
  const isSystemConceptsId = productId?.trim().toLowerCase() === "system-concepts";
  const validUsername = isSystemConceptsId
    ? /^[a-z0-9_-]{1,254}$/.test(username)
    : /^[a-z0-9][a-z0-9_-]{0,79}$/.test(username);
  const validEmail =
    username.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) &&
    !username.includes("..");
  if (!validUsername && !validEmail) throw new Error("Enter a valid product username.");
  return username;
}

export function validatePassword(password: string): void {
  if (password.length < 15) {
    throw new Error("Use a password with at least 15 characters.");
  }
  if (password.length > 256) {
    throw new Error("Password must be 256 characters or fewer.");
  }
}

export function configuredAdministrators(): Set<string> {
  return new Set(
    (process.env.PERMINISTER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function administratorEmailsConfigured(): boolean {
  return configuredAdministrators().size > 0;
}

export function isAdministrator(subject: SubjectRecord): boolean {
  return (
    !!subject.primaryEmail &&
    !!subject.emailVerifiedAt &&
    configuredAdministrators().has(subject.primaryEmail.toLowerCase())
  );
}

export function organizationName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80)
    throw new Error("Organization names must be 2 to 80 characters.");
  return name;
}

export function organizationApprovalStatus(
  organization: OrganizationRecord,
): OrganizationApprovalStatus {
  return organization.approvalStatus === undefined ? "approved" : organization.approvalStatus;
}

export function validateProductId(value: string): string {
  const productId = value.trim().toLowerCase();
  if (
    productId.length < 1 ||
    productId.length > 128 ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(productId)
  ) {
    throw new Error(
      "Use a product ID with letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }
  return productId;
}

function validateProductUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Enter a valid ${label} URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url.toString();
}

export interface ProductDetailsInput {
  productId: string;
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
}

interface NormalizedProductDetails {
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
}

export function normalizeProductDetails(
  input: Omit<ProductDetailsInput, "productId">,
): NormalizedProductDetails {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) throw new Error("Enter a product name up to 120 characters.");
  if (input.description.length > 500)
    throw new Error("The product description must be 500 characters or fewer.");
  return {
    name,
    description: input.description.trim(),
    websiteUrl: validateProductUrl(input.websiteUrl, "Website"),
    iconUrl: input.iconUrl.trim() ? validateProductUrl(input.iconUrl.trim(), "Icon") : "",
  };
}

export function validateScope(scope: ResourceScope): ResourceScope {
  const common = {
    ...scope,
    organizationId: scope.organizationId.toLowerCase() as OrganizationId,
    productId: scope.productId.toLowerCase(),
  };
  const normalizedScope =
    scope.kind === "project"
      ? { ...common, projectId: scope.projectId.toLowerCase() }
      : scope.kind === "workspace"
        ? { ...common, workspaceId: scope.workspaceId.toLowerCase() }
        : common;
  const validPart = (value: string) => value.length <= 128 && /^[a-z0-9][a-z0-9._:-]*$/.test(value);
  assertOpaqueId(normalizedScope.organizationId);
  if (!validPart(normalizedScope.productId)) throw new Error("Enter a valid product ID.");
  if (normalizedScope.kind === "project" && !validPart(normalizedScope.projectId))
    throw new Error("Enter a valid project ID.");
  if (normalizedScope.kind === "workspace" && !validPart(normalizedScope.workspaceId))
    throw new Error("Enter a valid workspace ID.");
  return normalizedScope;
}

export function validateActions(actions: readonly string[]): string[] {
  const normalized = [...new Set(actions.map((action) => action.trim()).filter(Boolean))];
  if (
    normalized.length === 0 ||
    normalized.length > 32 ||
    normalized.some((action) => action.length > 64 || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(action))
  ) {
    throw new Error("Enter 1 to 32 valid action names.");
  }
  return normalized;
}

export function eventPayloadId(event: AuthEvent, key: string): string | null {
  const value = event.payload[key];
  if (typeof value !== "string") return null;
  try {
    assertOpaqueId(value);
    return value;
  } catch {
    return null;
  }
}

export function deterministicUuidFromSeed(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function accessRoleSnapshot(
  role: ProductAccessRole,
): NonNullable<MembershipRecord["accessRole"]> {
  return {
    id: role.id,
    name: role.name,
    ...(role.role ? { role: role.role } : {}),
    ...(role.catalogSource ? { catalogVersion: role.catalogSource.version } : {}),
  };
}

export function scopeMatchesGrant(grantScope: ResourceScope, request: ResourceScope): boolean {
  if (
    grantScope.organizationId.toLowerCase() !== request.organizationId.toLowerCase() ||
    grantScope.productId.toLowerCase() !== request.productId.toLowerCase()
  )
    return false;
  if (grantScope.kind === "product") return true;
  if (grantScope.kind !== request.kind) return false;
  if (grantScope.kind === "project" && request.kind === "project")
    return grantScope.projectId.toLowerCase() === request.projectId.toLowerCase();
  if (grantScope.kind === "workspace" && request.kind === "workspace")
    return grantScope.workspaceId.toLowerCase() === request.workspaceId.toLowerCase();
  return false;
}

export function productMembershipHasPermission(
  membership: OrganizationMembershipRecord,
  scope: ResourceScope,
  action: string,
): boolean {
  if (membership.status !== "active") return false;
  return (membership.permissionGrants ?? []).some(
    (grantRecord) =>
      grantRecord.status === "active" &&
      grantRecord.grants.some(
        (grant: PermissionGrant) =>
          scopeMatchesGrant(grant.scope, scope) && grant.actions.includes(action),
      ),
  );
}
