import { sendVerificationEmail } from "@/lib/auth/mail";
import {
  completeEmailAction,
  findAccountByEmail,
  InvalidAuthActionError,
  issueEmailAction,
} from "@/lib/auth/service";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import {
  invalidConsumerEmailResponse,
  requireConsumerClientJsonBody,
} from "@/lib/auth/consumer-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await requireConsumerClientJsonBody(request, 8 * 1024);
  if (parsed instanceof Response) return parsed;
  const { body, client } = parsed;
  if (!isJsonObject(body)) {
    return Response.json(
      { error: "Provide an email address or verification token." },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (typeof body.token === "string") {
    try {
      await completeEmailAction(body.token, "verify-email");
      return Response.json({ verified: true }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      if (!(error instanceof InvalidAuthActionError)) {
        return Response.json(
          { error: "Email verification is temporarily unavailable." },
          {
            status: 503,
            headers: NO_STORE_HEADERS,
          },
        );
      }
      return Response.json(
        { error: "invalid_or_expired_token" },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }
  }
  if (typeof body.email !== "string" || body.email.length > 254) {
    return invalidConsumerEmailResponse();
  }
  try {
    const subject = await findAccountByEmail(body.email);
    if (subject && subject.status === "active" && !subject.emailVerifiedAt) {
      const action = await issueEmailAction(subject.subjectId, "verify-email");
      if (action) {
        await sendVerificationEmail(action.email, action.token, {
          origin: request.headers.get("origin"),
          appOrigin: client.appOrigin,
          appName: client.appName,
        });
      }
    }
  } catch {
    // Do not reveal whether an email address belongs to an account.
  }
  return Response.json({ accepted: true }, { status: 202, headers: NO_STORE_HEADERS });
}
