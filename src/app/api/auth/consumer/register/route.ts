import { findAccountByEmail, issueEmailAction, registerAccount } from "@/lib/auth/service";
import { sendVerificationEmail } from "@/lib/auth/mail";
import { isJsonObject, NO_STORE_HEADERS } from "@/lib/auth/http";
import { readConsumerJsonBody, requireConsumerClient } from "@/lib/auth/consumer-route";

export const runtime = "nodejs";

function validRegistration(
  value: unknown,
): value is { email: string; password: string; firstName?: string; lastName?: string } {
  if (!isJsonObject(value)) return false;
  const isOptionalName = (name: "firstName" | "lastName") => {
    const nameValue = value[name];
    return nameValue === undefined || (typeof nameValue === "string" && nameValue.length <= 80);
  };
  return (
    typeof value.email === "string" &&
    value.email.length <= 254 &&
    typeof value.password === "string" &&
    value.password.length >= 15 &&
    value.password.length <= 256 &&
    isOptionalName("firstName") &&
    isOptionalName("lastName")
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
  const client = await requireConsumerClient(request);
  if (client instanceof Response) return client;
  if (!client.selfRegistrationEnabled) {
    return Response.json(
      { error: "self_registration_disabled" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const body = await readConsumerJsonBody(request, 8 * 1024);
  if (body instanceof Response) return body;
  if (!validRegistration(body)) {
    return Response.json(
      {
        error:
          "Provide a valid email address, a password between 15 and 256 characters, and optional names up to 80 characters.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await registerAccount(body.email, body.password, {
      firstName: body.firstName,
      lastName: body.lastName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("An account with this email")) {
      const isInputError = /valid email|password|name/i.test(message);
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
