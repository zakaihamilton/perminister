import Link from "next/link";
import { requestVerificationAction, updateAccountProfileAction } from "@/app/actions";
import { DashboardNotice } from "@/components/dashboard-shell";
import { isMailDeliveryConfigured } from "@/lib/auth/mail";
import type { SubjectRecord } from "@/lib/auth/domain";

export function ProfileNotices({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {notice === "profile-saved" ? (
        <DashboardNotice message="Account details saved." kind="success" />
      ) : null}
      {error === "profile" ? (
        <DashboardNotice message="Account details could not be saved. Try again." kind="error" />
      ) : null}
      {notice === "verification-sent" ? (
        <DashboardNotice message="Verification link sent. Check your inbox." kind="success" />
      ) : null}
      {notice === "email-already-verified" ? (
        <DashboardNotice message="Your email address is already verified." kind="success" />
      ) : null}
      {notice === "mail-not-configured" ? (
        <DashboardNotice
          message="Email delivery is unavailable, so verification links cannot be sent. Contact a Perminister administrator."
          kind="error"
        />
      ) : null}
      {notice === "verification-delivery-failed" ? (
        <DashboardNotice
          message="We could not send the verification email. Try again later."
          kind="error"
        />
      ) : null}
    </>
  );
}

type ProfileSubject = Pick<
  SubjectRecord,
  "firstName" | "lastName" | "primaryEmail" | "emailVerifiedAt" | "createdAt"
>;

export function ProfileDetailsSection({
  organizationId,
  subject,
}: {
  organizationId: string;
  subject: ProfileSubject;
}) {
  const returnTo = `/dashboard/${organizationId}/profile`;

  return (
    <section className="dashboard-card profile-card">
      <h2>Personal details</h2>
      <form action={updateAccountProfileAction} className="auth-form profile-name-form">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label>
          First name
          <input
            name="firstName"
            type="text"
            autoComplete="given-name"
            maxLength={80}
            defaultValue={subject.firstName ?? ""}
          />
        </label>
        <label>
          Last name
          <input
            name="lastName"
            type="text"
            autoComplete="family-name"
            maxLength={80}
            defaultValue={subject.lastName ?? ""}
          />
        </label>
        <p className="form-hint">Apps that use your Perminister account can read these details.</p>
        <button className="button button-primary" type="submit">
          Save changes
        </button>
      </form>
      <ProfileAccountDetails subject={subject} />
      {!subject.emailVerifiedAt ? <ProfileVerificationAction returnTo={returnTo} /> : null}
      <ProfileAccountLinks organizationId={organizationId} />
    </section>
  );
}

function ProfileAccountDetails({ subject }: { subject: ProfileSubject }) {
  return (
    <dl className="profile-details">
      <div>
        <dt>Email address</dt>
        <dd>{subject.primaryEmail ?? "No email address"}</dd>
      </div>
      <div>
        <dt>Email verification</dt>
        <dd>
          {subject.emailVerifiedAt ? (
            <span className="record-badge active">Verified</span>
          ) : (
            <span className="record-badge disabled">Not verified</span>
          )}
        </dd>
      </div>
      <div>
        <dt>Account created</dt>
        <dd>{new Date(subject.createdAt).toLocaleDateString()}</dd>
      </div>
    </dl>
  );
}

function ProfileVerificationAction({ returnTo }: { returnTo: string }) {
  return (
    <div className="profile-actions">
      {isMailDeliveryConfigured() ? (
        <form action={requestVerificationAction}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="button button-primary" type="submit">
            Send verification link
          </button>
        </form>
      ) : (
        <p className="form-hint">
          Email delivery is not configured. Verification links are unavailable.
        </p>
      )}
    </div>
  );
}

function ProfileAccountLinks({ organizationId }: { organizationId: string }) {
  return (
    <div className="profile-links">
      <Link href="/forgot-password">Change password</Link>
      <Link href={`/dashboard/${organizationId}/sessions`}>Manage signed-in devices</Link>
    </div>
  );
}
