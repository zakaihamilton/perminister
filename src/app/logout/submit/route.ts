import { handleLogoutPost } from "@/lib/auth/logout-session-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleLogoutPost(request);
}
