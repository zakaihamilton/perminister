import { notFound } from "next/navigation";
import { AuthorizationView } from "@/components/authorization-view";
import { InvitationView } from "@/components/invitation-view";
import { PreviewGuard } from "../preview-guard";

export default async function AuthPreview({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; state?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.PERMINISTER_UI_PREVIEW !== "1")
    notFound();
  const query = await searchParams;
  const view = query.view === "invitation" ? "invitation" : "authorization";
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
          <a href="/ui-preview/auth?view=authorization">Authorization</a>
          {" · "}
          <a href="/ui-preview/auth?view=invitation">Invitation</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=ready`}>Ready</a>
          {" · "}
          <a href={`/ui-preview/auth?view=${view}&state=invalid`}>Invalid</a>
        </nav>
        <p>
          Forms and navigation outside the preview are disabled. Values are fictional and cannot
          authenticate.
        </p>
      </div>
      {view === "authorization" ? (
        <AuthorizationView
          headerAuthenticated={!invalid}
          authorization={
            invalid
              ? null
              : {
                  clientId: "preview-client",
                  redirectUri: "https://example.test/callback",
                  responseType: "code",
                  state: "preview-state",
                  codeChallenge: "preview-challenge",
                }
          }
          client={invalid ? null : { appName: "Example app" }}
          current={invalid ? null : { subject: { primaryEmail: "alex@example.test" } }}
          error=""
        />
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
