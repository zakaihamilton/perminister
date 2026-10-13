export async function submitStableAction<State extends { error?: string }>(
  actionName: string,
  formData: FormData,
): Promise<State> {
  const response = await fetch(`/actions/${encodeURIComponent(actionName)}`, {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Perminister could not complete that request. Please reload and try again.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Perminister returned an unexpected response. Please reload and try again.");
  }
  const result = payload as State;
  if (!response.ok) {
    return {
      ...result,
      error:
        typeof result.error === "string"
          ? result.error
          : "Perminister is updating. Reload the page and try again.",
    };
  }
  return result;
}
