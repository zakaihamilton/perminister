import { useId, type FormEventHandler } from "react";
import { CustomDropdown } from "@/components/custom-dropdown";

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
              max="2160"
              step="any"
              defaultValue="12"
            />
          </label>
          <label htmlFor={`${formId}-registration`}>
            Let people sign up themselves
            <CustomDropdown
              aria-label="Let people sign up themselves"
              id={`${formId}-registration`}
              name="selfRegistrationEnabled"
              required
              defaultValue="false"
              options={[
                { value: "false", label: "Disabled" },
                { value: "true", label: "Enabled" },
              ]}
            />
          </label>
        </div>
        <p className="form-hint">
          Session lifetime can be 5 minutes to 90 days. New clients default to disabled public
          registration. Enable registration for apps that support self-service sign-up. Set
          http://localhost without a port to allow any localhost port during development. Add a port
          to restrict sign-in to that port. HTTPS and 127.0.0.1 origins match exactly.
        </p>
        <button className="button button-primary form-submit" disabled={pending} type="submit">
          {pending ? "Creating…" : "Create app client"}
        </button>
      </form>
    </section>
  );
}
