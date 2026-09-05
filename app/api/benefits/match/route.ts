import { NextResponse } from "next/server";
import { getCatalogWithCandidateIndex, getProviderHealth } from "@/providers";
import { getCandidateBenefits } from "@/lib/eligibility/candidateIndex";
import { matchBenefitsDetailed, isRelevantForFeed } from "@/domain/eligibility/matchBenefits";
import type { PersonalizationEvidence } from "@/domain/benefit/personalization";
import { searchBenefits } from "@/domain/benefit/search";
import { sortBenefits, type BenefitSort } from "@/domain/benefit/sort";
import { getSourceGroup, type BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import { getBenefitSummary, type BenefitSummary } from "@/domain/benefit/summary";
import { getRecommendedBenefits, countRecommendableBenefits } from "@/domain/benefit/recommend";
import { getUnknownBenefits } from "@/domain/benefit/unknownBenefits";
import { matchesBenefitFacet } from "@/domain/benefit/topics";
import { parseUserProfile } from "@/lib/validation/profileSchema";
import { logger } from "@/lib/log/logger";
import type { UserProfile } from "@/types/profile";
import type { Benefit, BenefitCategory, EligibilityStatus } from "@/types/benefit";

/** How many benefits the bounded home-summary preview sends in each bucket (section 20: never the full relevant set). */
const HOME_PREVIEW_LIMIT = 10;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Phase 5 (Production Stabilization) §18 defensive-validation caps. This
 * endpoint is public and unauthenticated, so cheap, unconditionally-applied
 * shape/size limits guard against absurd payloads without needing to know
 * the eventual deployment topology (a real distributed rate limiter is a
 * separate, later concern once the hosting platform is chosen — see the
 * Phase 5 report).
 */
const MAX_SEARCH_LENGTH = 200;
/** Generously covers a UserProfile + filters; rejects wildly oversized bodies before they're even parsed as JSON. */
const MAX_BODY_BYTES = 100_000;

interface MatchRequestBody {
  profile?: unknown;
  page?: number;
  pageSize?: number;
  search?: string;
  group?: BenefitSourceGroup | "all";
  category?: BenefitCategory | "all";
  sort?: BenefitSort;
  /** Opt-in: include benefits whose application window has already closed. Defaults to excluded. */
  includeClosed?: boolean;
}

interface MatchCounts {
  likelyEligible: number;
  unknown: number;
  notEligible: number;
  totalEvaluated: number;
  /**
   * Benefits excluded from the personalized feed entirely — either an
   * "unknown" with zero evidence (nothing was ever compared against the
   * profile, so it's uninformative for every user alike) or a closed
   * benefit filtered out by default. Kept separate from `notEligible` so
   * `likelyEligible + unknown + notEligible + excluded` always accounts
   * for every benefit in the catalog.
   */
  excluded: number;
  /**
   * How many catalog records were actually run through the full
   * deterministic rule engine (evaluateEligibilityDetailed) for this
   * request — i.e. `totalEvaluated` minus however many were already
   * conservatively pruned by the candidate index because a verified
   * necessary rule definitively failed. Exposed for observability into the
   * candidate-retrieval layer; not required by any client behavior.
   */
  candidatesEvaluated: number;
  /**
   * Active-catalog observability (section 27 of the constraint-
   * compatibility spec): how the source catalog was classified BEFORE
   * candidate retrieval ever ran, so it's visible how much work the
   * date-based prefilter already avoided. `activeCatalogCount +
   * dateUnknownCatalogCount` is exactly `candidatesEvaluated +
   * (pruned-by-candidate-index)` — i.e. the personalizable set this
   * request's index was built from. `expiredCatalogCount` never entered
   * candidate retrieval or the rule engine unless `includeClosed: true`.
   */
  activeCatalogCount: number;
  dateUnknownCatalogCount: number;
  expiredCatalogCount: number;
  upcomingCatalogCount: number;
}

function countByStatus(benefits: Benefit[], statusById: Map<string, EligibilityStatus>, status: EligibilityStatus): number {
  return benefits.reduce((n, b) => n + (statusById.get(b.id) === status ? 1 : 0), 0);
}

/**
 * Server-only personalized matching endpoint. Takes the caller's profile,
 * loads the full benefit catalog via the provider layer (fully paginated,
 * server-side cached — see MOISBenefitProvider/YouthCenterBenefitProvider),
 * and evaluates eligibility for every benefit using the same rule engine
 * the rest of the app relies on.
 *
 * IMPORTANT: this endpoint intentionally does NOT return the full catalog
 * or any not_eligible Benefit objects to the browser. It only returns
 * "relevant" benefits (see `isRelevantForFeed`): definite matches, plus
 * "unknown" results actually backed by verified POSITIVE evidence against
 * the profile (`hasPositiveEvidence` — see ruleEngine.ts; a benefit whose
 * only resolved rule FAILED is not positive evidence, even though something
 * was technically checked). An "unknown" with zero positive evidence is
 * uninformative for every user alike and is excluded from the personalized
 * feed, same as a definite not_eligible.
 *
 * Also does NOT run the full rule engine over the entire catalog, and does
 * NOT run it over expired records at all by default. The catalog is fetched
 * already split by application-window state (see providers/index.ts +
 * lib/catalog/activeCatalog.ts): `benefits` is ACTIVE + DATE_UNKNOWN only —
 * EXPIRED records never reach candidate retrieval or the rule engine unless
 * the caller explicitly opts in with `includeClosed: true`, in which case
 * they're pulled from a separate `expiredIndex`/`expiredBenefits` pair and
 * evaluated the same way. `getCandidateBenefits` then conservatively prunes
 * only the benefits with a *verified necessary* rule that *definitely*
 * conflicts with the profile (e.g. a hard age range or region requirement
 * the profile clearly fails) — anything uncertain is kept. Only the
 * surviving candidates are run through the full deterministic rule engine
 * (`matchBenefitsDetailed`). Flow:
 *   MOIS/Youth refresh -> normalize -> classify active/expired/upcoming/date_unknown
 *   -> candidate index (built once per catalog refresh)
 *   -> UserProfile -> candidate retrieval -> rule engine -> relevance filter
 *   -> pagination/preview -> client.
 *
 * Two response shapes, chosen by whether `page`/`pageSize` is present:
 *  - Without them: a bounded home-summary shape `{ counts, summary,
 *    recommended, needsReview }` — `recommended`/`needsReview` are capped at
 *    `HOME_PREVIEW_LIMIT` records each (never the full relevant set, which
 *    can be in the thousands; the home page only ever displays a handful).
 *    `summary` carries the aggregate card counts (source-group breakdown,
 *    closing-soon count) computed server-side over the FULL relevant set so
 *    the client never needs that full set just to derive them. Used by the
 *    home page via useMatchedBenefits.
 *  - With `page`/`pageSize`: a paginated `{ benefits, statuses, page,
 *    pageSize, total, totalPages, counts }` shape that also applies
 *    server-side `search`, `group`, `category`, and `sort` over the relevant
 *    set before paging — used by the benefits listing page, via
 *    usePaginatedBenefits.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    logger.warn("request_error", { route: "benefits/match", reason: "payload_too_large", contentLength });
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  let body: MatchRequestBody;
  try {
    body = (await request.json()) as MatchRequestBody;
  } catch {
    body = {};
  }

  if (typeof body.search === "string" && body.search.length > MAX_SEARCH_LENGTH) {
    return NextResponse.json({ error: `search must be at most ${MAX_SEARCH_LENGTH} characters` }, { status: 400 });
  }

  const parsed = parseUserProfile(body?.profile ?? body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  }
  const profile = parsed.data as UserProfile;

  try {
    // Cold-start fix: attempt the catalog load FIRST. This is what actually
    // causes each provider's resilientCache to perform its first refresh if
    // it hasn't run yet (see providers/*BenefitProvider.ts -> getBenefits()
    // -> catalogCache.get()). Checking provider health BEFORE this point
    // would read every never-yet-attempted provider as "unavailable" and
    // return a false 503 on a fresh process's very first request, even when
    // the provider is perfectly healthy and simply hasn't been asked yet --
    // the first refresh would then never even be attempted. `status` now
    // distinguishes "uninitialized" (never attempted) from "unavailable"
    // (attempted and failed with nothing to fall back to) -- see
    // lib/cache/resilientCache.ts -- but checking AFTER this await also
    // guarantees every registered provider has been attempted by the time
    // we look, so the ambiguity can't even arise here.
    const { benefits: personalizable, index, expiredBenefits, expiredIndex, counts: catalogCounts } =
      await getCatalogWithCandidateIndex();

    // Fail fast with 503 only when EVERY registered provider is unavailable
    // AFTER actually having attempted to load (no last-known-good data
    // anywhere) -- an EMPTY health array must NOT be treated as "all down"
    // (vacuous-truth guard; MockBenefitProvider is always registered as a
    // fallback and reports "healthy", so this only trips when real
    // providers are configured but genuinely have no usable data at all
    // even after trying, e.g. a first-ever refresh failure with nothing
    // cached). If one provider succeeded and another failed, this check
    // passes and matching proceeds using whichever provider(s) have usable
    // data -- the merged catalog already reflects that (see
    // providers/index.ts's Promise.allSettled-based provider isolation).
    const healths = getProviderHealth();
    if (healths.length > 0 && healths.every((h) => h.status === "unavailable")) {
      logger.error("request_error", {
        route: "benefits/match",
        reason: "all_providers_unavailable",
        providerCount: healths.length,
      });
      return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
    }

    const includeClosed = body.includeClosed === true;

    // Step 1: candidate retrieval. Conservative — only removes benefits
    // with a verified necessary rule that definitively fails the profile.
    // These pruned-out records are guaranteed not_eligible had they gone
    // through the full engine (a failing required rule inside an all-only
    // path always fails the whole tree), so they're safe to count as
    // notEligible without actually evaluating them. EXPIRED records are
    // excluded from `personalizable` entirely (see providers/index.ts), so
    // by default this request never even builds a candidate list for them;
    // `includeClosed: true` pulls them back in via the separate, equally
    // conservative `expiredIndex`.
    const activeCandidates = getCandidateBenefits(index, profile);
    let prunedCount = personalizable.length - activeCandidates.length;
    let workingCandidates = activeCandidates;
    if (includeClosed) {
      const expiredCandidates = getCandidateBenefits(expiredIndex, profile);
      prunedCount += expiredBenefits.length - expiredCandidates.length;
      workingCandidates = [...activeCandidates, ...expiredCandidates];
    }

    // Step 2: full deterministic rule engine, only over the candidates.
    const detailed = matchBenefitsDetailed(workingCandidates, profile);
    const statusById = new Map<string, EligibilityStatus>();
    const positiveEvidenceById = new Map<string, boolean>();
    // Precomputed once here so the home preview (recommended/needsReview)
    // and the paginated `sort=recommended` path never re-run the rule
    // engine per benefit just to derive ranking evidence.
    const evidenceById = new Map<string, PersonalizationEvidence>();
    for (const m of detailed) {
      statusById.set(m.benefitId, m.status);
      positiveEvidenceById.set(m.benefitId, m.hasPositiveEvidence);
      evidenceById.set(m.benefitId, m.personalization);
    }

    // Step 3: personalized relevance filtering. UPCOMING benefits are
    // always excluded from the default feed (reserved for a future
    // "opening soon" feature — see activeCatalog.ts); EXPIRED benefits are
    // excluded the same way unless `includeClosed` pulled them into
    // `workingCandidates` above, in which case they flow through this same
    // per-benefit relevance check like any other candidate.
    let notEligibleCount = prunedCount;
    let excludedCount = catalogCounts.upcomingCount + (includeClosed ? 0 : catalogCounts.expiredCount);
    const relevant: Benefit[] = [];
    for (const benefit of workingCandidates) {
      const status = statusById.get(benefit.id) ?? "unknown";
      const hasPositiveEvidence = positiveEvidenceById.get(benefit.id) ?? false;
      if (status === "not_eligible") {
        notEligibleCount += 1;
        continue;
      }
      if (!isRelevantForFeed(status, hasPositiveEvidence)) {
        excludedCount += 1; // unknown with zero *positive* evidence — uninformative, never shown
        continue;
      }
      relevant.push(benefit);
    }

    const counts: MatchCounts = {
      likelyEligible: countByStatus(relevant, statusById, "likely_eligible"),
      unknown: countByStatus(relevant, statusById, "unknown"),
      notEligible: notEligibleCount,
      excluded: excludedCount,
      totalEvaluated: catalogCounts.sourceCatalogCount,
      candidatesEvaluated: workingCandidates.length,
      activeCatalogCount: catalogCounts.activeCount,
      dateUnknownCatalogCount: catalogCounts.dateUnknownCount,
      expiredCatalogCount: catalogCounts.expiredCount,
      upcomingCatalogCount: catalogCounts.upcomingCount,
    };

    const isPaginated = typeof body.page === "number" || typeof body.pageSize === "number";

    if (!isPaginated) {
      // Bounded home-summary payload (section 20): the home page only ever
      // displays a handful of cards, so it must never receive the full
      // relevant set (which can be in the thousands). `summary` is
      // aggregated server-side over the full `relevant` array so the client
      // still gets accurate totals without receiving the array itself.
      const priorityCount = countRecommendableBenefits(relevant, statusById, profile, evidenceById);
      const summary: BenefitSummary = getBenefitSummary(relevant, statusById, priorityCount);
      const recommended = getRecommendedBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT, {
        evidenceById,
        excludeWeakUnknown: true,
      });
      const excludeIds = new Set(recommended.map((b) => b.id));
      const needsReview = getUnknownBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT, {
        excludeIds,
        evidenceById,
      });
      const previewStatuses: Record<string, EligibilityStatus> = {};
      for (const b of [...recommended, ...needsReview]) previewStatuses[b.id] = statusById.get(b.id) ?? "unknown";
      const durationMs = performance.now() - startedAt;
      logger.info("request_complete", { route: "benefits/match", shape: "summary", durationMs: Math.round(durationMs) });
      const res = NextResponse.json({ counts, summary, recommended, needsReview, statuses: previewStatuses });
      res.headers.set("Server-Timing", `total;dur=${durationMs.toFixed(1)}`);
      return res;
    }

    let filtered = relevant;
    if (typeof body.search === "string" && body.search.trim()) {
      filtered = searchBenefits(filtered, body.search);
    }
    if (body.group && body.group !== "all") {
      filtered = filtered.filter((b) => getSourceGroup(b) === body.group);
    }
    if (body.category && body.category !== "all") {
      const category = body.category;
      filtered = filtered.filter((b) => matchesBenefitFacet(b, category));
    }
    filtered = sortBenefits(filtered, statusById, profile, body.sort ?? "recommended", evidenceById);

    const pageSize = Math.min(Math.max(Math.trunc(Number(body.pageSize)) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = Math.max(Math.trunc(Number(body.page)) || 1, 1);
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const start = (page - 1) * pageSize;
    const pageBenefits = filtered.slice(start, start + pageSize);

    const statuses: Record<string, EligibilityStatus> = {};
    for (const b of pageBenefits) statuses[b.id] = statusById.get(b.id) ?? "unknown";

    const durationMs = performance.now() - startedAt;
    logger.info("request_complete", { route: "benefits/match", shape: "paginated", durationMs: Math.round(durationMs) });
    const res = NextResponse.json({ benefits: pageBenefits, statuses, page, pageSize, total, totalPages, counts });
    res.headers.set("Server-Timing", `total;dur=${durationMs.toFixed(1)}`);
    return res;
  } catch (err) {
    logger.error("request_error", {
      route: "benefits/match",
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to compute matches" }, { status: 500 });
  }
}
