"use client";

import { useState } from "react";
import { AccessGrantActionsFields } from "@/components/access-grant-actions-fields";
import {
  AccessGrantScopeFields,
  type GrantScopeKind,
} from "@/components/access-grant-scope-fields";
import type { ProductAccessRole } from "@/lib/auth/access-roles";

export function AccessGrantPermissionFields({ roles }: { roles: readonly ProductAccessRole[] }) {
  const [scopeKind, setScopeKind] = useState<GrantScopeKind | "">("");
  return (
    <>
      <AccessGrantScopeFields scopeKind={scopeKind} onScopeKindChange={setScopeKind} />
      <AccessGrantActionsFields key={scopeKind} roles={roles} scopeKind={scopeKind} />
    </>
  );
}
