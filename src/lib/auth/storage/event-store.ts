import "server-only";

import { mapWithConcurrency } from "../concurrency";
import { type AuthEvent, assertOpaqueId, type EventId } from "../domain";
import {
  activityOrganizationId,
  assertNoPlaintextSecrets,
  datePart,
  eventKey,
  OBJECT_PREFIX,
  safeSegment,
  sortEvents,
  validateEvent,
} from "./keys-and-validation";
import type { AuthObjectClient } from "./object-client";

const ACTIVITY_READ_CONCURRENCY = 40;
const RECENT_ACTIVITY_CACHE_LIMIT = 100;
const RECENT_ACTIVITY_CACHE_TTL_MS = 30_000;
const RECENT_ACTIVITY_CACHE_MAX_ENTRIES = 128;

type RecentActivityCacheEntry = {
  events: AuthEvent[];
  expiresAt: number;
};

const recentActivityCache = new Map<string, RecentActivityCacheEntry>();
const recentActivityReads = new Map<string, Promise<AuthEvent[]>>();

function recentActivityCacheKey(organizationId: string, productId?: string): string {
  return JSON.stringify([organizationId, productId ?? null]);
}

function getRecentActivityCache(key: string): RecentActivityCacheEntry | null {
  const entry = recentActivityCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    recentActivityCache.delete(key);
    return null;
  }
  recentActivityCache.delete(key);
  recentActivityCache.set(key, entry);
  return entry;
}

function setRecentActivityCache(key: string, events: AuthEvent[]): void {
  if (
    !recentActivityCache.has(key) &&
    recentActivityCache.size >= RECENT_ACTIVITY_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = recentActivityCache.keys().next().value;
    if (oldestKey !== undefined) recentActivityCache.delete(oldestKey);
  }
  recentActivityCache.delete(key);
  recentActivityCache.set(key, {
    events,
    expiresAt: Date.now() + RECENT_ACTIVITY_CACHE_TTL_MS,
  });
}

export class SpacesEventStore {
  constructor(
    private readonly s3: AuthObjectClient,
    private readonly useProcessCache = true,
  ) {}

  async appendEvent(event: AuthEvent): Promise<void> {
    validateEvent(event);
    assertNoPlaintextSecrets(event);
    const key = eventKey(event);
    await this.s3.writeJson(key, event);
    const date = datePart(event.occurredAt);
    await this.s3.writeJson(
      `${OBJECT_PREFIX}activity/by-aggregate/${event.aggregate.kind}/${event.aggregate.id}/${event.eventId}.json`,
      { key },
    );
    const organizationId =
      typeof event.payload.organizationId === "string"
        ? event.payload.organizationId
        : event.aggregate.kind === "organization"
          ? event.aggregate.id
          : undefined;
    const productId =
      typeof event.payload.productId === "string" ? event.payload.productId : undefined;
    const subjectId =
      typeof event.payload.subjectId === "string"
        ? event.payload.subjectId
        : event.actor.kind === "subject"
          ? event.actor.subjectId
          : undefined;
    if (organizationId) {
      assertOpaqueId(organizationId);
      await this.s3.writeJson(
        `${OBJECT_PREFIX}activity/by-organization/${organizationId}/${date}/${event.eventId}.json`,
        { key },
      );
    }
    if (organizationId && productId) {
      await this.s3.writeJson(
        `${OBJECT_PREFIX}activity/by-product/${organizationId}/${safeSegment(productId)}/${date}/${event.eventId}.json`,
        { key },
      );
    }
    if (subjectId) {
      assertOpaqueId(subjectId);
      await this.s3.writeJson(
        `${OBJECT_PREFIX}activity/by-subject/${subjectId}/${date}/${event.eventId}.json`,
        { key },
      );
    }
    if (organizationId) {
      this.updateRecentActivityCache(organizationId, undefined, event);
      if (productId) this.updateRecentActivityCache(organizationId, productId, event);
    }
  }

  async readEvent(aggregate: AuthEvent["aggregate"], eventId: EventId): Promise<AuthEvent | null> {
    assertOpaqueId(eventId);
    const pointer = await this.s3.readJson<{ key?: unknown }>(
      `${OBJECT_PREFIX}activity/by-aggregate/${aggregate.kind}/${aggregate.id}/${eventId}.json`,
    );
    if (typeof pointer?.key !== "string") return null;
    const event = await this.s3.readJson<AuthEvent>(pointer.key);
    if (!event) return null;
    validateEvent(event);
    return event;
  }

  async listEvents(aggregate: AuthEvent["aggregate"]): Promise<AuthEvent[]> {
    const prefix = `${OBJECT_PREFIX}activity/by-aggregate/${aggregate.kind}/${aggregate.id}/`;
    return this.readEventsFromPointers(prefix);
  }

