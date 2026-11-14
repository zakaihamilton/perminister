import { getOidcJwks } from "@/lib/auth/oidc";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(getOidcJwks(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Content-Type": "application/jwk-set+json",
    },
  });
}
