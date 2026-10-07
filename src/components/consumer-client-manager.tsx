"use client";

import { useActionState, useId } from "react";
import {
  createOrRotateConsumerClientAction,
  revokeConsumerClientAction,
  type ConsumerClientActionState,
} from "@/app/actions";
import type { ConsumerClientSummary } from "@/lib/auth/service";

interface ConsumerClientManagerProps {
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  clients: ConsumerClientSummary[];
}

function sessionLifetimeLabel(milliseconds: number): string {
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours % 24 === 0) return `${hours / 24} days`;
  return `${hours} hours`;
}

function defaultSessionLifetimeHours(productId: string): string {
  if (productId === "visitoring") return "720";
  if (productId === "postparticle") return "8";
  return "12";
}

export function ConsumerClientManager({
  organizationId,
  productId,
  productName,
  returnTo,
  clients,
}: ConsumerClientManagerProps) {
  const [state, action, pending] = useActionState<ConsumerClientActionState, FormData>(
    createOrRotateConsumerClientAction,
    {},
  );
  const formId = useId();
  const firstPartyProduct = ["visitoring", "postparticle"].includes(productId);

  return (
    <>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.clientId && state.secret ? (
        <section className="one-time-secret" aria-live="polite">
          <strong>Copy these credentials now. The secret will not be shown again.</strong>
          <span>Client ID</span>
          <code>{state.clientId}</code>
          <span>Client secret</span>
          <code>{state.secret}</code>
          <p>Store both values in the application backend&apos;s environment.</p>
        </section>
      ) : null}

      <section className="dashboard-card">
        <div className="dashboard-card-heading">
          <div>
            <h2>Create app client</h2>
            <p>
              Create credentials for a backend that uses Perminister for {productName} sign-in and
              access checks.
            </p>
          </div>
        </div>
        <form action={action} className="auth-form">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="form-grid">
            <label htmlFor={`${formId}-name`}>
              App name
              <input
                id={`${formId}-name`}
                name="appName"
                required
                maxLength={80}
                autoComplete="off"
                placeholder={productName}
              />
            </label>
            <label htmlFor={`${formId}-origin`}>
              App origin
              <input
                id={`${formId}-origin`}
                name="appOrigin"
                type="url"
                maxLength={300}
                placeholder="https://app.example.com"
              />
            </label>
            <label htmlFor={`${formId}-session-lifetime`}>
              Session lifetime (hours)
              <input
                id={`${formId}-session-lifetime`}
                name="sessionLifetimeHours"
                type="number"
                required
                min="0.083333"
                max="2160"
                step="any"
                defaultValue={defaultSessionLifetimeHours(productId)}
              />
            </label>
            <label htmlFor={`${formId}-registration`}>
              Public self-registration
              {firstPartyProduct ? (
                <>
                  <input type="hidden" name="selfRegistrationEnabled" value="false" />
                  <select id={`${formId}-registration`} disabled defaultValue="false">
                    <option value="false">Disabled for this product</option>
                  </select>
                </>
              ) : (
                <select
                  id={`${formId}-registration`}
                  name="selfRegistrationEnabled"
                  defaultValue="false"
                >
                  <option value="false">Disabled</option>
                  <option value="true">Enabled</option>
                </select>
              )}
            </label>
          </div>
          <p className="form-hint">
            Session lifetime can be 5 minutes to 90 days. New clients default to disabled public
            registration.
            {firstPartyProduct
              ? " Visitoring and PostParticle accounts are provisioned by product administrators."
              : " You can enable registration for apps that support self-service sign-up."}
          </p>
          <button className="button button-primary form-submit" disabled={pending} type="submit">
            {pending ? "Creating…" : "Create app client"}
          </button>
        </form>
      </section>

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
                        <button
                          className="button button-secondary"
                          disabled={pending}
                          type="submit"
                        >
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
    </>
  );
}
