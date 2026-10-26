import Link from "next/link";
import { CopyAppClientEnvironmentButton } from "@/components/copy-app-client-environment-button";

export function ConsumerClientSecretDetails({
  clientId,
  secret,
  clientsPath,
}: {
  clientId: string;
  secret: string;
  clientsPath?: string;
}) {
  return (
    <section className="one-time-secret" aria-live="polite">
      <div className="one-time-secret-heading">
        <strong>Copy these app client details now. The secret will not be shown again.</strong>
        <CopyAppClientEnvironmentButton clientId={clientId} secret={secret} />
      </div>
      <span>PERMINISTER_APP_CLIENT_ID</span>
      <code>{clientId}</code>
      <span>PERMINISTER_APP_CLIENT_SECRET</span>
      <code>{secret}</code>
      <p>Store both values in the application backend&apos;s environment.</p>
      {clientsPath ? (
        <Link className="button button-secondary" href={clientsPath}>
          View app clients
        </Link>
      ) : null}
    </section>
  );
}
