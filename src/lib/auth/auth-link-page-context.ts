export type AuthLinkSearchParams = { token?: string; error?: string };

export async function getAuthLinkPageContext(searchParams: Promise<AuthLinkSearchParams>) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return { params, token };
}
