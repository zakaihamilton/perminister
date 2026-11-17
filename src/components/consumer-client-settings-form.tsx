"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConsumerClientActionState } from "@/app/actions";
import { CustomDropdown } from "@/components/custom-dropdown";
import {
  ConsumerClientMultilineField,
  ConsumerClientOriginField,
} from "@/components/consumer-client-form-fields";
import type { ConsumerClientSummary } from "@/lib/auth/service";
import { submitStableAction } from "@/lib/action-client";
import { ConsumerClientFormContextFields } from "@/components/consumer-client-form-context-fields";

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
        className="auth-form consumer-client-form"
      >
        <ConsumerClientFormContextFields
          organizationId={organizationId}
          productId={productId}
          returnTo={returnTo}
        />
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
          <ConsumerClientOriginField
            defaultValue={client.appOrigin ?? ""}
            id="app-client-origin"
          />
          <ConsumerClientMultilineField
            defaultValue={client.redirectUris.join("\n")}
            hint="One exact callback URL per line."
            id="app-client-redirect-uris"
            label="OAuth redirect URIs"
            name="redirectUris"
            placeholder="https://app.example.com/auth/callback"
          />
          <ConsumerClientMultilineField
            defaultValue={client.resourceUris.join("\n")}
            hint="One protected resource URL per line."
            id="app-client-resource-uris"
            label="Resource URIs"
            name="resourceUris"
            placeholder="https://mcp.example.com"
          />
          <ConsumerClientMultilineField
            defaultValue={client.oauthScopes.join("\n")}
            hint="One action name per line. Configure scopes for the resources above."
            id="app-client-oauth-scopes"
            label="Allowed OAuth scopes"
            name="oauthScopes"
            placeholder={'knowledge.read\nknowledge.write'}
          />
          <label htmlFor="app-client-session-lifetime">
            Session lifetime (hours)
            <input
              id="app-client-session-lifetime"
              max="720"
              min="0.083333"
              name="sessionLifetimeHours"
              required
              step="any"
              type="number"
              defaultValue={client.sessionLifetimeMs / (60 * 60 * 1000)}
            />
          </label>
          <label htmlFor="app-client-registration">
            Registration policy
            <CustomDropdown
              aria-label="Registration policy"
              id="app-client-registration"
              name="selfRegistrationEnabled"
              required
              defaultValue={client.selfRegistrationEnabled ? "true" : "false"}
              options={[
                { value: "false", label: "Invite only" },
                { value: "true", label: "Public registration" },
              ]}
            />
          </label>
        </div>
        <p className="form-hint">
          Session lifetime is capped at 30 days. Choose the shortest duration your app supports.
          Public registration allows any verified account to sign in; invite only requires product
          membership. Owners and administrators can always sign in.
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
