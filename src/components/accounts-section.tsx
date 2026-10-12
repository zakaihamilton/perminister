import { AdminAccountActions } from "@/components/admin-account-actions";
import type { PublicAccount } from "@/lib/auth/service";

export function AccountsSection({ accounts }: { accounts: PublicAccount[] }) {
  return (
    <section className="dashboard-card operations-accounts">
      <div className="dashboard-card-heading">
        <div>
          <h2>Accounts</h2>
          <p>{accounts.length} registered accounts</p>
        </div>
      </div>
      <div className="record-list">
        {accounts.map((account) => (
          <article className="record-item admin-account-row" key={account.subjectId}>
            <p>
              {account.email ?? "No email"}
              <span>
                {account.status} · {account.emailVerified ? "verified" : "not verified"}
                {account.administrator ? " · platform administrator" : ""}
              </span>
            </p>
            {!account.administrator ? (
              <AdminAccountActions
                subjectId={account.subjectId}
                email={account.email}
                status={account.status}
              />
            ) : (
              <span className="record-badge active">Restricted admin</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
