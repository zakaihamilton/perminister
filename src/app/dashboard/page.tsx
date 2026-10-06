import type { ReactNode } from "react";
import { ApiKeyForm } from "@/components/api-key-form";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import {
  createGrantAction,
  requestVerificationAction,
  revokeApiKeyAction,
  revokeSessionAction,
  signOutAction,
  updateAccountStatusAction,
  updateGrantStatusAction,
} from "@/app/actions";
import {
  getCurrentSession,
  isAdministrator,
  loadDashboardData,
  administratorEmailsConfigured,
  type PublicAccount,
} from "@/lib/auth/service";
import type { ApiKeyRecord, MembershipRecord, ResourceScope } from "@/lib/auth/domain";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";

const noticeText: Record<string, { text: string; kind: "success" | "error" | "info" }> = {
  "account-created-mail-unconfigured": { text: "Your account was created. Resend is not configured, so no verification email was sent.", kind: "info" },
  "verification-sent": { text: "A verification link was accepted by Resend.", kind: "success" },
  "verification-delivery-failed": { text: "The verification message could not be sent. Check the Resend API key and sender configuration.", kind: "error" },
  "email-already-verified": { text: "This email address is already verified.", kind: "success" },
  "mail-not-configured": { text: "Resend is not configured. No verification email was sent.", kind: "info" },
  "key-revoked": { text: "The API key was revoked.", kind: "success" },
  "key-revoke-failed": { text: "The API key could not be revoked.", kind: "error" },
  "session-revoked": { text: "The session was revoked.", kind: "success" },
  "session-revoke-failed": { text: "The session could not be revoked.", kind: "error" },
  "grant-created": { text: "The permission grant was created.", kind: "success" },
  "grant-updated": { text: "The permission grant was updated.", kind: "success" },
  "grant-failed": { text: "The permission grant could not be changed.", kind: "error" },
  "account-updated": { text: "The account status was updated.", kind: "success" },
  "account-update-failed": { text: "The account status could not be changed.", kind: "error" },
  "admin-required": { text: "This action requires an account listed in PERMINISTER_ADMIN_EMAILS.", kind: "error" },
};

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function formatScope(scope: ResourceScope): string {
  if (scope.kind === "product") return `Product · ${scope.productId}`;
  if (scope.kind === "project") return `Project · ${scope.productId} / ${scope.projectId}`;
  return `Workspace · ${scope.productId} / ${scope.workspaceId}`;
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel management-panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <div className="panel-content">{children}</div>
    </section>
  );
}

