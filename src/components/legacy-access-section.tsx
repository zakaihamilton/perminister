import { retireLegacyAccessAction } from "@/app/actions";

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
        <form action={retireLegacyAccessAction}>
          <button className="button button-primary" type="submit">
            Remove older access
          </button>
        </form>
      ) : (
        <p className="form-hint">No active permissions or API keys outside organizations remain.</p>
      )}
    </section>
  );
}
