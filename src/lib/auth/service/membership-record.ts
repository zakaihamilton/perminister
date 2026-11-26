import "server-only";

import { createHash } from "node:crypto";
import {
  type MembershipRecord,
  newMembershipId,
  type ResourceScope,
  type SubjectId,
} from "../domain";

export function createRoleMembershipRecord(
  productId: string,
  subjectId: SubjectId,
  scope: ResourceScope,
  role: string,
  actions: readonly string[],
  existing?: MembershipRecord,
  status: MembershipRecord["status"] = "active",
): MembershipRecord {
  const id = createHash("sha256")
    .update(`${productId}:${scope.kind}:${role}`)
    .digest("hex")
    .slice(0, 32);
  const now = new Date().toISOString();
  return {
    kind: "membership",
    schemaVersion: 1,
    membershipId: existing?.membershipId ?? newMembershipId(),
    subjectId,
    scope,
    grants: [{ scope, actions: [...actions] }],
    accessRole: { id: `role-${id}`, name: role },
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
