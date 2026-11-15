import "server-only";

import { redirect } from "next/navigation";
import { getCurrentSession, getConsumerClientRecord } from "@/lib/auth/service";
import { completeConsumerAuthorization } from "@/lib/auth/complete-consumer-authorization";
import {
  consumerAuthorizationErrorCallback,
  consumerAuthorizationQuery,
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
} from "@/lib/auth/consumer-sso";

function firstValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function authorizationParamsFromFormData(formData: FormData): URLSearchParams {
  const params = new URLSearchParams({
    client_id: firstValue(formData, "client_id"),
    redirect_uri: firstValue(formData, "redirect_uri"),
    response_type: firstValue(formData, "response_type"),
    state: firstValue(formData, "state"),
    code_challenge: firstValue(formData, "code_challenge"),
    code_challenge_method: firstValue(formData, "code_challenge_method"),
  });
  for (const name of ["nonce", "scope"] as const) {
    const value = firstValue(formData, name);
    if (value) params.set(name, value);
  }
  const prompt = firstValue(formData, "prompt");
  if (prompt) params.set("prompt", prompt);
  return params;
}

export async function approveConsumerAuthorizationAction(formData: FormData): Promise<void> {
  const params = authorizationParamsFromFormData(formData);
  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client, {
    allowLegacy: legacyConsumerAuthorizationEnabled(),
  });
  if (!authorization || !client) redirect("/login?error=sso");

  const current = await getCurrentSession();
  if (!current) {
    const returnTo = safeConsumerAuthorizationReturnTo(
      `/oauth/authorize?${consumerAuthorizationQuery(authorization)}`,
    );
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login?error=sso");
  }

  await completeConsumerAuthorization(current.subject.subjectId, authorization);
}

export async function cancelConsumerAuthorizationAction(formData: FormData): Promise<void> {
  const params = authorizationParamsFromFormData(formData);
  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client, {
    allowLegacy: legacyConsumerAuthorizationEnabled(),
  });
  if (!authorization) redirect("/login?error=sso");
  redirect(consumerAuthorizationErrorCallback(authorization, "access_denied"));
}
