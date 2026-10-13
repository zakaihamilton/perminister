import "server-only";

import { isSameOriginBrowserRequest, NO_STORE_HEADERS } from "@/lib/auth/http";
import { signOutCurrentSession } from "@/lib/auth/service";

function redirectResponse(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: path,
    },
  });
}

export async function handleLogoutPost(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return redirectResponse("/login?error=request");
  }

  await signOutCurrentSession();
  return redirectResponse("/");
}
