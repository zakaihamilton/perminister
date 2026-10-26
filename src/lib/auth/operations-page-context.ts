import "server-only";

import { redirect } from "next/navigation";
import { getCurrentSession, isAdministrator } from "@/lib/auth/service";

export async function getOperationsPageContext() {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect("/dashboard");
  return current;
}
