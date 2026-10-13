import { useId, type FormEventHandler } from "react";

interface ConsumerClientCreateFormProps {
  onSubmit: FormEventHandler<HTMLFormElement>;
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
  pending: boolean;
}

function defaultSessionLifetimeHours(productId: string): string {
  if (productId === "visitoring") return "720";
  if (productId === "postparticle") return "8";
  return "12";
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
  const firstPartyProduct = ["visitoring", "postparticle"].includes(productId);

  return (
    <section className="dashboard-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>Create app client</h2>
          <p>
            Connect an app backend to Perminister for {productName} sign-in and permission checks.
          </p>
        </div>
      </div>
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
              defaultValue={defaultSessionLifetimeHours(productId)}
            />
          </label>
          <label htmlFor={`${formId}-registration`}>
            Let people sign up themselves
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
  );
}
