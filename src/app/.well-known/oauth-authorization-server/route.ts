import { getOAuthAuthorizationServerMetadata } from "@/lib/auth/oidc";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(getOAuthAuthorizationServerMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
