import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
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
 */
const BASE_URL = "https://www.youthcenter.go.kr/go/ythip/getPlcy";
const PAGE_SIZE = 500; // caps total records fetched per request, mirrors MOISBenefitProvider's cap
const CACHE_SECONDS = 3600;

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

export class YouthCenterBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return [];

    try {
      const url = buildUrl(key, { pageNum: "1", pageSize: String(PAGE_SIZE) });
      const res = await fetch(url, { next: { revalidate: CACHE_SECONDS } });
      if (!res.ok) {
        console.error(`[YouthCenterBenefitProvider] getPlcy HTTP ${res.status}`);
        return [];
      }
      const json = (await res.json()) as YouthApiResponse;
      if (json.resultCode !== 200) {
        console.error(`[YouthCenterBenefitProvider] getPlcy returned resultCode ${json.resultCode}: ${json.resultMessage}`);
        return [];
      }
      const list = json.result?.youthPolicyList ?? [];
      return list.map(normalizeYouthPolicy);
    } catch (err) {
      console.error("[YouthCenterBenefitProvider] Failed to fetch getPlcy:", err);
      return [];
    }
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return null;
    const plcyNo = id.startsWith("youth-") ? id.slice("youth-".length) : id;

    try {
      const url = buildUrl(key, { pageNum: "1", pageSize: "1", plcyNo });
      const res = await fetch(url, { next: { revalidate: CACHE_SECONDS } });
      if (!res.ok) {
        console.error(`[YouthCenterBenefitProvider] getPlcy detail HTTP ${res.status} for ${plcyNo}`);
        return null;
      }
      const json = (await res.json()) as YouthApiResponse;
      if (json.resultCode !== 200) return null;
      const raw = json.result?.youthPolicyList?.[0];
      return raw ? normalizeYouthPolicy(raw) : null;
    } catch (err) {
      console.error(`[YouthCenterBenefitProvider] Failed to fetch getPlcy detail for ${plcyNo}:`, err);
      return null;
    }
  }
}

export type { YouthRawPolicy };
