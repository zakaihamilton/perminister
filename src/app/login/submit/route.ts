import { handleLoginPost } from "@/lib/auth/login-session-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleLoginPost(request);
}
