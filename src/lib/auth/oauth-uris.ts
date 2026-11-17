export function normalizeOAuthUri(value: string, label: string): string {
  const input = value.trim();
  if (!input || input.length > 2048) throw new Error(`Enter a valid ${label}.`);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Enter a valid ${label}.`);
  }
  const localHttp =
    parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(`Use an HTTPS ${label}, or a localhost HTTP ${label}, without credentials or a fragment.`);
  }
  return parsed.toString();
}

export function normalizeOAuthUriList(value: readonly string[], label: string): string[] {
  if (value.length > 20) throw new Error(`Enter no more than 20 ${label}.`);
  const normalized = value.map((item) => normalizeOAuthUri(item, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Remove duplicate ${label}.`);
  }
  return normalized;
}

export function parseOAuthScopeList(value: string): string[] {
  const scopes = value.trim() ? value.trim().split(/\s+/) : [];
  if (
    scopes.length > 32 ||
    scopes.some((scope) => scope.length > 64 || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(scope)) ||
    new Set(scopes).size !== scopes.length
  ) {
    throw new Error("Provide up to 32 unique scope names using letters, numbers, dots, underscores, colons, or hyphens.");
  }
  return scopes;
}
