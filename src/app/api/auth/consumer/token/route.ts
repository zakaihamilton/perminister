import { requireConsumerClientJsonBody } from "@/lib/auth/consumer-route";
import { NO_STORE_HEADERS, isJsonObject } from "@/lib/auth/http";
import {
  exchangeConsumerAuthorizationCode,
  InvalidConsumerAuthorizationCodeError,
  listConsumerOrganizationsForSubject,
} from "@/lib/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await requireConsumerClientJsonBody(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { client, body } = parsed;
  if (
    !isJsonObject(body) ||
    body.grant_type !== "authorization_code" ||
    typeof body.code !== "string" ||
    typeof body.code_verifier !== "string"
  ) {
    return Response.json(
      { error: "Provide a valid authorization code grant." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const exchanged = await exchangeConsumerAuthorizationCode(
      body.code,
      client.clientId,
      body.code_verifier,
    );
    const organizations = await listConsumerOrganizationsForSubject(
      exchanged.subject.subjectId,
      exchanged.productId,
    );
    return Response.json(
      {
        authenticated: true,
        sessionToken: exchanged.token,
        account: {
          subjectId: exchanged.subject.subjectId,
          email: exchanged.subject.primaryEmail,
          username:
            exchanged.subject.loginIdentifiers?.find(
              (item) => item.productId === exchanged.productId,
            )?.value ?? null,
        },
        session: { expiresAt: exchanged.session.expiresAt },
        organizations,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof InvalidConsumerAuthorizationCodeError) {
      return Response.json({ error: "invalid_grant" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    return Response.json(
      { error: "Authorization is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
