import { safeConsumerAuthorizationReturnTo } from "./consumer-sso";

export function authorizationReturnAfterLogin(next: string | null): string | null {
  const safeNext = safeConsumerAuthorizationReturnTo(next ?? "");
  if (!safeNext) return null;

  const target = new URL(safeNext, "https://perminister.invalid");
  target.searchParams.delete("prompt");
  if (target.searchParams.get("error") === "unavailable") {
    target.searchParams.delete("error");
  }
  return `${target.pathname}${target.search}`;
}

export function postLoginDestination(next: string | null, invitationToken: string): string {
  return (
    authorizationReturnAfterLogin(next) ??
    (invitationToken
      ? `/accept-invitation?token=${encodeURIComponent(invitationToken)}`
      : "/dashboard")
  );
}
