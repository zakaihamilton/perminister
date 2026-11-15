import { handleGoogleLoginCallback } from "@/lib/auth/google-oauth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleGoogleLoginCallback(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleGoogleLoginCallback(request);
}
