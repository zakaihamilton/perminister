import { ConfirmationActionControl } from "@/components/confirmation-action-control";

export function LegacyAccessSection({ legacy }: { legacy: { grants: number; keys: number } }) {
  return (
    <section className="dashboard-card operations-migration">
      <div>
        <h2>Remove older access</h2>
        <p>
          This disables permissions and revokes API keys that are not linked to an organization.
          Accounts, signed-in devices, and activity history remain. You can safely run this again.
        </p>
      </div>
      <div className="migration-counts">
        <span>
          <strong>{legacy.grants}</strong> active permissions
        </span>
        <span>
          <strong>{legacy.keys}</strong> active API keys
        </span>
      </div>
      {legacy.grants || legacy.keys ? (
        <ConfirmationActionControl
          action="/actions/retireLegacyAccessAction"
          fields={[]}
          triggerLabel="Remove older access"
          triggerClassName="button button-primary"
          title="Remove older access?"
          description={`This will disable ${legacy.grants} legacy permission${legacy.grants === 1 ? "" : "s"} and revoke ${legacy.keys} legacy API key${legacy.keys === 1 ? "" : "s"}. Accounts, signed-in devices, and activity history will remain. You can safely run this again.`}
          confirmLabel="Remove older access"
        />
      ) : (
        <p className="form-hint">No active permissions or API keys outside organizations remain.</p>
      )}
    </section>
  );
}
