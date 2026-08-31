import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
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
 *   - GET /supportConditions?page=1&perPage=1&cond[서비스ID::EQ]=<id> (eligibility condition codes)
 * Auth: header `Authorization: Infuser <MOIS_API_KEY>`. This file only runs
 * server-side (imported by Route Handlers) — MOIS_API_KEY is never bundled
 * to the client.
 */
const BASE_URL = "https://api.odcloud.kr/api/gov24/v3";

// odcloud allows perPage up to 1000, but we cap total records fetched per
// request to keep server response times reasonable for an MVP. Increase this
// (or add real pagination/caching) once the list view needs the full catalog.
const PER_PAGE = 100;
const MAX_PAGES = 5; // 500 records
const CACHE_SECONDS = 3600;

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

export class MOISBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return [];

    const results: Benefit[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const res = await fetch(`${BASE_URL}/serviceList?page=${page}&perPage=${PER_PAGE}`, {
          headers: authHeaders(key),
          next: { revalidate: CACHE_SECONDS },
        });
        if (!res.ok) {
          console.error(`[MOISBenefitProvider] serviceList HTTP ${res.status} on page ${page}`);
          break;
        }
        const json = (await res.json()) as ODCloudListResponse<MOISRawServiceListItem>;
        for (const raw of json.data) {
          results.push(normalizeMOISServiceListItem(raw));
        }
        if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
      } catch (err) {
        console.error("[MOISBenefitProvider] Failed to fetch serviceList:", err);
        break;
      }
    }
    return results;
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.MOIS_API_KEY;
    if (!key) return null;
    const serviceId = id.startsWith("mois-") ? id.slice("mois-".length) : id;

    try {
      const detailRes = await fetch(condEqUrl("/serviceDetail", "서비스ID", serviceId), {
        headers: authHeaders(key),
        next: { revalidate: CACHE_SECONDS },
      });
      if (!detailRes.ok) {
        console.error(`[MOISBenefitProvider] serviceDetail HTTP ${detailRes.status} for ${serviceId}`);
        return null;
      }
      const detailJson = (await detailRes.json()) as ODCloudListResponse<MOISRawServiceDetail>;
      const raw = detailJson.data[0];
      if (!raw) return null;

      let eligibility;
      try {
        const condRes = await fetch(condEqUrl("/supportConditions", "서비스ID", serviceId), {
          headers: authHeaders(key),
          next: { revalidate: CACHE_SECONDS },
        });
        if (condRes.ok) {
          const condJson = (await condRes.json()) as ODCloudListResponse<MOISRawSupportCondition>;
          if (condJson.data[0]) eligibility = normalizeMOISSupportConditions(condJson.data[0]);
        }
      } catch (err) {
        console.error(`[MOISBenefitProvider] Failed to fetch supportConditions for ${serviceId}:`, err);
      }

      return normalizeMOISServiceDetail(raw, eligibility);
    } catch (err) {
      console.error(`[MOISBenefitProvider] Failed to fetch serviceDetail for ${serviceId}:`, err);
      return null;
    }
  }
}
