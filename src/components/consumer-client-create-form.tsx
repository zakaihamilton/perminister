import { useId, type FormEventHandler } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
import {
  ConsumerClientMultilineField,
  ConsumerClientOriginField,
} from "@/components/consumer-client-form-fields";
import { ConsumerClientFormContextFields } from "@/components/consumer-client-form-context-fields";

interface ConsumerClientCreateFormProps {
  onSubmit: FormEventHandler<HTMLFormElement>;
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  pending: boolean;
}

export function ConsumerClientCreateForm({
  onSubmit,
  organizationId,
  productId,
  productName,
  returnTo,
  pending,
}: ConsumerClientCreateFormProps) {
  const formId = useId();

  return (
    <section aria-label="App client details" className="dashboard-card">
      <form
        action="/actions/createOrRotateConsumerClientAction"
        method="post"
        onSubmit={onSubmit}
        className="auth-form consumer-client-form"
      >
        <ConsumerClientFormContextFields
          organizationId={organizationId}
          productId={productId}
          returnTo={returnTo}
        />
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
          <ConsumerClientOriginField id={`${formId}-origin`} />
          <ConsumerClientMultilineField
            hint="One exact callback URL per line."
            id={`${formId}-redirect-uris`}
            label="OAuth redirect URIs"
            name="redirectUris"
            placeholder="https://app.example.com/auth/callback"
          />
          <ConsumerClientMultilineField
            hint="One protected resource URL per line."
            id={`${formId}-resource-uris`}
            label="Resource URIs"
            name="resourceUris"
            placeholder="https://mcp.example.com"
          />
          <ConsumerClientMultilineField
            hint="One action name per line. Configure scopes for the resources above."
            id={`${formId}-oauth-scopes`}
            label="Allowed OAuth scopes"
            name="oauthScopes"
            placeholder={'knowledge.read\nknowledge.write'}
          />
          <label htmlFor={`${formId}-session-lifetime`}>
            Session lifetime (hours)
            <input
              id={`${formId}-session-lifetime`}
              name="sessionLifetimeHours"
              type="number"
              required
              min="0.083333"
              max="720"
              step="any"
              defaultValue="12"
            />
          </label>
          <label htmlFor={`${formId}-registration`}>
            Registration policy
            <CustomDropdown
              aria-label="Registration policy"
              id={`${formId}-registration`}
              name="selfRegistrationEnabled"
              required
              defaultValue="false"
              options={[
                { value: "false", label: "Invite only" },
                { value: "true", label: "Public registration" },
              ]}
            />
          </label>
        </div>
        <p className="form-hint">
          Session lifetime defaults to 12 hours (5 minutes to 30 days). Choose the shortest duration
          your app supports. New clients default to invite only. Public registration allows any
          verified account to sign in; invite only requires product membership. Owners and
          administrators can always sign in.
        </p>
        <button className="button button-primary form-submit" disabled={pending} type="submit">
          {pending ? "Creating…" : "Create app client"}
        </button>
      </form>
    </section>
  );
}
