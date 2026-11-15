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

export async function completeConsumerAuthorization(
  subjectId: SubjectId,
  authorization: ConsumerAuthorizationRequest,
): Promise<never> {
  let code: string;
  try {
    code = await createConsumerAuthorizationCode(
      subjectId,
      authorization.clientId,
      authorization.codeChallenge,
      authorization.nonce,
      authorization.redirectUri,
      authorization.scope,
    );
  } catch (error) {
    if (error instanceof ConsumerProductAccessDeniedError) {
      redirect(consumerAuthorizationErrorCallback(authorization, "access_denied"));
    }
    const query = new URLSearchParams(consumerAuthorizationQuery(authorization));
    query.set("error", "unavailable");
    redirect(`/oauth/authorize?${query.toString()}`);
  }

  const destination = new URL(authorization.redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("state", authorization.state);
  redirect(destination.toString());
}
