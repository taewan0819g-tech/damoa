import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import type { ProviderHealth } from "./health";
import { createResilientCache } from "@/lib/cache/resilientCache";
import { fetchJsonWithRetry } from "@/lib/http/httpClient";
import { logger } from "@/lib/log/logger";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";

/**
 * 온통청년(Youth Center) Open API integration.
 *
 * The endpoint documented on the site's own docs page
 * (youthcenter.go.kr/opi/youthPlcyList.do) is dead — confirmed via curl, it
 * 302-redirects to an unreachable internal host regardless of parameters.
 * The working endpoint, confirmed live 2026-08-31 with a real key, is:
 *   GET https://www.youthcenter.go.kr/go/ythip/getPlcy
 *     ?apiKeyNm=<key>&pageNum=&pageSize=&pageType=1&rtnType=json[&plcyNo=<id>]
 * Response envelope: { resultCode, resultMessage, result: { pagging, youthPolicyList } }.
 * This file only runs server-side (imported by Route Handlers) —
 * YOUTH_POLICY_API_KEY is never bundled to the client, and is never
 * included in any log line below.
 *
 * `getBenefit()` resolves from the same cached catalog instead of doing a
 * live per-ID fetch — the old live per-ID `getPlcy?plcyNo=` call returned
 * `lclsfNm`/`mclsfNm` as null in filtered mode, which broke category
 * mapping; reading from the already-normalized cached catalog sidesteps
 * that bug entirely.
 *
 * Phase 5 (Production Stabilization) hardening: same ATOMIC-pagination +
 * resilient (stale-if-error) cache + timeout/retry treatment as
 * MOISBenefitProvider — see that file's doc comment for the shared
 * rationale.
 */
const BASE_URL = "https://www.youthcenter.go.kr/go/ythip/getPlcy";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // up to 20,000 records — comfortably covers the full catalog
const CACHE_MS = 3600_000;

interface YouthApiResponse {
  resultCode: number;
  resultMessage: string;
  result?: {
    pagging?: { totCount: number; pageNum: number; pageSize: number };
    youthPolicyList?: YouthRawPolicy[];
  };
}

function buildUrl(key: string, params: Record<string, string>): string {
  const search = new URLSearchParams({ apiKeyNm: key, pageType: "1", rtnType: "json", ...params });
  return `${BASE_URL}?${search.toString()}`;
}

/**
 * Fully paginates the getPlcy endpoint. ATOMIC: throws (never returns a
 * partial result) on an HTTP/network failure that exhausts retries, on a
 * non-200 `resultCode` (a deterministic API-level failure, not retried —
 * matches the previous behavior of stopping immediately on a bad result
 * code), or when the total number of records received doesn't match the
 * upstream's declared `totCount`.
 */
async function fetchAllYouthPolicies(key: string): Promise<YouthRawPolicy[]> {
  const results: YouthRawPolicy[] = [];
  let declaredTotal: number | null = null;

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = buildUrl(key, { pageNum: String(pageNum), pageSize: String(PAGE_SIZE) });
    const json = await fetchJsonWithRetry<YouthApiResponse>(url, undefined, {
      label: `Youth getPlcy page ${pageNum}`,
    });

    if (json.resultCode !== 200) {
      throw new Error(`Youth getPlcy returned resultCode ${json.resultCode}: ${json.resultMessage}`);
    }

    const list = json.result?.youthPolicyList ?? [];
    const totCount = json.result?.pagging?.totCount ?? 0;
    results.push(...list);
    declaredTotal = totCount;
    if (list.length < PAGE_SIZE || pageNum * PAGE_SIZE >= totCount) break;
  }

  if (declaredTotal !== null && results.length !== declaredTotal) {
    logger.error("provider_pagination_inconsistent", {
      provider: "youth-center",
      resource: "getPlcy",
      received: results.length,
      declaredTotal,
    });
    throw new Error(
      `Youth getPlcy pagination inconsistent: received ${results.length} records but upstream declared totCount=${declaredTotal}`
    );
  }

  return results;
}

async function buildCatalog(key: string): Promise<Benefit[]> {
  const rawList = await fetchAllYouthPolicies(key);
  return rawList.map(normalizeYouthPolicy);
}

function getRequiredApiKey(): string {
  const key = process.env.YOUTH_POLICY_API_KEY;
  if (!key) throw new Error("YOUTH_POLICY_API_KEY not configured");
  return key;
}

const catalogCache = createResilientCache(() => buildCatalog(getRequiredApiKey()), {
  ttlMs: CACHE_MS,
  label: "Youth catalog",
  count: (benefits) => benefits.length,
});

export class YouthCenterBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return [];
    try {
      return await catalogCache.get();
    } catch (err) {
      logger.error("provider_unavailable", {
        provider: "youth-center",
        reason: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return null;

    try {
      const catalog = await catalogCache.get();
      return catalog.find((b) => b.id === id) ?? null;
    } catch (err) {
      logger.error("provider_unavailable", {
        provider: "youth-center",
        detail: `Failed to resolve ${id} from catalog`,
        reason: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  getHealthStatus(): ProviderHealth {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) {
      return {
        provider: "youth-center",
        configured: false,
        status: "unavailable",
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        ageMs: null,
        isStale: false,
        refreshInFlight: false,
        currentCatalogCount: null,
      };
    }
    const diag = catalogCache.getDiagnostics();
    return {
      provider: "youth-center",
      configured: true,
      status: diag.status,
      lastAttemptAt: diag.lastAttemptAt,
      lastSuccessAt: diag.lastSuccessAt,
      lastFailureAt: diag.lastFailureAt,
      lastError: diag.lastError,
      ageMs: diag.ageMs,
      isStale: diag.status === "stale",
      refreshInFlight: diag.refreshInFlight,
      currentCatalogCount: diag.currentCount,
    };
  }
}

export type { YouthRawPolicy };
