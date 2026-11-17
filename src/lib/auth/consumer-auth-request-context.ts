import "server-only";

import { assertOpaqueId, type ConsumerClientRecord } from "./domain";
import {
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
  type ConsumerAuthorizationRequest,
} from "./consumer-sso";
import { getConsumerOAuthAuthorizationClient } from "./consumer-oauth-client";

export type ConsumerAuthRequestContext = {
  next: string | null;
  client: ConsumerClientRecord | null;
  authorization: ConsumerAuthorizationRequest | null;
};

export async function consumerAuthRequestContext(
  value: string | null | undefined,
  options: { ignoreLookupErrors?: boolean } = {},
): Promise<ConsumerAuthRequestContext> {
  const next = safeConsumerAuthorizationReturnTo(value ?? "");
  if (!next) return { next: null, client: null, authorization: null };

  const searchParams = new URL(next, "https://perminister.invalid").searchParams;
  const clientId = searchParams.get("client_id") ?? "";
  const resourceUri = searchParams.get("resource");
  try {
    assertOpaqueId(clientId);
  } catch {
    return { next, client: null, authorization: null };
  }

  let authorizationClient;
  try {
    authorizationClient = await getConsumerOAuthAuthorizationClient(clientId.toLowerCase(), resourceUri);
  } catch (error) {
    if (!options.ignoreLookupErrors) throw error;
    authorizationClient = null;
  }

  const authorization = parseConsumerAuthorizationRequest(searchParams, authorizationClient, {
    allowLegacy: legacyConsumerAuthorizationEnabled(),
  });
  return { next, client: authorizationClient?.profile ?? null, authorization };
}
