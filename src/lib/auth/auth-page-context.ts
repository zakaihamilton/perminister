import "server-only";

import {
  type ConsumerAuthRequestContext,
  consumerAuthRequestContext,
} from "./consumer-auth-request-context";

export type AuthPageSearchParams = {
  error?: string;
  notice?: string;
  invitationToken?: string;
  next?: string;
};

export type AuthPageProps = { searchParams: Promise<AuthPageSearchParams> };

export type AuthPageContext = ConsumerAuthRequestContext & {
  params: AuthPageSearchParams;
};

export async function authPageContext(
  searchParams: Promise<AuthPageSearchParams>,
): Promise<AuthPageContext> {
  const params = await searchParams;
  const consumerContext = await consumerAuthRequestContext(params.next, {
    ignoreLookupErrors: true,
  });
  return { ...consumerContext, params };
}
