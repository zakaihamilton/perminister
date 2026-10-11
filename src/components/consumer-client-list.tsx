import { revokeConsumerClientAction } from "@/app/actions";
import type { ConsumerClientSummary } from "@/lib/auth/service";

type FormAction = (payload: FormData) => void;

interface ConsumerClientListProps {
  action: FormAction;
  clients: ConsumerClientSummary[];
  organizationId: string;
  productId: string;
  returnTo: string;
  pending: boolean;
}

function sessionLifetimeLabel(milliseconds: number): string {
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours % 24 === 0) return `${hours / 24} days`;
  return `${hours} hours`;
}

export function ConsumerClientList({
  action,
  clients,
  organizationId,
  productId,
  returnTo,
  pending,
}: ConsumerClientListProps) {
  return (
    <section className="dashboard-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>App clients</h2>
          <p>Active credentials can call Perminister for this product.</p>
        </div>
      </div>
      {clients.length ? (
        <div className="record-list">
          {clients.map((client) => (
            <article className="consumer-client-card" key={client.clientId}>
              <div className="consumer-client-card-heading">
                <div>
                  <h3>{client.appName}</h3>
                  <p>
                    Client ID <code>{client.clientId}</code>
                  </p>
                </div>
                <span className={`record-badge ${client.status}`}>
                  {client.status === "active" ? "Active" : "Revoked"}
                </span>
              </div>
              <dl className="consumer-client-details-grid">
                <div>
                  <dt>Origin</dt>
                  <dd>{client.appOrigin ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Session lifetime</dt>
                  <dd>{sessionLifetimeLabel(client.sessionLifetimeMs)}</dd>
                </div>
                <div>
                  <dt>Self-registration</dt>
                  <dd>{client.selfRegistrationEnabled ? "Enabled" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    <time dateTime={client.createdAt}>{client.createdAt}</time>
                  </dd>
                </div>
              </dl>
              {client.status === "active" ? (
                <div className="consumer-client-card-actions">
                  <details className="rotate-details">
                    <summary>Rotate secret</summary>
                    <form action={action} className="auth-form management-form">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={productId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="clientId" value={client.clientId} />
                      <p>
                        Rotating replaces the current secret immediately. Update the app backend
                        with the new value.
                      </p>
                      <button className="button button-secondary" disabled={pending} type="submit">
                        {pending ? "Rotating…" : "Rotate secret"}
                      </button>
                    </form>
                  </details>
                  <form action={revokeConsumerClientAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="clientId" value={client.clientId} />
                    <button className="button button-secondary" type="submit">
                      Revoke client
                    </button>
                  </form>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty-card">
          <h3>No app clients yet</h3>
          <p>Create a client to connect an application backend to Perminister.</p>
        </div>
      )}
    </section>
  );
}
