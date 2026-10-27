import { redirect } from "next/navigation";
import { AuthorizationView } from "@/components/authorization-view";
import { getConsumerClientRecord, getCurrentSession } from "@/lib/auth/service";
import {
  consumerAuthorizationQuery,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
} from "@/lib/auth/consumer-sso";

function singleValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function ConsumerAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{
    client_id?: string | string[];
    redirect_uri?: string | string[];
    response_type?: string | string[];
    state?: string | string[];
    code_challenge?: string | string[];
    code_challenge_method?: string | string[];
    error?: string | string[];
  }>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "state",
    "code_challenge",
    "code_challenge_method",
  ] as const) {
    const value = singleValue(values[key]);
    if (value) params.set(key, value);
  }

  const client = await getConsumerClientRecord(params.get("client_id") ?? "").catch(() => null);
  const authorization = parseConsumerAuthorizationRequest(params, client);
  const current = authorization ? await getCurrentSession() : null;
  if (authorization && client && !current) {
    const returnTo = safeConsumerAuthorizationReturnTo(
      `/oauth/authorize?${consumerAuthorizationQuery(authorization)}`,
    );
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login?error=sso");
  }

  return (
    <AuthorizationView
      authorization={authorization}
      client={client}
      current={current}
      error={singleValue(values.error)}
    />
  );
}
