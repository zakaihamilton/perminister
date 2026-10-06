import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { createOrganizationAction, requestVerificationAction } from "@/app/actions";
import { getCurrentSession, isAdministrator, listOrganizationsForSubject } from "@/lib/auth/service";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  const organizations = await listOrganizationsForSubject(current.subject.subjectId);
  if (organizations.length) redirect(`/dashboard/${organizations[0].organization.organizationId}`);
  const params = await searchParams;
  const verified = !!current.subject.emailVerifiedAt;
  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="page-shell onboarding-shell">
        <div className="container onboarding-page">
          <p className="eyebrow">Welcome to Perminister</p>
          <h1>Set up your workspace</h1>
          <p className="page-intro">Create an organization to manage products and access, or join a team with an invitation.</p>

          {params.error === "organization-create" ? <p className="form-error" role="alert">Your organization could not be created. Check your account and try again.</p> : null}
          {params.notice === "account-created-mail-unconfigured" ? <p className="dashboard-notice info" role="status">Your account was created. Email delivery is not configured, so verify your address before creating an organization.</p> : null}

          {!verified ? (
            <section className="onboarding-card">
              <span className="onboarding-step">01</span>
              <div>
                <h2>Verify your email address</h2>
                <p>We use a verified address to protect organization ownership and invitations.</p>
                {isMailDeliveryConfigured()
                  ? <form action={requestVerificationAction}><button className="button button-primary" type="submit">Send verification link</button></form>
                  : <p className="form-hint">Email delivery is not configured. Ask the Perminister operator to configure Resend before continuing.</p>}
              </div>
            </section>
          ) : (
            <section className="onboarding-card">
              <span className="onboarding-step">01</span>
              <div>
                <h2>Create an organization</h2>
                <p>You’ll become its owner and can invite teammates after setup.</p>
                <form action={createOrganizationAction} className="auth-form onboarding-form">
                  <label>Organization name<input name="name" required minLength={2} maxLength={80} placeholder="Acme Studio" /></label>
                  <button className="button button-primary" type="submit">Create organization</button>
                </form>
              </div>
            </section>
          )}

          <div className="onboarding-secondary">
            <span>Joining an existing team?</span>
            <Link href="/accept-invitation">Open an invitation</Link>
          </div>
          {isAdministrator(current.subject) ? <p className="onboarding-ops-link"><Link href="/dashboard/operations">Platform operations</Link></p> : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
