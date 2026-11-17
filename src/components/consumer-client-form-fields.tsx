interface ConsumerClientOriginFieldProps {
  id: string;
  defaultValue?: string;
}

export function ConsumerClientOriginField({
  id,
  defaultValue,
}: ConsumerClientOriginFieldProps) {
  const hintId = `${id}-hint`;

  return (
    <div className="consumer-client-form-field">
      <label htmlFor={id}>App origin (optional for older clients)</label>
      <input
        aria-describedby={hintId}
        defaultValue={defaultValue}
        id={id}
        maxLength={300}
        name="appOrigin"
        placeholder="https://app.example.com"
        type="url"
      />
      <p className="consumer-client-field-hint" id={hintId}>
        For older origin-based callbacks, include the exact origin and development port.
      </p>
    </div>
  );
}

interface ConsumerClientMultilineFieldProps {
  id: string;
  label: string;
  name: "redirectUris" | "resourceUris" | "oauthScopes";
  placeholder: string;
  hint: string;
  defaultValue?: string;
}

export function ConsumerClientMultilineField({
  id,
  label,
  name,
  placeholder,
  hint,
  defaultValue,
}: ConsumerClientMultilineFieldProps) {
  const hintId = `${id}-hint`;
  const registrationHint =
    name === "oauthScopes"
      ? " Public OAuth clients can request only these scopes."
      : name === "resourceUris"
        ? " Public OAuth clients can request only these resources."
        : "";
  const completeHint = `${hint}${registrationHint}`;

  return (
    <div className="consumer-client-form-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        aria-describedby={hintId}
        defaultValue={defaultValue}
        id={id}
        name={name}
        placeholder={placeholder}
        rows={3}
      />
      <p className="consumer-client-field-hint" id={hintId}>
        {completeHint}
      </p>
    </div>
  );
}