function GrantRow({
  membership,
  label,
  administrator,
}: {
  membership: MembershipRecord;
  label: string;
  administrator: boolean;
}) {
  return (
    <article className="record-item">
      <div className="record-item-head">
        <div>
          <strong>{label}</strong>
          <span className="record-meta">{formatScope(membership.scope)}</span>
          <span className="record-meta">Actions: {membership.grants.flatMap((grant) => grant.actions).join(", ")}</span>
        </div>
        <span className={`record-badge ${membership.status}`}>{membership.status}</span>
      </div>
      {administrator ? (
        <div className="record-actions">
          <form action={updateGrantStatusAction}>
            <input type="hidden" name="membershipId" value={membership.membershipId} />
            <input type="hidden" name="status" value={membership.status === "active" ? "disabled" : "active"} />
            <button className="button button-secondary" type="submit">{membership.status === "active" ? "Revoke grant" : "Restore grant"}</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function keyStatus(key: ApiKeyRecord): "active" | "revoked" | "expired" {
  if (key.status === "revoked") return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return "expired";
  return "active";
}

function accountLabel(account: PublicAccount | undefined, subjectId: string): string {
  return account?.email ?? `Identity ${subjectId}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const [current, params] = await Promise.all([getCurrentSession(), searchParams]);
  if (!current) {
    return (
      <>
        <SiteHeader active="dashboard" />
        <main className="page-shell auth-page-shell">
          <div className="container auth-page">
            <header className="auth-heading">
              <p className="eyebrow">Identity and access</p>
              <h1>Your Perminister dashboard</h1>
              <p>Sign in to manage your profile and API keys. An administrator can manage identities and scoped permission grants.</p>
            </header>
            <section className="auth-card">
              <h2>Continue to your account</h2>
              <div className="hero-actions">
                <a className="button button-primary" href="/login">Sign in</a>
                <a className="button button-secondary" href="/register">Create account</a>
              </div>
              <p className="auth-footnote">Accounts and credentials are stored in the configured private Spaces bucket. Existing application accounts are never merged automatically.</p>
            </section>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const data = await loadDashboardData(current.subject);
  const administrator = isAdministrator(current.subject);
  const notice = params.notice ? noticeText[params.notice] : undefined;
  const accountsById = new Map((data.accounts ?? []).map((account) => [account.subjectId, account]));
  const activeAccounts = (data.accounts ?? []).filter((account) => account.status === "active");

  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell">
        <div className="container dashboard-page">
          <div className="page-heading-row">
            <div>
              <p className="eyebrow">Account</p>
              <h1>Dashboard</h1>
              <p className="page-intro">Manage your central identity, permission grants, active sessions, and API keys.</p>
            </div>
            <div className="dashboard-toolbar">
              {administrator ? <span className="dashboard-status">Administrator</span> : null}
              <form action={signOutAction}><button className="button button-secondary" type="submit">Sign out</button></form>
            </div>
          </div>

          {notice ? <div className={`dashboard-callout ${notice.kind === "info" ? "info" : ""}`} role={notice.kind === "error" ? "alert" : "status"}><span className="callout-icon">{notice.kind === "error" ? "!" : "✓"}</span><div><p>{notice.text}</p></div></div> : null}

          {!administrator && !administratorEmailsConfigured() ? (
            <div className="dashboard-callout info" role="status">
              <span className="callout-icon">i</span>
              <div><strong>Administrator controls are not configured.</strong><p>Set PERMINISTER_ADMIN_EMAILS to an account email to enable identity and permission management.</p></div>
            </div>
          ) : null}

          {!current.subject.emailVerifiedAt ? (
            <div className="dashboard-callout info" role="status">
              <span className="callout-icon">i</span>
              <div>
                <strong>Email address not verified</strong>
                <p>Verify this address to enable administrator access and API-key creation. A recovery link can also prove ownership and verify it. {current.subject.primaryEmail}</p>
                <div className="record-actions">
                  {isMailDeliveryConfigured() ? (
                    <form action={requestVerificationAction}><button className="button button-secondary" type="submit">Send verification link</button></form>
                  ) : <span className="form-hint">Resend is not configured; no message can be sent.</span>}
                </div>
              </div>
            </div>
          ) : null}

          <div className="management-grid">
            <Panel title="Your identity" subtitle="Central account profile">
              <dl className="profile-grid">
                <dt>Email</dt><dd>{current.subject.primaryEmail}</dd>
                <dt>Email verification</dt><dd>{current.subject.emailVerifiedAt ? `Verified ${formattedDate(current.subject.emailVerifiedAt)}` : "Not verified"}</dd>
                <dt>Account status</dt><dd>{current.subject.status}</dd>
                <dt>Created</dt><dd>{formattedDate(current.subject.createdAt)}</dd>
                <dt>Identity ID</dt><dd><code>{current.subject.subjectId}</code></dd>
              </dl>
            </Panel>

            <Panel title="Permission grants" subtitle={administrator ? "All configured grants" : "Grants assigned to this identity"}>
              {data.memberships.length ? (
                <div className="record-list">
                  {data.memberships.map((membership) => (
                    <GrantRow
                      key={membership.membershipId}
                      membership={membership}
                      label={administrator ? accountLabel(accountsById.get(membership.subjectId), membership.subjectId) : "Permission grant"}
                      administrator={administrator}
                    />
                  ))}
                </div>
              ) : <p className="empty-list">No permission grants are assigned.</p>}
              {administrator ? (
                <form action={createGrantAction} className="auth-form management-form">
                  <h3>Create a permission grant</h3>
                  <label>Identity<select name="subjectId" required defaultValue=""><option value="" disabled>Select an account</option>{activeAccounts.filter((account) => account.emailVerified).map((account) => <option key={account.subjectId} value={account.subjectId}>{account.email}</option>)}</select></label>
                  <label>Scope type<select name="scopeKind" defaultValue="product"><option value="product">Product</option><option value="project">Project</option><option value="workspace">Workspace</option></select></label>
                  <label>Product ID<input name="productId" required maxLength={128} /></label>
                  <label>Project or workspace ID<input name="resourceId" maxLength={128} /></label>
                  <label>Actions<input name="actions" required maxLength={2048} placeholder="read:profile, write:profile" /></label>
                  <p className="form-hint">Use your consumer application's stable IDs and action names. A product-level grant applies to resources within that product.</p>
                  <button className="button button-primary" type="submit" disabled={!activeAccounts.some((account) => account.emailVerified)}>Create grant</button>
                  {!activeAccounts.some((account) => account.emailVerified) ? <p className="form-hint">An identity must verify its email before receiving a grant.</p> : null}
                </form>
              ) : null}
            </Panel>

            <Panel title="API keys" subtitle="Scoped keys for server-to-server authorization">
              {data.apiKeys.length ? (
                <div className="record-list">
                  {data.apiKeys.map((key) => {
                    const status = keyStatus(key);
                    return (
                      <article className="record-item" key={key.apiKeyId}>
                        <div className="record-item-head">
                          <div>
                            <strong>Integration key</strong>
                            <span className="record-meta">{formatScope(key.scope)}</span>
                            <span className="record-meta">Actions: {key.actions.join(", ")}</span>
                            <span className="record-meta">Created {formattedDate(key.createdAt)} · {key.expiresAt ? `Expires ${formattedDate(key.expiresAt)}` : "No expiration"}</span>
                          </div>
                          <span className={`record-badge ${status}`}>{status}</span>
                        </div>
                        {status === "active" ? (
                          <div className="record-actions">
                            <form action={revokeApiKeyAction}><input type="hidden" name="apiKeyId" value={key.apiKeyId} /><button className="button button-secondary" type="submit">Revoke</button></form>
                          </div>
                        ) : null}
                        {status === "active" ? (
                          <details className="rotate-details">
                            <summary>Rotate this key</summary>
                            <ApiKeyForm
                              rotateFromApiKeyId={key.apiKeyId}
                              submitLabel="Create replacement and revoke this key"
                              defaults={{
                                scope: key.scope,
                                actions: key.actions,
                                expiresInDays: key.expiresAt ? "30" : "never",
                              }}
                            />
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : <p className="empty-list">No API keys have been created.</p>}
              <details className="create-key-details">
                <summary>Create API key</summary>
                <ApiKeyForm />
              </details>
            </Panel>

            <Panel title="Active sessions" subtitle="Sessions expire after 12 hours. Password changes invalidate all sessions.">
              {data.sessions.length ? (
                <div className="record-list">
                  {data.sessions.map((session) => (
                    <article className="record-item" key={session.sessionId}>
                      <div className="record-item-head">
                        <div><strong>{session.sessionId === current.session.sessionId ? "This session" : "Signed-in session"}</strong><span className="record-meta">Started {formattedDate(session.createdAt)} · Expires {formattedDate(session.expiresAt)}</span></div>
                        <span className="record-badge active">active</span>
                      </div>
                      <div className="record-actions">
                        <form action={revokeSessionAction}><input type="hidden" name="sessionId" value={session.sessionId} /><button className="button button-secondary" type="submit">{session.sessionId === current.session.sessionId ? "Sign out this session" : "Revoke session"}</button></form>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="empty-list">No active sessions were found.</p>}
            </Panel>

            {administrator ? (
              <Panel title="Identity directory" subtitle="Existing application accounts are never merged automatically." className="dashboard-full-width">
                {data.accounts?.length ? data.accounts.map((account) => (
                  <div className="admin-account-row" key={account.subjectId}>
                    <p>{account.email}<span>{account.subjectId} · {account.emailVerified ? "verified" : "unverified"}{account.administrator ? " · configured administrator" : ""}</span></p>
                    <div className="record-actions">
                      <span className={`record-badge ${account.status}`}>{account.status}</span>
                      {account.administrator && account.status === "active" ? null : (
                        <form action={updateAccountStatusAction}>
                          <input type="hidden" name="subjectId" value={account.subjectId} />
                          <input type="hidden" name="status" value={account.status === "active" ? "disabled" : "active"} />
                          <button className="button button-secondary" type="submit">{account.status === "active" ? "Disable identity" : "Enable identity"}</button>
                        </form>
                      )}
                    </div>
                  </div>
                )) : <p className="empty-list">No identities are registered.</p>}
              </Panel>
            ) : null}

            <Panel title="Recent audit history" subtitle={administrator ? "Latest identity and access changes" : "Latest changes related to this identity"} className="dashboard-full-width">
              {data.audit.length ? (
                <div className="audit-list">
                  {data.audit.map((entry) => (
                    <div className="audit-row" key={entry.eventId}>
                      <strong>{entry.type.replaceAll(".", " · ")}</strong>
                      <time dateTime={entry.occurredAt}>{formattedDate(entry.occurredAt)}</time>
                    </div>
                  ))}
                </div>
              ) : <p className="empty-list">No audit events have been recorded.</p>}
            </Panel>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
