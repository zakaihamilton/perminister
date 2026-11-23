import "server-only";

import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
  ProductRecord,
  SubjectId,
} from "../domain";
import { recordAuthCacheEvent } from "../performance";

const SESSION_SUBJECT_CACHE_MAX_ENTRIES = 512;
const ORGANIZATION_DASHBOARD_CACHE_TTL_MS = 30_000;
const ORGANIZATION_DASHBOARD_CACHE_MAX_ENTRIES = 128;

export const sessionSubjectCache = new Map<string, SubjectId>();

export interface OrganizationSummary {
  organization: OrganizationRecord;
  membership: OrganizationMembershipRecord;
  catalogManager: boolean;
}

export interface OrganizationDashboardData {
  organization: OrganizationSummary;
  products: ProductRecord[];
}

type OrganizationDashboardCacheEntry = {
  data: OrganizationDashboardData;
  membership: OrganizationMembershipRecord;
  expiresAt: number;
};

const organizationDashboardDataCache = new Map<string, OrganizationDashboardCacheEntry>();

function organizationDashboardCacheKey(subjectId: SubjectId, organizationId: string): string {
  return JSON.stringify([subjectId, organizationId]);
}

export function getCachedOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
): OrganizationDashboardCacheEntry | null {
  const key = organizationDashboardCacheKey(subjectId, organizationId);
  const entry = organizationDashboardDataCache.get(key);
  if (!entry) {
    recordAuthCacheEvent("organization-dashboard", "miss");
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    organizationDashboardDataCache.delete(key);
    recordAuthCacheEvent("organization-dashboard", "miss");
    return null;
  }
  organizationDashboardDataCache.delete(key);
  organizationDashboardDataCache.set(key, entry);
  recordAuthCacheEvent("organization-dashboard", "hit");
  return entry;
}

export function setCachedOrganizationDashboardData(
  subjectId: SubjectId,
  organizationId: string,
  data: OrganizationDashboardData,
  membership: OrganizationMembershipRecord,
): void {
  const key = organizationDashboardCacheKey(subjectId, organizationId);
  if (
    !organizationDashboardDataCache.has(key) &&
    organizationDashboardDataCache.size >= ORGANIZATION_DASHBOARD_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = organizationDashboardDataCache.keys().next().value;
    if (oldestKey !== undefined) organizationDashboardDataCache.delete(oldestKey);
  }
  organizationDashboardDataCache.delete(key);
  organizationDashboardDataCache.set(key, {
    data,
    membership,
    expiresAt: Date.now() + ORGANIZATION_DASHBOARD_CACHE_TTL_MS,
  });
}

export function invalidateOrganizationDashboardDataCache(): void {
  organizationDashboardDataCache.clear();
}

export function rememberSessionSubject(sessionId: string, subjectId: SubjectId): void {
  sessionSubjectCache.delete(sessionId);
  sessionSubjectCache.set(sessionId, subjectId);
  if (sessionSubjectCache.size > SESSION_SUBJECT_CACHE_MAX_ENTRIES) {
    const oldestSessionId = sessionSubjectCache.keys().next().value;
    if (oldestSessionId !== undefined) sessionSubjectCache.delete(oldestSessionId);
  }
}
