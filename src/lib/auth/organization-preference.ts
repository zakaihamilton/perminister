import "server-only";

import { cookies } from "next/headers";
import { assertOpaqueId } from "./domain";

const LAST_SELECTED_ORGANIZATION_COOKIE = "perminister_last_organization";
const LAST_SELECTED_ORGANIZATION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export async function getLastSelectedOrganizationId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(LAST_SELECTED_ORGANIZATION_COOKIE)?.value ?? null;
}

export async function rememberLastSelectedOrganization(organizationId: string): Promise<void> {
  assertOpaqueId(organizationId);
  const cookieStore = await cookies();
  cookieStore.set(LAST_SELECTED_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LAST_SELECTED_ORGANIZATION_MAX_AGE_SECONDS,
    priority: "low",
  });
}
