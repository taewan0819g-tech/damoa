import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";

/**
 * 온통청년(Youth Center) Open API integration.
 *
 * STATUS (2026-08-31): the only documented endpoint is currently
 * unreachable — see adapters/youthCenter/YouthAdapter.ts for the full
 * investigation. This class still makes a real, server-side HTTP request
 * (using YOUTH_POLICY_API_KEY, never exposed to the client) on every call so
 * the integration is genuinely wired up and will start working the moment
 * the endpoint/spec is fixed or updated — it does not fabricate data in the
 * meantime. On any failure it logs a clear diagnostic and returns an empty
 * result instead of silently substituting mock data.
 */
const ENDPOINT = "https://www.youthcenter.go.kr/opi/youthPlcyList.do";

export class YouthCenterBenefitProvider implements BenefitProvider {
  async getBenefits(): Promise<Benefit[]> {
    const key = process.env.YOUTH_POLICY_API_KEY;
    if (!key) return [];

    try {
      const url = `${ENDPOINT}?openApiVlak=${encodeURIComponent(key)}&pageIndex=1&display=100`;
      const res = await fetch(url, { next: { revalidate: 3600 }, redirect: "manual" });

      if (res.status >= 300 && res.status < 400) {
        console.error(
          `[YouthCenterBenefitProvider] ${ENDPOINT} redirected (HTTP ${res.status}) to an unreachable host — the documented endpoint appears to be decommissioned. Returning no youth-policy records.`
        );
        return [];
      }
      if (!res.ok) {
        console.error(`[YouthCenterBenefitProvider] youthPlcyList.do HTTP ${res.status}`);
        return [];
      }

      // Response schema is not confirmed (see YouthAdapter.ts) — we can't
      // safely parse XML/JSON into records without guessing field names, so
      // normalizeYouthPolicy always returns null for now.
      const raw: YouthRawPolicy[] = [];
      return raw.map(normalizeYouthPolicy).filter((b): b is Benefit => b !== null);
    } catch (err) {
      console.error("[YouthCenterBenefitProvider] Failed to reach youthPlcyList.do:", err);
      return [];
    }
  }

  async getBenefit(): Promise<Benefit | null> {
    // No confirmed single-policy detail endpoint or response schema yet.
    return null;
  }
}

export type { YouthRawPolicy };