  async listOrganizationEvents(
    organizationId: string,
    productId?: string,
    limit?: number,
  ): Promise<AuthEvent[]> {
    assertOpaqueId(organizationId);
    const prefix = productId
      ? `${OBJECT_PREFIX}activity/by-product/${organizationId}/${safeSegment(productId)}/`
      : `${OBJECT_PREFIX}activity/by-organization/${organizationId}/`;
    const maxEvents =
      limit === undefined ? null : Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    const belongsToOrganization = (event: AuthEvent) =>
      activityOrganizationId(event) === organizationId;
    if (maxEvents === null || maxEvents > RECENT_ACTIVITY_CACHE_LIMIT) {
      return this.readEventsFromPointers(prefix, maxEvents ?? undefined, belongsToOrganization);
    }
    if (maxEvents === 0) return [];

    const cacheKey = recentActivityCacheKey(organizationId, productId);
    const cached = this.useProcessCache ? getRecentActivityCache(cacheKey) : null;
    if (cached) {
      return cached.events.filter(belongsToOrganization).slice(0, maxEvents);
    }

    const pendingRead = this.useProcessCache ? recentActivityReads.get(cacheKey) : undefined;
    if (pendingRead) return (await pendingRead).filter(belongsToOrganization).slice(0, maxEvents);

    const read = this.readEventsFromPointers(
      prefix,
      RECENT_ACTIVITY_CACHE_LIMIT,
      belongsToOrganization,
    ).then((events) => {
      if (this.useProcessCache) setRecentActivityCache(cacheKey, events);
      return events;
    });
    if (this.useProcessCache) recentActivityReads.set(cacheKey, read);
    try {
      return (await read).slice(0, maxEvents);
    } finally {
      if (this.useProcessCache && recentActivityReads.get(cacheKey) === read) {
        recentActivityReads.delete(cacheKey);
      }
    }
  }

  async listAllEvents(): Promise<AuthEvent[]> {
    const keys = await this.s3.listKeys(`${OBJECT_PREFIX}activity/events/`);
    const events = await mapWithConcurrency(keys, async (key) => {
      const event = await this.s3.readJson<AuthEvent>(key);
      if (event === null) return null;
      validateEvent(event);
      assertNoPlaintextSecrets(event);
      return event;
    });
    return sortEvents(events.filter((event): event is AuthEvent => event !== null));
  }

  async listRecentEvents(limit: number): Promise<AuthEvent[]> {
    const maxEvents = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (maxEvents === 0) return [];

    const keys = await this.s3.listKeys(`${OBJECT_PREFIX}activity/events/`);
    const recentKeys = keys.sort().slice(-maxEvents);
    const events = await mapWithConcurrency(
      recentKeys,
      async (key) => {
        const event = await this.s3.readJson<AuthEvent>(key);
        if (event === null) return null;
        validateEvent(event);
        assertNoPlaintextSecrets(event);
        return event;
      },
      ACTIVITY_READ_CONCURRENCY,
    );
    return sortEvents(events.filter((event): event is AuthEvent => event !== null));
  }

  private async readEventsFromPointers(
    prefix: string,
    limit?: number,
    includeEvent?: (event: AuthEvent) => boolean,
  ): Promise<AuthEvent[]> {
    const pointers = await this.s3.listKeys(prefix);
    const maxEvents =
      limit === undefined ? null : Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (maxEvents === 0) return [];
    if (maxEvents === null || pointers.length <= maxEvents) {
      return this.readEventsFromPointerKeys(pointers, includeEvent);
    }

    const pointersByDate = new Map<string, string[]>();
    for (const pointerKey of pointers) {
      const date = pointerKey.slice(prefix.length).split("/", 1)[0] ?? "";
      const datePointers = pointersByDate.get(date) ?? [];
      datePointers.push(pointerKey);
      pointersByDate.set(date, datePointers);
    }
    const dateGroups = [...pointersByDate.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([, datePointers]) => datePointers);
    const recentEvents: AuthEvent[] = [];
    let nextDateGroup = 0;

    while (nextDateGroup < dateGroups.length && recentEvents.length < maxEvents) {
      const remaining = maxEvents - recentEvents.length;
      const candidatePointers: string[] = [];
      while (nextDateGroup < dateGroups.length && candidatePointers.length < remaining) {
        candidatePointers.push(...dateGroups[nextDateGroup]!);
        nextDateGroup += 1;
      }
      recentEvents.push(...(await this.readEventsFromPointerKeys(candidatePointers, includeEvent)));
    }

    return sortEvents(recentEvents).slice(0, maxEvents);
  }

  private async readEventsFromPointerKeys(
    pointers: readonly string[],
    includeEvent?: (event: AuthEvent) => boolean,
  ): Promise<AuthEvent[]> {
    const pointerValues = await mapWithConcurrency(
      pointers,
      (pointerKey) => this.s3.readJson<{ key?: unknown }>(pointerKey),
      ACTIVITY_READ_CONCURRENCY,
    );
    const eventKeys = pointerValues.flatMap((pointer) =>
      typeof pointer?.key === "string" ? [pointer.key] : [],
    );
    const events = await mapWithConcurrency(
      eventKeys,
      async (key) => {
        const event = await this.s3.readJson<AuthEvent>(key);
        if (!event) return null;
        validateEvent(event);
        return event;
      },
      ACTIVITY_READ_CONCURRENCY,
    );
    return sortEvents(
      events.filter(
        (event): event is AuthEvent => event !== null && (!includeEvent || includeEvent(event)),
      ),
    );
  }

  private updateRecentActivityCache(
    organizationId: string,
    productId: string | undefined,
    event: AuthEvent,
  ): void {
    if (!this.useProcessCache) return;
    const cacheKey = recentActivityCacheKey(organizationId, productId);
    const cached = getRecentActivityCache(cacheKey);
    if (!cached || cached.events.some((cachedEvent) => cachedEvent.eventId === event.eventId))
      return;
    setRecentActivityCache(
      cacheKey,
      sortEvents([...cached.events, event]).slice(0, RECENT_ACTIVITY_CACHE_LIMIT),
    );
  }
}
