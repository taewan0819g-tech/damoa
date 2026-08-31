import type { Benefit } from "@/types/benefit";
import type { EligibilityRuleGroup } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { memoizeAsync } from "@/lib/cache/memoizeAsync";
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
 * to the client.
 *
 * Both `serviceList` and `supportConditions` are paginated to their real
 * end (up to MAX_PAGES * PER_PAGE records) rather than being capped at an
 * arbitrary first page, so records beyond the old 500-record cutoff are
 * discoverable. `supportConditions` has no per-ID filter usable for a bulk
 * lookup, so it's paginated once into a full `서비스ID -> EligibilityRuleGroup`
 * map and shared by both `getBenefits()` and `getBenefit()` — this avoids an
 * N+1 fetch per benefit. Both the catalog and the conditions map are cached
 * in-process for CACHE_MS via `memoizeAsync`.
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

/** Fully paginates an odcloud list endpoint, stopping at MAX_PAGES or when the API signals no more data. */
async function fetchAllPages<T>(path: string, key: string, label: string): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const res = await fetch(`${BASE_URL}${path}?page=${page}&perPage=${PER_PAGE}`, {
        headers: authHeaders(key),
      });
      if (!res.ok) {
        console.error(`[MOISBenefitProvider] ${label} HTTP ${res.status} on page ${page}`);
        break;
      }
      const json = (await res.json()) as ODCloudListResponse<T>;
      results.push(...json.data);
      if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
    } catch (err) {
      console.error(`[MOISBenefitProvider] Failed to fetch ${label} page ${page}:`, err);
      break;
    }
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

const getCachedCatalog = memoizeAsync(buildCatalog, CACHE_MS);
const getCachedConditionsMap = memoizeAsync(buildConditionsMap, CACHE_MS);

export class MOISBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return [];
    try {
      return await getCachedCatalog(key);
    } catch (err) {
      console.error("[MOISBenefitProvider] Failed to build catalog:", err);
      return [];
    }
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return null;
    const serviceId = id.startsWith("mois-") ? id.slice("mois-".length) : id;

    try {
      const detailRes = await fetch(condEqUrl("/serviceDetail", "서비스ID", serviceId), {
        headers: authHeaders(key),
      });
      if (!detailRes.ok) {
        console.error(`[MOISBenefitProvider] serviceDetail HTTP ${detailRes.status} for ${serviceId}`);
        return null;
      }
      const detailJson = (await detailRes.json()) as ODCloudListResponse<MOISRawServiceDetail>;
      const raw = detailJson.data[0];
      if (!raw) return null;

      let eligibility: EligibilityRuleGroup | undefined;
      try {
        const conditionsMap = await getCachedConditionsMap(key);
        eligibility = conditionsMap.get(serviceId);
      } catch (err) {
        console.error(`[MOISBenefitProvider] Failed to resolve eligibility for ${serviceId}:`, err);
      }

      return normalizeMOISServiceDetail(raw, eligibility);
    } catch (err) {
      console.error(`[MOISBenefitProvider] Failed to fetch serviceDetail for ${serviceId}:`, err);
      return null;
    }
  }
}
