import type { Benefit } from "@/types/benefit";
import type { BenefitProvider } from "./BenefitProvider";
import { MockBenefitProvider } from "./MockBenefitProvider";
import { MOISBenefitProvider } from "./MOISBenefitProvider";
import { YouthCenterBenefitProvider } from "./YouthCenterBenefitProvider";
import { hasHealthStatus, type ProviderHealth } from "./health";
import { buildCandidateIndex, type CandidateIndex } from "@/lib/eligibility/candidateIndex";
import { classifyCatalog, type ClassifiedCatalog } from "@/lib/catalog/activeCatalog";
import { logger } from "@/lib/log/logger";

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

function providerLabel(provider: BenefitProvider): string {
  return hasHealthStatus(provider) ? provider.getHealthStatus().provider : provider.constructor.name;
}

/**
 * Provider isolation (Phase 5 §9): every concrete provider already catches
 * its own upstream errors internally and resolves to `[]` rather than
 * rejecting (see MOISBenefitProvider/YouthCenterBenefitProvider), so one
 * provider failing never by itself throws here. `Promise.allSettled` is
 * still used (rather than `Promise.all`) as defense-in-depth against any
 * provider that doesn't follow that contract (e.g. a future provider, or
 * MockBenefitProvider's synchronous validation throw) — a single rejected
 * provider degrades to an empty contribution and is logged, while every
 * other provider's results are merged normally.
 */
async function getMergedBenefits(): Promise<Benefit[]> {
  const settled = await Promise.allSettled(providers.map((p) => p.getBenefits()));
  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    logger.error("provider_unavailable", {
      provider: providerLabel(providers[i]),
      reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    });
    return [];
  });
  if (mergedCache && sameInputs(mergedCache.inputs, results)) {
    return mergedCache.merged;
  }
  const merged = results.flat();
  mergedCache = { inputs: results, merged };
  return merged;
}

/**
 * Per-provider health/diagnostics (Phase 5 §17/§18), never includes secret
 * values. Used by `GET /api/health` and by the match route to decide
 * whether the merged catalog is usable at all (see §11's vacuous-truth
 * guard at the call site: an EMPTY array here must never be treated as "all
 * providers are down").
 */
export function getProviderHealth(): ProviderHealth[] {
  return providers
    .filter((p): p is BenefitProvider & { getHealthStatus(): ProviderHealth } => hasHealthStatus(p))
    .map((p) => p.getHealthStatus());
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

// Application-window classification (see lib/catalog/activeCatalog.ts) also
// runs once per catalog refresh, never per request — same reference-
// stability trick as `getMergedBenefits` above. This is what lets
// personalized retrieval skip expired records BEFORE candidate retrieval
// and detailed evaluation ever run over them, instead of fetching
// everything and filtering closed records out afterward.
let classificationCache: { catalogRef: Benefit[]; classified: ClassifiedCatalog; personalizable: Benefit[] } | undefined;

function getClassification(benefits: Benefit[]): { classified: ClassifiedCatalog; personalizable: Benefit[] } {
  if (classificationCache && classificationCache.catalogRef === benefits) {
    return classificationCache;
  }
  const classified = classifyCatalog(benefits);
  // The personalizable set is ACTIVE + DATE_UNKNOWN: a missing/malformed
  // deadline must never be treated as expired (see activeCatalog.ts).
  // EXPIRED is excluded here entirely; UPCOMING is excluded from the
  // default personalized set too (reserved for a future "곧 신청 가능"
  // feature) but both remain available via `classified` for an explicit
  // archive/opt-in path.
  const personalizable = [...classified.active, ...classified.dateUnknown];
  classificationCache = { catalogRef: benefits, classified, personalizable };
  return classificationCache;
}

// Candidate index (see lib/eligibility/candidateIndex.ts) is expensive-ish
// to build (one O(catalog size) pass extracting verified-necessary rules)
// but cheap to reuse, and must NOT be rebuilt on every personalized
// request. It's rebuilt only when its input array reference actually
// changes (i.e. some provider's cache refreshed, which cascades into a new
// classification and thus a new personalizable-array reference) — reusing
// the same reference-stability trick as `getMergedBenefits` above. A second,
// symmetric cache does the same for the (usually much smaller) EXPIRED set,
// used only by the opt-in `includeClosed` archive path.
let indexCache: { catalogRef: Benefit[]; index: CandidateIndex } | undefined;
let expiredIndexCache: { catalogRef: Benefit[]; index: CandidateIndex } | undefined;

export interface CatalogCounts {
  sourceCatalogCount: number;
  activeCount: number;
  upcomingCount: number;
  expiredCount: number;
  dateUnknownCount: number;
}

export interface CatalogWithIndex {
  /** ACTIVE + DATE_UNKNOWN benefits — the personalizable set candidate retrieval/evaluation runs over. */
  benefits: Benefit[];
  /** Candidate index built over `benefits` only (never includes EXPIRED). */
  index: CandidateIndex;
  /** EXPIRED benefits, for the explicit `includeClosed` archive opt-in only — never part of the default feed. */
  expiredBenefits: Benefit[];
  /** Candidate index built over `expiredBenefits`, for the same opt-in path. */
  expiredIndex: CandidateIndex;
  /** UPCOMING benefits — not open yet; reserved for a future "opening soon" feature, not surfaced today. */
  upcomingBenefits: Benefit[];
  counts: CatalogCounts;
}

/**
 * Returns the personalizable catalog (ACTIVE + DATE_UNKNOWN) plus a
 * candidate index built over it, rebuilding classification/indexes only
 * when the underlying catalog has actually changed since the last call.
 * This is the entry point personalized-matching routes should use instead
 * of calling `benefitProvider.getBenefits()` + building an index themselves
 * — it also guarantees EXPIRED records never reach candidate retrieval or
 * the full rule engine for a normal (non-archive) request.
 */
export async function getCatalogWithCandidateIndex(): Promise<CatalogWithIndex> {
  const merged = await getMergedBenefits();
  const { classified, personalizable } = getClassification(merged);

  if (!indexCache || indexCache.catalogRef !== personalizable) {
    indexCache = { catalogRef: personalizable, index: buildCandidateIndex(personalizable) };
  }
  if (!expiredIndexCache || expiredIndexCache.catalogRef !== classified.expired) {
    expiredIndexCache = { catalogRef: classified.expired, index: buildCandidateIndex(classified.expired) };
  }

  return {
    benefits: personalizable,
    index: indexCache.index,
    expiredBenefits: classified.expired,
    expiredIndex: expiredIndexCache.index,
    upcomingBenefits: classified.upcoming,
    counts: {
      sourceCatalogCount: merged.length,
      activeCount: classified.active.length,
      upcomingCount: classified.upcoming.length,
      expiredCount: classified.expired.length,
      dateUnknownCount: classified.dateUnknown.length,
    },
  };
}

export type { BenefitProvider };
