import { after } from "next/server";
import {
  invalidConsumerEmailResponse,
  requireConsumerClientJsonObjectBody,
} from "@/lib/auth/consumer-route";
import { consumePasswordRecoveryRateLimit } from "@/lib/auth/coordination";
import { NO_STORE_HEADERS } from "@/lib/auth/http";
import { sendRecoveryEmail } from "@/lib/auth/mail";
import { withApiRoutePerformance } from "@/lib/auth/performance";
import {
  completeEmailAction,
  InvalidAuthActionError,
  issueRecoveryAction,
} from "@/lib/auth/service";

export const runtime = "nodejs";

export const POST = withApiRoutePerformance(
  "POST /api/auth/consumer/password-recovery",
  async function POST(request: Request) {
    const parsed = await requireConsumerClientJsonObjectBody(
      request,
      8 * 1024,
      "Provide an email address or recovery token and new password.",
    );
    if (parsed instanceof Response) return parsed;
    const { body, client } = parsed;
    if (typeof body.token === "string" && typeof body.password === "string") {
      if (body.password.length < 15 || body.password.length > 256) {
        return Response.json(
          { error: "Use a password between 15 and 256 characters." },
          {
            status: 400,
            headers: NO_STORE_HEADERS,
          },
        );
      }
      try {
        await completeEmailAction(body.token, "recover-password", body.password);
        return Response.json({ passwordChanged: true }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof InvalidAuthActionError) {
          return Response.json(
            { error: "invalid_or_expired_token" },
            {
              status: 400,
              headers: NO_STORE_HEADERS,
            },
          );
        }
        return Response.json(
          { error: "Password recovery is temporarily unavailable." },
          {
            status: 503,
            headers: NO_STORE_HEADERS,
          },
        );
      }
    }
    if (typeof body.email !== "string" || body.email.length > 254) {
      return invalidConsumerEmailResponse();
    }
    const email = body.email;
    if (!(await consumePasswordRecoveryRateLimit(email, `client:${client.clientId}`, 300))) {
      return Response.json({ accepted: true }, { status: 202, headers: NO_STORE_HEADERS });
    }
    after(async () => {
      try {
        const action = await issueRecoveryAction(email);
        if (action) {
          await sendRecoveryEmail(action.email, action.token);
        }
      } catch {
        // Do not reveal whether an email address belongs to an account.
      }
    });
    return Response.json({ accepted: true }, { status: 202, headers: NO_STORE_HEADERS });
  },
);
