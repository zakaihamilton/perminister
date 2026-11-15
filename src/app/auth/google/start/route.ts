import { handleGoogleLoginStart } from "@/lib/auth/google-oauth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleGoogleLoginStart(request);
}
