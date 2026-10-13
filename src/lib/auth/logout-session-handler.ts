import "server-only";

import { isSameOriginBrowserRequest, publicRedirectResponse } from "@/lib/auth/http";
import { signOutCurrentSession } from "@/lib/auth/service";

export async function handleLogoutPost(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return publicRedirectResponse(request, "/login?error=request");
  }

  await signOutCurrentSession();
  return publicRedirectResponse(request, "/");
}
