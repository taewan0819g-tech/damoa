import type { Benefit } from "@/types/benefit";
import type { EligibilityRuleGroup } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import type { ProviderHealth } from "./health";
import { createResilientCache } from "@/lib/cache/resilientCache";
import { fetchJsonWithRetry } from "@/lib/http/httpClient";
import { logger } from "@/lib/log/logger";
import {
  normalizeMOISServiceListItem,
  normalizeMOISServiceDetail,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawServiceDetail,
  type MOISRawSupportCondition,
} from "@/adapters/mois/MOISAdapter";

/**
 * 행정안전부 "대한민국 공공서비스(혜택)" API (gov24/v3), hosted on
 * api.odcloud.kr. Confirmed live 2026-08-31 with a real service key:
 *   - GET /serviceList?page=&perPage=            (list, paginated)
 *   - GET /serviceDetail?page=1&perPage=1&cond[서비스ID::EQ]=<id>  (single record filter)
 *   - GET /supportConditions?page=&perPage=       (eligibility condition codes, paginated)
 * Auth: header `Authorization: Infuser <MOIS_API_KEY>`. This file only runs
 * server-side (imported by Route Handlers) — MOIS_API_KEY is never bundled
 * to the client, and is never included in any log line below.
 *
 * Both `serviceList` and `supportConditions` are paginated to their real
 * end (up to MAX_PAGES * PER_PAGE records) rather than being capped at an
 * arbitrary first page. `supportConditions` has no per-ID filter usable for
 * a bulk lookup, so it's paginated once into a full `서비스ID ->
 * EligibilityRuleGroup` map and shared by both `getBenefits()` and
 * `getBenefit()` — this avoids an N+1 fetch per benefit.
 *
 * Phase 5 (Production Stabilization) hardening:
 *  - `fetchAllPages` is now ATOMIC: any page failing after retries throws
 *    (never silently returns a partial catalog), and a received-count vs.
 *    declared-`totalCount` consistency check runs before the result is
 *    considered valid at all. A partial page fetch can therefore never leak
 *    into the cache.
 *  - Each page fetch goes through `fetchJsonWithRetry` (per-attempt timeout
 *    + bounded retry on transient failures only).
 *  - The catalog and conditions map are now cached via `resilientCache`
 *    (stale-if-error / last-known-good) instead of plain `memoizeAsync`, so
 *    a transient upstream failure serves the last good catalog instead of
 *    an empty one.
 *  - `getBenefit()` retains its live `serviceDetail` fetch (it carries
 *    genuinely richer fields than the list endpoint — `requiredDocuments`,
 *    `applicationUrl`, fuller `shortDescription`), but now falls back to the
 *    cached catalog's list-item representation of the same id if the live
 *    fetch fails, rather than returning `null` outright.
 */
const BASE_URL = "https://api.odcloud.kr/api/gov24/v3";

const PER_PAGE = 1000; // odcloud's documented max perPage
const MAX_PAGES = 30; // up to 30,000 records — comfortably covers the full catalog
const CACHE_MS = 3600_000;

interface ODCloudListResponse<T> {
  currentCount: number;
  data: T[];
  matchCount: number;
  page: number;
  perPage: number;
  totalCount: number;
}

function authHeaders(key: string): HeadersInit {
  return { Authorization: `Infuser ${key}` };
}

/** odcloud's filter syntax for exact-match lookups: cond[<필드명>::EQ]=<value>. A naive `?servId=` query param is silently ignored. */
function condEqUrl(path: string, field: string, value: string, extra = ""): string {
  const bracket = encodeURIComponent(`${field}::EQ`);
  return `${BASE_URL}${path}?page=1&perPage=1${extra}&cond%5B${bracket}%5D=${encodeURIComponent(value)}`;
}

/**
 * Fully paginates an odcloud list endpoint, stopping at MAX_PAGES or when
 * the API signals no more data. ATOMIC: throws (never returns a partial
 * result) if any page ultimately fails after retries, or if the total
 * number of records received doesn't match the upstream's declared
 * `totalCount`.
 */
