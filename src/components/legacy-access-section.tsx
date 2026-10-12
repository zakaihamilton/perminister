import { retireLegacyAccessAction } from "@/app/actions";

export function LegacyAccessSection({ legacy }: { legacy: { grants: number; keys: number } }) {
  return (
    <section className="dashboard-card operations-migration">
      <div>
        <h2>Retire legacy access</h2>
        <p>
          This disables grants and revokes API keys that do not belong to an organization.
          Identities, sessions, and audit history are preserved. The operation is safe to repeat.
        </p>
      </div>
      <div className="migration-counts">
        <span>
          <strong>{legacy.grants}</strong> active grants
        </span>
        <span>
          <strong>{legacy.keys}</strong> active API keys
        </span>
      </div>
      {legacy.grants || legacy.keys ? (
        <form action={retireLegacyAccessAction}>
          <button className="button button-primary" type="submit">
            Disable legacy access
          </button>
        </form>
      ) : (
        <p className="form-hint">No active unscoped grants or keys remain.</p>
      )}
    </section>
  );
}
