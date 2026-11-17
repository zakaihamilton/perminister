import { notFound } from "next/navigation";
import { isUiPreviewAllowed } from "@/lib/ui-preview-access";
import { AuthorizationView } from "@/components/authorization-view";
import { InvitationView } from "@/components/invitation-view";
import { SitePageSkeleton } from "@/components/site-page-skeleton";
import { consumerAuthorization } from "../fixtures";
import { PreviewGuard } from "../preview-guard";

export default async function AuthPreview({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; state?: string; product?: string }>;
}) {
  if (!isUiPreviewAllowed()) notFound();
  const query = await searchParams;
  const view = query.view === "invitation" ? "invitation" : "authorization";
  const productIds = ["postparticle", "visitoring", "nanogres"] as const;
  const productId = productIds.find((id) => id === query.product) ?? null;
  const loading = query.state === "loading";
  const consent = query.state === "consent";
  const productNames = {
    postparticle: "PostParticle",
    visitoring: "Visitoring",
    nanogres: "Nanogres",
  } as const;
  const productQuery = productId ? `&product=${productId}` : "";
  const invalid = query.state === "invalid";
  const token = invalid
    ? "invalid-preview-token"
    : "00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  return (
    <PreviewGuard>
      <div className="ui-preview-toolbar">
        <strong>UI preview · synthetic data</strong>
        <nav aria-label="Authentication previews">
          <a href="/ui-preview">Back to gallery</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=ready`}>Perminister</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=ready&product=postparticle`}>PostParticle</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=ready&product=visitoring`}>Visitoring</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=ready&product=nanogres`}>Nanogres</a>
          {" · "}
          <a href={`/ui-preview/auth?view=authorization&state=loading${productQuery}`}>Loading</a>
          {" · "}
          <a href={`/ui-preview/auth?view=authorization&state=consent${productQuery}`}>Consent</a>
          {" · "}
          <a href={`/ui-preview/auth?view=invitation${productQuery}`}>Invitation</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=invalid${productQuery}`}>Invalid</a>
        </nav>
        <p>
          Forms and navigation outside the preview are disabled. Values are fictional and cannot
          authenticate.
        </p>
      </div>
      {loading ? (
        <SitePageSkeleton variant="authorization" />
      ) : view === "authorization" ? (
        invalid ? (
          <AuthorizationView error="" />
        ) : consent ? (
          <AuthorizationView
            authorization={consumerAuthorization}
            error=""
            signedInAs="alex@example.test"
          />
        ) : (
          <main className="page-shell auth-page-shell">
            <div className="container auth-page">
              <header className="auth-heading">
                <p className="eyebrow">Perminister identity</p>
                <h1>Authorization completes automatically</h1>
                <p>
                  After you sign in, Perminister returns you directly to{" "}
                  {productId ? productNames[productId] : "Example app"}.
                </p>
              </header>
            </div>
          </main>
        )
      ) : (
        <InvitationView
          token={token}
          hasToken={!invalid}
          current={{ subject: { primaryEmail: "alex@example.test" } }}
          error={invalid ? "invalid" : undefined}
        />
      )}
    </PreviewGuard>
  );
}
