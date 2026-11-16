import { handleLoginPost } from "@/lib/auth/login-session-handler";
import { withApiRoutePerformance } from "@/lib/auth/performance";

export const runtime = "nodejs";

export const POST = withApiRoutePerformance(
  "POST /login/submit",
  async function POST(request: Request): Promise<Response> {
    return handleLoginPost(request);
  },
);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/login";
  return Response.redirect(url, 303);
}