async function fetchAllPages<T>(path: string, key: string, label: string): Promise<T[]> {
  const results: T[] = [];
  let declaredTotal: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await fetchJsonWithRetry<ODCloudListResponse<T>>(
      `${BASE_URL}${path}?page=${page}&perPage=${PER_PAGE}`,
      { headers: authHeaders(key) },
      { label: `MOIS ${label} page ${page}` }
    );
    results.push(...json.data);
    declaredTotal = json.totalCount;
    if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
  }

  if (declaredTotal !== null && results.length !== declaredTotal) {
    logger.error("provider_pagination_inconsistent", {
      provider: "mois",
      resource: label,
      received: results.length,
      declaredTotal,
    });
    throw new Error(
      `MOIS ${label} pagination inconsistent: received ${results.length} records but upstream declared totalCount=${declaredTotal}`
    );
  }

  return results;
}

async function buildConditionsMap(key: string): Promise<Map<string, EligibilityRuleGroup>> {
  const rows = await fetchAllPages<MOISRawSupportCondition>("/supportConditions", key, "supportConditions");
  const map = new Map<string, EligibilityRuleGroup>();
  for (const raw of rows) {
    const group = normalizeMOISSupportConditions(raw);
    if (group) map.set(raw.서비스ID, group);
  }
  return map;
}

async function buildCatalog(key: string): Promise<Benefit[]> {
  const [rawList, conditionsMap] = await Promise.all([
    fetchAllPages<MOISRawServiceListItem>("/serviceList", key, "serviceList"),
    buildConditionsMap(key),
  ]);
  return rawList.map((raw) => normalizeMOISServiceListItem(raw, conditionsMap.get(raw.서비스ID)));
}

function getRequiredApiKey(): string {
  const key = process.env.MOIS_API_KEY;
  if (!key) throw new Error("MOIS_API_KEY not configured");
  return key;
}

const catalogCache = createResilientCache(() => buildCatalog(getRequiredApiKey()), {
  ttlMs: CACHE_MS,
  label: "MOIS catalog",
});
const conditionsCache = createResilientCache(() => buildConditionsMap(getRequiredApiKey()), {
  ttlMs: CACHE_MS,
  label: "MOIS conditionsMap",
});

export class MOISBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return [];
    try {
      return await catalogCache.get();
    } catch (err) {
      logger.error("provider_unavailable", {
        provider: "mois",
        reason: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return null;
    const serviceId = id.startsWith("mois-") ? id.slice("mois-".length) : id;

    try {
      const detailJson = await fetchJsonWithRetry<ODCloudListResponse<MOISRawServiceDetail>>(
        condEqUrl("/serviceDetail", "서비스ID", serviceId),
        { headers: authHeaders(key) },
        { label: `MOIS serviceDetail ${serviceId}` }
      );
      const raw = detailJson.data[0];
      if (!raw) return null;

      let eligibility: EligibilityRuleGroup | undefined;
      try {
        const conditionsMap = await conditionsCache.get();
        eligibility = conditionsMap.get(serviceId);
      } catch (err) {
        logger.warn("provider_stale_fallback", {
          provider: "mois",
          detail: "conditionsMap unavailable while resolving serviceDetail eligibility",
          serviceId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      return normalizeMOISServiceDetail(raw, eligibility);
    } catch (err) {
      logger.warn("provider_refresh_failure", {
        provider: "mois",
        detail: "serviceDetail live fetch failed, attempting cached-catalog fallback",
        serviceId,
        reason: err instanceof Error ? err.message : String(err),
      });
      // Fall back to the cached catalog's list-item representation of this
      // id, if one is available -- better a slightly less-detailed benefit
      // than none at all when the live detail endpoint is down.
      try {
        const catalog = await catalogCache.get();
        const fallback = catalog.find((b) => b.id === id);
        if (fallback) return fallback;
      } catch {
        // No cached catalog available either -- fall through to null.
      }
      return null;
    }
  }

  getHealthStatus(): ProviderHealth {
    const key = process.env.MOIS_API_KEY;
    if (!key) {
      return {
        provider: "mois",
        configured: false,
        status: "unavailable",
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        ageMs: null,
      };
    }
    const diag = catalogCache.getDiagnostics();
    return { provider: "mois", configured: true, ...diag };
  }
}
