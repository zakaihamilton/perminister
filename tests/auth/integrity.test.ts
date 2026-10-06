import { describe, expect, it } from "vitest";
import type { AuthEvent } from "../../src/lib/auth/domain";
import {
  assertNoConflictingAggregateRevisions,
  assertUniqueDirectoryRegistrations,
  AuthDataIntegrityError,
} from "../../src/lib/auth/integrity";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const DIRECTORY_ID = "00000000-0000-4000-8000-000000000001";

function event(overrides: Partial<AuthEvent> = {}): AuthEvent {
  return {
    schemaVersion: 1,
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as AuthEvent["eventId"],
    aggregate: { kind: "organization", id: ORGANIZATION_ID as never } as AuthEvent["aggregate"],
    aggregateVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    actor: { kind: "system" },
    type: "organization.updated",
    payload: {},
    ...overrides,
  } as AuthEvent;
}

describe("auth event integrity", () => {
  it("rejects two event IDs claiming the same aggregate revision", () => {
    expect(() =>
      assertNoConflictingAggregateRevisions([
        event(),
        event({ eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as AuthEvent["eventId"] }),
      ]),
    ).toThrow(AuthDataIntegrityError);
  });

  it("allows separate aggregates and distinct revisions", () => {
    expect(() =>
      assertNoConflictingAggregateRevisions([
        event(),
        event({
          aggregateVersion: 2,
          eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as AuthEvent["eventId"],
        }),
        event({
          aggregate: {
            kind: "organization",
            id: "22222222-2222-4222-8222-222222222222" as never,
          } as AuthEvent["aggregate"],
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects multiple directory identities for one normalized email", () => {
    const registration = (subjectId: string, version: number): AuthEvent =>
      event({
        eventId: `${version}${"c".repeat(35)}` as AuthEvent["eventId"],
        aggregate: { kind: "directory", id: DIRECTORY_ID as never } as AuthEvent["aggregate"],
        aggregateVersion: version,
        type: "identity.registered",
        payload: { email: " Person@example.com ", subjectId },
      });

    expect(() =>
      assertUniqueDirectoryRegistrations([
        registration("33333333-3333-4333-8333-333333333333", 1),
        registration("44444444-4444-4444-8444-444444444444", 2),
      ]),
    ).toThrow(AuthDataIntegrityError);
  });

  it("allows a repeated directory entry for the same identity", () => {
    const subjectId = "33333333-3333-4333-8333-333333333333";
    const registration = (version: number): AuthEvent =>
      event({
        eventId: `${version}${"d".repeat(35)}` as AuthEvent["eventId"],
        aggregate: { kind: "directory", id: DIRECTORY_ID as never } as AuthEvent["aggregate"],
        aggregateVersion: version,
        type: "identity.registered",
        payload: { email: "person@example.com", subjectId },
      });

    expect(() =>
      assertUniqueDirectoryRegistrations([registration(1), registration(2)]),
    ).not.toThrow();
  });
});
