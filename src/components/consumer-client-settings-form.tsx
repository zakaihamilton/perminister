"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConsumerClientActionState } from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { submitStableAction } from "@/lib/action-client";

export function ConsumerClientSettingsForm({
  client,
  organizationId,
  productId,
  returnTo,
  clientsPath,
}: {
  client: ConsumerClientSummary;
  organizationId: string;
  productId: string;
  returnTo: string;
  clientsPath: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConsumerClientActionState>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setState({ clientId: client.clientId });
    setPending(true);
    try {
      const result = await submitStableAction<ConsumerClientActionState>(
        "updateConsumerClientAction",
        formData,
      );
      setState(result);
      if (result.updated) router.refresh();
    } catch (error) {
      setState({
        clientId: client.clientId,
        error: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="dashboard-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Edit app client settings</h2>
          <p>Changes apply to new sign-ins and app requests that use this client.</p>
        </div>
      </div>
      <form
        key={client.updatedAt}
        action="/actions/updateConsumerClientAction"
        method="post"
        onSubmit={handleSubmit}
        className="auth-form"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="clientId" value={client.clientId} />
        <div className="form-grid">
          <label htmlFor="app-client-name">
            App name
            <input
              autoComplete="off"
              id="app-client-name"
              maxLength={80}
              name="appName"
              required
              defaultValue={client.appName}
            />
          </label>
          <label htmlFor="app-client-origin">
            Allowed app origin
            <input
              id="app-client-origin"
              maxLength={300}
              name="appOrigin"
              type="url"
              defaultValue={client.appOrigin ?? ""}
              placeholder="https://app.example.com"
            />
          </label>
          <label htmlFor="app-client-session-lifetime">
            Session lifetime (hours)
            <input
              id="app-client-session-lifetime"
              max="2160"
              min="0.083333"
              name="sessionLifetimeHours"
              required
              step="any"
              type="number"
              defaultValue={client.sessionLifetimeMs / (60 * 60 * 1000)}
            />
          </label>
          <label htmlFor="app-client-registration">
            People can sign up
            <CustomDropdown
              aria-label="People can sign up"
              id="app-client-registration"
              name="selfRegistrationEnabled"
              required
              defaultValue={client.selfRegistrationEnabled ? "true" : "false"}
              options={[
                { value: "false", label: "Disabled" },
                { value: "true", label: "Enabled" },
              ]}
            />
          </label>
        </div>
        <p className="form-hint">
          Session lifetime can be 5 minutes to 90 days. Use an HTTPS app origin, or an HTTP
          localhost or 127.0.0.1 origin for local development.
        </p>
        {state.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.updated ? (
          <p className="form-success" role="status">
            App client settings saved.
          </p>
        ) : null}
        <div className="consumer-client-edit-actions">
          <Link className="button button-secondary" href={clientsPath}>
            Cancel
          </Link>
          <button className="button button-primary" disabled={pending} type="submit">
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
