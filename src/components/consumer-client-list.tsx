"use client";

import { useState, type FormEventHandler } from "react";
import type { ConsumerClientSummary } from "@/lib/auth/service";

interface ConsumerClientListProps {
  onRotateSubmit: FormEventHandler<HTMLFormElement>;
  clients: ConsumerClientSummary[];
  organizationId: string;
  productId: string;
  returnTo: string;
  pending: boolean;
  readOnly?: boolean;
}

function sessionLifetimeLabel(milliseconds: number): string {
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours % 24 === 0) return `${hours / 24} days`;
  return `${hours} hours`;
}

export function ConsumerClientList({
  onRotateSubmit,
  clients,
  organizationId,
  productId,
  returnTo,
  pending,
  readOnly = false,
}: ConsumerClientListProps) {
  const [rotatingClientId, setRotatingClientId] = useState<string | null>(null);

  return (
    <section className="dashboard-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>App clients</h2>
          <p>
            {readOnly
              ? "These app clients are managed by the product publisher and shared across its organizations."
              : "Active credentials can call Perminister for this product."}
          </p>
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
                  <dt>Allowed origin</dt>
                  <dd>{client.appOrigin ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Session lifetime</dt>
                  <dd>{sessionLifetimeLabel(client.sessionLifetimeMs)}</dd>
                </div>
                <div>
                  <dt>People can sign up</dt>
                  <dd>{client.selfRegistrationEnabled ? "Enabled" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    <time dateTime={client.createdAt}>{client.createdAt}</time>
                  </dd>
                </div>
              </dl>
              {!readOnly && client.status === "active" ? (
                <div className="consumer-client-card-actions">
                  <div className="consumer-client-card-buttons">
                    <button
                      aria-controls={
                        rotatingClientId === client.clientId
                          ? `rotate-secret-${client.clientId}`
                          : undefined
                      }
                      aria-expanded={rotatingClientId === client.clientId}
                      className="button button-secondary"
                      onClick={() =>
                        setRotatingClientId((current) =>
                          current === client.clientId ? null : client.clientId,
                        )
                      }
                      type="button"
                    >
                      Rotate secret
                    </button>
                    <form action="/actions/revokeConsumerClientAction" method="post">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={productId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="clientId" value={client.clientId} />
                      <button className="button button-secondary" type="submit">
                        Revoke app client
                      </button>
                    </form>
                  </div>
                  {rotatingClientId === client.clientId ? (
                    <form
                      action="/actions/createOrRotateConsumerClientAction"
                      method="post"
                      onSubmit={onRotateSubmit}
                      className="auth-form management-form"
                      id={`rotate-secret-${client.clientId}`}
                    >
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={productId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="clientId" value={client.clientId} />
                      <p>
                        This replaces the current secret immediately. Update the app backend with
                        the new value before it makes another request.
                      </p>
                      <button className="button button-secondary" disabled={pending} type="submit">
                        {pending ? "Rotating…" : "Replace secret"}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty-card">
          <h3>No app clients yet</h3>
          <p>
            {readOnly
              ? "The product publisher has not configured an app client yet."
              : "Create a client to connect an application backend to Perminister."}
          </p>
        </div>
      )}
    </section>
  );
}
