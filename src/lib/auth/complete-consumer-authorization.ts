import "server-only";

import { redirect } from "next/navigation";
import type { SubjectId } from "@/lib/auth/domain";
import {
  ConsumerProductAccessDeniedError,
  createConsumerAuthorizationCode,
} from "@/lib/auth/service";
import {
  consumerAuthorizationErrorCallback,
  consumerAuthorizationQuery,
  type ConsumerAuthorizationRequest,
} from "@/lib/auth/consumer-sso";
import { getConfiguredOidcIssuer } from "@/lib/auth/oidc";

export async function completeConsumerAuthorization(
  subjectId: SubjectId,
  authorization: ConsumerAuthorizationRequest,
): Promise<never> {
  let code: string;
  try {
    code = authorization.publicClient || authorization.resource
      ? await createConsumerAuthorizationCode(
          subjectId,
          authorization.clientId,
          authorization.codeChallenge,
          authorization.nonce,
          authorization.redirectUri,
          authorization.scope,
          authorization.resource,
          authorization.consumerClientId,
        )
      : await createConsumerAuthorizationCode(
          subjectId,
          authorization.clientId,
          authorization.codeChallenge,
          authorization.nonce,
          authorization.redirectUri,
          authorization.scope,
        );
  } catch (error) {
    if (error instanceof ConsumerProductAccessDeniedError) {
      redirect(
        consumerAuthorizationErrorCallback(
          authorization,
          "access_denied",
          getConfiguredOidcIssuer() ?? undefined,
        ),
      );
    }
    const query = new URLSearchParams(consumerAuthorizationQuery(authorization));
    query.set("error", "unavailable");
    redirect(`/oauth/authorize?${query.toString()}`);
  }

  const destination = new URL(authorization.redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("state", authorization.state);
  const issuer = getConfiguredOidcIssuer();
  if (issuer) destination.searchParams.set("iss", issuer);
  redirect(destination.toString());
}
