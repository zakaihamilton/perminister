import Link from "next/link";
import { requestVerificationAction } from "@/app/actions";
import { DashboardHeading, DashboardNotice } from "@/components/dashboard-shell";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import { getCurrentSession, isAdministrator } from "@/lib/auth/service";
import { redirect } from "next/navigation";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [current, { organizationId }, query] = await Promise.all([getCurrentSession(), params, searchParams]);
  if (!current) redirect("/login");
  const returnTo = `/dashboard/${organizationId}/profile`;
  return (
    <>
      <DashboardHeading eyebrow="Your account" title="Profile" description="Your Perminister identity is shared across the organizations you belong to." />
      {query.notice === "verification-sent" ? <DashboardNotice message="Verification link sent. Check your inbox." kind="success" /> : null}
      {query.notice === "email-already-verified" ? <DashboardNotice message="Your email address is already verified." kind="success" /> : null}
      {query.notice === "mail-not-configured" ? <DashboardNotice message="Email delivery is not configured. Ask your administrator to enable Resend." kind="error" /> : null}
      {query.notice === "verification-delivery-failed" ? <DashboardNotice message="We could not send the verification email. Try again later." kind="error" /> : null}
      <section className="dashboard-card profile-card">
        <dl className="profile-details">
          <div><dt>Email address</dt><dd>{current.subject.primaryEmail ?? "No email address"}</dd></div>
          <div><dt>Email status</dt><dd>{current.subject.emailVerifiedAt ? <span className="record-badge active">Verified</span> : <span className="record-badge disabled">Not verified</span>}</dd></div>
          <div><dt>Account created</dt><dd>{new Date(current.subject.createdAt).toLocaleDateString()}</dd></div>
        </dl>
        {!current.subject.emailVerifiedAt ? <div className="profile-actions">{isMailDeliveryConfigured() ? <form action={requestVerificationAction}><input type="hidden" name="returnTo" value={returnTo} /><button className="button button-primary" type="submit">Send verification link</button></form> : <p className="form-hint">Email delivery is not configured. Verification links are unavailable.</p>}</div> : null}
        <div className="profile-links"><Link href="/forgot-password">Change password</Link><Link href={`/dashboard/${organizationId}/sessions`}>Manage signed-in devices</Link></div>
        {isAdministrator(current.subject) ? <div className="profile-links"><Link href="/dashboard/operations">Platform operations</Link></div> : null}
      </section>
    </>
  );
}
