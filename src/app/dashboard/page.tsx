import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { BreadcrumbBar } from "@/components/dashboard-breadcrumbs";
import { createOrganizationAction, requestVerificationAction } from "@/app/actions";
import {
  getCurrentSession,
  isAdministrator,
  listOrganizationRequestsForSubject,
  listOrganizationsForSubject,
} from "@/lib/auth/service";
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
  const requests = await listOrganizationRequestsForSubject(current.subject.subjectId);
  const params = await searchParams;
  const verified = !!current.subject.emailVerifiedAt;
  const pendingRequest = requests.find((request) => request.status === "pending");
  return (
    <>
      <SiteHeader active="dashboard" authenticated />
      <main className="page-shell onboarding-shell">
        <div className="container onboarding-page">
          <BreadcrumbBar items={[{ label: "Set up your workspace" }]} />
          <div className="onboarding-intro">
            <div>
              <p className="eyebrow">Welcome to Perminister</p>
              <p className="page-intro">
                Request an organization to manage products and access. A platform administrator must
                approve it before you can use the workspace, or you can join a team with an
                invitation.
              </p>
            </div>
            <Image
              alt="An invitation card being added to a folder of team identities."
              className="onboarding-illustration"
              height={1254}
              loading="eager"
              sizes="(max-width: 700px) 38vw, 240px"
              src="/illustrations/workspace-invitation.png"
              width={1254}
            />
          </div>

          {params.error === "organization-create" ? (
            <p className="form-error" role="alert">
              Your organization request could not be submitted. Check your account and try again.
            </p>
          ) : null}
          {params.error === "organization-pending" ? (
            <p className="form-error" role="alert">
              You already have an organization request waiting for review.
            </p>
          ) : null}
          {params.notice === "organization-pending" ? (
            <p className="dashboard-notice info" role="status">
              Your request was submitted. You can use the workspace after it is approved.
            </p>
          ) : null}
          {params.notice === "account-created-mail-unconfigured" ? (
            <p className="dashboard-notice info" role="status">
              Your account was created. Email delivery is not configured, so verify your address
              before creating an organization.
            </p>
          ) : null}
          {params.notice === "verification-sent" ? (
            <p className="dashboard-notice success" role="status">
              We sent a verification link to{" "}
              <strong>{current.subject.primaryEmail ?? "your email address"}</strong>. Check your
              inbox and spam folder.
            </p>
          ) : null}
          {params.notice === "email-already-verified" ? (
            <p className="dashboard-notice success" role="status">
              Your email address is already verified. You can request an organization now.
            </p>
          ) : null}
          {params.notice === "mail-not-configured" ? (
            <p className="dashboard-notice error" role="alert">
              Email delivery is not configured, so we could not send a verification link. Ask the
              Perminister operator to configure email delivery.
            </p>
          ) : null}
          {params.notice === "verification-delivery-failed" ? (
            <p className="dashboard-notice error" role="alert">
              We could not send the verification email. Check your inbox before trying again, or
              contact the Perminister operator.
            </p>
          ) : null}

          {pendingRequest ? (
            <section className="onboarding-card">
              <span className="onboarding-step">02</span>
              <div>
                <h2>Organization request pending</h2>
                <p>
                  <strong>{pendingRequest.organization.name}</strong> is waiting for platform
                  approval. We’ll make the workspace available here after it is approved.
                </p>
                <span className="record-meta">
                  Submitted {new Date(pendingRequest.organization.createdAt).toLocaleString()}
                </span>
              </div>
            </section>
          ) : !verified ? (
            <section className="onboarding-card">
              <span className="onboarding-step">01</span>
              <div>
                <h2>Verify your email address</h2>
                <p>We use a verified address to protect organization ownership and invitations.</p>
                {isMailDeliveryConfigured() ? (
                  <form action={requestVerificationAction}>
                    <button className="button button-primary" type="submit">
                      Send verification link
                    </button>
                  </form>
                ) : (
                  <p className="form-hint">
                    Email delivery is not configured. Ask the Perminister operator to configure
                    Resend before continuing.
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section className="onboarding-card">
              <span className="onboarding-step">01</span>
              <div>
                <h2>Request an organization</h2>
                <p>
                  You’ll become its Owner if approved. Products, invitations, and access stay
                  unavailable until then.
                </p>
                <form action={createOrganizationAction} className="auth-form onboarding-form">
                  <label>
                    Organization name
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="Acme Studio"
                    />
                  </label>
                  <button className="button button-primary" type="submit">
                    Submit for approval
                  </button>
                </form>
              </div>
            </section>
          )}

          {requests.some((request) => request.status === "rejected") ? (
            <section className="dashboard-card organization-request-history">
              <h2>Previous organization requests</h2>
              <div className="record-list">
                {requests
                  .filter((request) => request.status === "rejected")
                  .map((request) => (
                    <article className="record-item" key={request.organization.organizationId}>
                      <div className="record-item-head">
                        <div>
                          <strong>{request.organization.name}</strong>
                          <span className="record-meta">
                            Submitted {new Date(request.organization.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <span className="record-badge rejected">Rejected</span>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ) : null}

          <div className="onboarding-secondary">
            <span>Joining an existing team?</span>
            <Link href="/accept-invitation">Open an invitation</Link>
          </div>
          {isAdministrator(current.subject) ? (
            <p className="onboarding-ops-link">
              <Link href="/dashboard/operations">Platform operations</Link>
            </p>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
