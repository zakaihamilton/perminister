import {
  isJsonObject,
  isJsonRequest,
  NO_STORE_HEADERS,
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/auth/http";

type MigrationKind = "sentry8" | "systemconcepts";

type MigrationMessages = {
  contentType: string;
  tooLarge: string;
  invalid: string;
};

const messages: Record<MigrationKind, MigrationMessages> = {
  sentry8: {
    contentType: "Expected an encrypted JSON manifest.",
    tooLarge: "Migration manifest is too large.",
    invalid: "Invalid migration manifest.",
  },
  systemconcepts: {
    contentType: "Expected a JSON migration batch.",
    tooLarge: "Migration batch is too large.",
    invalid: "Invalid migration batch.",
  },
};

type MigrationRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function readMigrationRequest<T>(
  request: Request,
  maximumBytes: number,
  kind: MigrationKind,
  isAuthorized: boolean,
  isValid: (value: unknown) => value is T,
): Promise<MigrationRequestResult<T>> {
  if (!isAuthorized) {
    return {
      ok: false,
      response: errorResponse("Not found.", 404),
    };
  }
  if (!isJsonRequest(request)) {
    return {
      ok: false,
      response: errorResponse(messages[kind].contentType, 415),
    };
  }

  let value: unknown;
  try {
    value = await readBoundedJson(request, maximumBytes);
  } catch (error) {
    const isTooLarge = error instanceof RequestBodyTooLargeError;
    return {
      ok: false,
      response: errorResponse(
        isTooLarge ? messages[kind].tooLarge : messages[kind].invalid,
        isTooLarge ? 413 : 400,
      ),
    };
  }

  if (!isJsonObject(value) || !isValid(value)) {
    return {
      ok: false,
      response: errorResponse(messages[kind].invalid, 400),
    };
  }
  return { ok: true, value };
}
