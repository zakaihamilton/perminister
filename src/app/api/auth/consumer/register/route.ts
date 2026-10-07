import { findAccountByEmail, issueEmailAction, registerAccount } from "@/lib/auth/service";
import { sendVerificationEmail } from "@/lib/auth/mail";
import { authenticateConsumerClient } from "@/lib/auth/consumer-clients";
import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";

export const runtime = "nodejs";

function validRegistration(value: unknown): value is { email: string; password: string } {
  return (
    isJsonObject(value) &&
    typeof value.email === "string" &&
    value.email.length <= 254 &&
    typeof value.password === "string" &&
    value.password.length >= 15 &&
    value.password.length <= 256
  );
}

async function sendVerificationIfNeeded(
  email: string,
  appOrigin: string | null,
  appName: string,
  origin: string | null,
): Promise<void> {
  const subject = await findAccountByEmail(email);
  if (!subject || subject.status !== "active" || subject.emailVerifiedAt) return;
  const action = await issueEmailAction(subject.subjectId, "verify-email");
  if (action) {
    await sendVerificationEmail(action.email, action.token, { origin, appOrigin, appName });
  }
}

export async function POST(request: Request) {
  const client = authenticateConsumerClient(request);
  if (!client) {
    return Response.json(
      { error: "Invalid application credentials." },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  if (!isJsonRequest(request)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      {
        status: 415,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Request body is too large."
            : "Request body must be valid JSON.",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!validRegistration(body)) {
    return Response.json(
      { error: "Provide a valid email address and a password between 15 and 256 characters." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await registerAccount(body.email, body.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("An account with this email")) {
      const isInputError = /valid email|password/i.test(message);
      return Response.json(
        {
          error: isInputError ? message : "Registration is temporarily unavailable.",
        },
        {
          status: isInputError ? 400 : 503,
          headers: NO_STORE_HEADERS,
        },
      );
    }
  }

  try {
    await sendVerificationIfNeeded(
      body.email,
      client.appOrigin,
      client.appName,
      request.headers.get("origin"),
    );
  } catch {
    // Keep the response identical for new and existing addresses.
  }
  return Response.json({ accepted: true }, { status: 202, headers: NO_STORE_HEADERS });
}
