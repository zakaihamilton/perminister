import "server-only";

import { assertOpaqueId, type ConsumerClientRecord } from "./domain";
import {
  legacyConsumerAuthorizationEnabled,
  parseConsumerAuthorizationRequest,
  safeConsumerAuthorizationReturnTo,
  type ConsumerAuthorizationRequest,
} from "./consumer-sso";
import { getConsumerClientRecord } from "./service";

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
  try {
    assertOpaqueId(clientId);
  } catch {
    return { next, client: null, authorization: null };
  }

  let client: ConsumerClientRecord | null;
  try {
    client = await getConsumerClientRecord(clientId.toLowerCase());
  } catch (error) {
    if (!options.ignoreLookupErrors) throw error;
    client = null;
  }

  const authorization = parseConsumerAuthorizationRequest(searchParams, client, {
    allowLegacy: legacyConsumerAuthorizationEnabled(),
  });
  return { next, client, authorization };
}
