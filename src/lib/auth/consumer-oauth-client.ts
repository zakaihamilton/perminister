import "server-only";

import type { ConsumerClientRecord } from "./domain";
import type { ConsumerOAuthAuthorizationClient } from "./service/consumer-and-memberships";
import { getConsumerClientRecord, getOAuthAuthorizationClient } from "./service";

export async function getConsumerOAuthAuthorizationClient(
  clientId: string,
  resourceUri: string | null,
): Promise<ConsumerOAuthAuthorizationClient | null> {
  if (typeof getOAuthAuthorizationClient === "function") {
    return getOAuthAuthorizationClient(clientId, resourceUri);
  }

  // Compatibility for callers that provide only the legacy client lookup.
  if (resourceUri || typeof getConsumerClientRecord !== "function") return null;
  const profile: ConsumerClientRecord | null = await getConsumerClientRecord(clientId);
  if (!profile) return null;
  const legacyRedirect = profile.appOrigin
    ? new URL("/auth/perminister/callback", profile.appOrigin).toString()
    : null;
  const redirectUris = profile.redirectUris?.length
    ? profile.redirectUris
    : legacyRedirect
      ? [legacyRedirect]
      : [];
  return {
    oauthClientId: profile.consumerClientId,
    oauthClientType: "confidential",
    clientName: profile.appName,
    profile,
    redirectUris,
    registrationScopes: null,
  };
}
