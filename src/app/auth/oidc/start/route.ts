import { handleFederatedOidcLoginStart } from "@/lib/auth/federated-oidc";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleFederatedOidcLoginStart(request);
}
