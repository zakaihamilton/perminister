import { handleFederatedOidcLoginCallback } from "@/lib/auth/federated-oidc";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleFederatedOidcLoginCallback(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleFederatedOidcLoginCallback(request);
}
