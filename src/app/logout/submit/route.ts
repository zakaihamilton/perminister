import { handleLogoutPost } from "@/lib/auth/logout-session-handler";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleLogoutPost(request);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/login";
  return Response.redirect(url, 303);
}
