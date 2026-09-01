import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { MockBenefitProvider } from "./MockBenefitProvider";
import { MOISBenefitProvider } from "./MOISBenefitProvider";
import { YouthCenterBenefitProvider } from "./YouthCenterBenefitProvider";
import { buildCandidateIndex, type CandidateIndex } from "@/lib/eligibility/candidateIndex";

// This module is only ever imported by server-side code (Route Handlers) —
// see app/api/benefits/route.ts and app/api/benefits/[id]/route.ts. Real
// providers read MOIS_API_KEY / YOUTH_POLICY_API_KEY directly from
// process.env and never expose them to the client.
//
// Real providers are registered only when their API key is actually
// configured. MockBenefitProvider is a development fallback used only when
// NO real key is configured at all — once any real key is present, mock
// data is excluded entirely so production results are never mixed with demo
// data (a provider whose key is missing/broken simply contributes 0 records
// rather than being backfilled with mock data).
const realProviders: BenefitProvider[] = [];
if (process.env.MOIS_API_KEY) realProviders.push(new MOISBenefitProvider());
if (process.env.YOUTH_POLICY_API_KEY) realProviders.push(new YouthCenterBenefitProvider());

const providers: BenefitProvider[] = realProviders.length > 0 ? realProviders : [new MockBenefitProvider()];

// `Array.prototype.flat()` always allocates a brand-new array, so naively
// merging `providers.map(p => p.getBenefits())` on every call would hand
// back a different array *reference* every single request even though each
// underlying provider's own catalog is itself cached (memoizeAsync) and
// unchanged. That reference churn matters: the candidate index below (and
// anything else that wants to cache "derived from the current catalog"
// data) needs a stable reference to know whether the catalog actually
// changed. This small cache keeps the merged array identity stable across
// requests for as long as every input provider array is unchanged, and only
// reallocates when at least one provider's cache actually refreshed.
let mergedCache: { inputs: Benefit[][]; merged: Benefit[] } | undefined;

function sameInputs(a: Benefit[][], b: Benefit[][]): boolean {
  return a.length === b.length && a.every((arr, i) => arr === b[i]);
}

async function getMergedBenefits(): Promise<Benefit[]> {
  const results = await Promise.all(providers.map((p) => p.getBenefits()));
  if (mergedCache && sameInputs(mergedCache.inputs, results)) {
    return mergedCache.merged;
  }
  const merged = results.flat();
  mergedCache = { inputs: results, merged };
  return merged;
}

/** Aggregates every registered BenefitProvider into a single unified list. */
export const benefitProvider: BenefitProvider = {
  getBenefits: getMergedBenefits,
  async getBenefit(id: string): Promise<Benefit | null> {
    for (const provider of providers) {
      const found = await provider.getBenefit(id);
      if (found) return found;
    }
    return null;
  },
};

// Candidate index (see lib/eligibility/candidateIndex.ts) is expensive-ish
// to build (one O(catalog size) pass extracting verified-necessary rules)
// but cheap to reuse, and must NOT be rebuilt on every personalized
// request. It's rebuilt only when the merged catalog reference actually
// changes (i.e. some provider's cache refreshed) — reusing the same
// reference-stability trick as `getMergedBenefits` above.
let indexCache: { catalogRef: Benefit[]; index: CandidateIndex } | undefined;

/**
 * Returns the full catalog plus a candidate index built over it, rebuilding
 * the index only when the catalog itself has actually changed since the
 * last call. This is the entry point personalized-matching routes should
 * use instead of calling `benefitProvider.getBenefits()` + building an
 * index themselves.
 */
export async function getCatalogWithCandidateIndex(): Promise<{ benefits: Benefit[]; index: CandidateIndex }> {
  const benefits = await getMergedBenefits();
  if (!indexCache || indexCache.catalogRef !== benefits) {
    indexCache = { catalogRef: benefits, index: buildCandidateIndex(benefits) };
  }
  return { benefits, index: indexCache.index };
}

export type { BenefitProvider };
