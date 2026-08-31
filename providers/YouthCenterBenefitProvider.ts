import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { memoizeAsync } from "@/lib/cache/memoizeAsync";
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
 * YOUTH_POLICY_API_KEY is never bundled to the client.
 *
 * The catalog is fully paginated (not capped at a single page) and cached
 * in-process via `memoizeAsync`, so records beyond the old cutoff are
 * discoverable and repeated requests don't re-hit the upstream API.
 * `getBenefit()` resolves from that same cached catalog instead of doing a
 * live per-ID fetch — the old live per-ID `getPlcy?plcyNo=` call returned
 * `lclsfNm`/`mclsfNm` as null in filtered mode, which broke category
 * mapping; reading from the already-normalized cached catalog sidesteps
 * that bug entirely.
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

async function fetchAllYouthPolicies(key: string): Promise<YouthRawPolicy[]> {
  const results: YouthRawPolicy[] = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    try {
      const url = buildUrl(key, { pageNum: String(pageNum), pageSize: String(PAGE_SIZE) });
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[YouthCenterBenefitProvider] getPlcy HTTP ${res.status} on page ${pageNum}`);
        break;
      }
      const json = (await res.json()) as YouthApiResponse;
      if (json.resultCode !== 200) {
        console.error(
          `[YouthCenterBenefitProvider] getPlcy returned resultCode ${json.resultCode}: ${json.resultMessage}`
        );
        break;
      }
      const list = json.result?.youthPolicyList ?? [];
      const totCount = json.result?.pagging?.totCount ?? 0;
      results.push(...list);
      if (list.length < PAGE_SIZE || pageNum * PAGE_SIZE >= totCount) break;
    } catch (err) {
      console.error(`[YouthCenterBenefitProvider] Failed to fetch getPlcy page ${pageNum}:`, err);
      break;
    }
  }
  return results;
}

async function buildCatalog(key: string): Promise<Benefit[]> {
  const rawList = await fetchAllYouthPolicies(key);
  return rawList.map(normalizeYouthPolicy);
}

const getCachedCatalog = memoizeAsync(buildCatalog, CACHE_MS);

export class YouthCenterBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return [];
    try {
      return await getCachedCatalog(key);
    } catch (err) {
      console.error("[YouthCenterBenefitProvider] Failed to build catalog:", err);
      return [];
    }
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return null;

    try {
      const catalog = await getCachedCatalog(key);
      return catalog.find((b) => b.id === id) ?? null;
    } catch (err) {
      console.error(`[YouthCenterBenefitProvider] Failed to resolve ${id} from catalog:`, err);
      return null;
    }
  }
}

export type { YouthRawPolicy };
