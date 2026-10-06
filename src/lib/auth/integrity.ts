import type { AuthEvent } from "./domain";

export class AuthDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthDataIntegrityError";
  }
}

export interface AuthEventStore {
  appendEvent(event: AuthEvent): Promise<void>;
  listEvents(aggregate: AuthEvent["aggregate"]): Promise<AuthEvent[]>;
}

/** Appends once, then refuses to continue if the shared history contains a conflict. */
export async function appendEventAndCheckIntegrity(
  store: AuthEventStore,
  event: AuthEvent,
): Promise<AuthEvent[]> {
  await store.appendEvent(event);
  const events = await store.listEvents(event.aggregate);
  assertNoConflictingAggregateRevisions(events);
  return events;
}

/** Adds the directory uniqueness check used after a registration append. */
export async function appendDirectoryRegistrationAndCheckIntegrity(
  store: AuthEventStore,
  event: AuthEvent,
): Promise<AuthEvent[]> {
  const events = await appendEventAndCheckIntegrity(store, event);
  assertUniqueDirectoryRegistrations(events);
  return events;
}

/** Refuses to choose an arbitrary winner when multiple events claim one revision. */
export function assertNoConflictingAggregateRevisions(events: readonly AuthEvent[]): void {
  const revisions = new Map<string, Map<number, string>>();
  for (const event of events) {
    const aggregateKey = `${event.aggregate.kind}:${event.aggregate.id}`;
    const aggregateRevisions = revisions.get(aggregateKey) ?? new Map<number, string>();
    const previousEventId = aggregateRevisions.get(event.aggregateVersion);
    if (previousEventId && previousEventId !== event.eventId) {
      throw new AuthDataIntegrityError(
        `Conflicting ${event.aggregate.kind} events exist for ${event.aggregate.id} at revision ${event.aggregateVersion}. Reconcile the Spaces event history before retrying.`,
      );
    }
    aggregateRevisions.set(event.aggregateVersion, event.eventId);
    revisions.set(aggregateKey, aggregateRevisions);
  }
}

/** Stops account lookup when the directory contains two identities for one email. */
export function assertUniqueDirectoryRegistrations(events: readonly AuthEvent[]): void {
  const registrations = new Map<string, string>();
  for (const event of events) {
    if (event.aggregate.kind !== "directory" || event.type !== "identity.registered") continue;
    const email = event.payload.email;
    const subjectId = event.payload.subjectId;
    if (typeof email !== "string" || typeof subjectId !== "string") continue;
    const normalizedEmail = email.trim().toLowerCase();
    const previousSubjectId = registrations.get(normalizedEmail);
    if (previousSubjectId && previousSubjectId !== subjectId) {
      throw new AuthDataIntegrityError(
        "Multiple identities are registered for the same email address in the Spaces directory. Reconcile the directory event history before retrying.",
      );
    }
    registrations.set(normalizedEmail, subjectId);
  }
}
