import { isIP } from "node:net";

export function lastValidForwardedIp(value: string | null): string | null {
  if (!value) return null;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => isIP(part));
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}
