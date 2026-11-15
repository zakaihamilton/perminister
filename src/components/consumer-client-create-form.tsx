import { useId, type FormEventHandler } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";
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
        className="auth-form"
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
          <label htmlFor={`${formId}-origin`}>
            Allowed app origin
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
          Session lifetime defaults to 12 hours and can be set from 5 minutes to 30 days. Choose the
          shortest duration your app supports. New clients default to invite only. Public
          registration lets any verified Perminister account sign in to this app. Invite-only apps
          require product membership. Organization owners and system administrators can sign in
          either way. Set
          an exact origin, including the port used in development. For example, use
          http://localhost:3000 when the app runs on port 3000. Callback URLs must match exactly.
        </p>
        <button className="button button-primary form-submit" disabled={pending} type="submit">
          {pending ? "Creating…" : "Create app client"}
        </button>
      </form>
    </section>
  );
}
