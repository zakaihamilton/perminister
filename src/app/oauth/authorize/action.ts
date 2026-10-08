"use server";

import { redirect } from "next/navigation";
import {
  getCurrentSession,
  getConsumerClientRecord,
  createConsumerAuthorizationCode,
} from "@/lib/auth/service";
import {
  consumerAuthorizationQuery,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
} from "@/lib/auth/consumer-sso";

function firstValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function authorizationParamsFromFormData(formData: FormData): URLSearchParams {
  return new URLSearchParams({
    client_id: firstValue(formData, "client_id"),
    redirect_uri: firstValue(formData, "redirect_uri"),
    response_type: firstValue(formData, "response_type"),
    state: firstValue(formData, "state"),
    code_challenge: firstValue(formData, "code_challenge"),
    code_challenge_method: firstValue(formData, "code_challenge_method"),
  });
}

export async function approveConsumerAuthorizationAction(formData: FormData): Promise<void> {
  const params = authorizationParamsFromFormData(formData);
  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client);
  if (!authorization || !client) redirect("/login?error=sso");

  const current = await getCurrentSession();
  if (!current) {
    const returnTo = safeConsumerAuthorizationReturnTo(
      `/oauth/authorize?${consumerAuthorizationQuery(authorization)}`,
    );
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login?error=sso");
  }

  let code: string;
  try {
    code = await createConsumerAuthorizationCode(
      current.subject.subjectId,
      client.consumerClientId,
      authorization.codeChallenge,
    );
  } catch {
    const query = new URLSearchParams({ ...Object.fromEntries(params), error: "unavailable" });
    redirect(`/oauth/authorize?${query.toString()}`);
  }

  const destination = new URL(authorization.redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("state", authorization.state);
  redirect(destination.toString());
}

export async function cancelConsumerAuthorizationAction(formData: FormData): Promise<void> {
  const params = authorizationParamsFromFormData(formData);
  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client);
  if (!authorization) redirect("/login?error=sso");
  const destination = new URL(authorization.redirectUri);
  destination.searchParams.set("error", "access_denied");
  destination.searchParams.set("state", authorization.state);
  redirect(destination.toString());
}
