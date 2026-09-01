import { NextResponse } from "next/server";
import { getCatalogWithCandidateIndex } from "@/providers";
import { getCandidateBenefits } from "@/lib/eligibility/candidateIndex";
import { matchBenefitsDetailed, isRelevantForFeed } from "@/domain/eligibility/matchBenefits";
import { searchBenefits } from "@/domain/benefit/search";
import { sortBenefits, type BenefitSort } from "@/domain/benefit/sort";
import { getSourceGroup, type BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import { getBenefitSummary, type BenefitSummary } from "@/domain/benefit/summary";
import { getRecommendedBenefits } from "@/domain/benefit/recommend";
import { getUnknownBenefits } from "@/domain/benefit/unknownBenefits";
import { parseUserProfile } from "@/lib/validation/profileSchema";
import type { UserProfile } from "@/types/profile";
import type { Benefit, BenefitCategory, EligibilityStatus } from "@/types/benefit";

/** How many benefits the bounded home-summary preview sends in each bucket (section 20: never the full relevant set). */
const HOME_PREVIEW_LIMIT = 10;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

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
  let body: MatchRequestBody;
  try {
    body = (await request.json()) as MatchRequestBody;
  } catch {
    body = {};
  }

  const parsed = parseUserProfile(body?.profile ?? body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  }
  const profile = parsed.data as UserProfile;

  try {
    const { benefits: personalizable, index, expiredBenefits, expiredIndex, counts: catalogCounts } =
      await getCatalogWithCandidateIndex();
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
    for (const m of detailed) {
      statusById.set(m.benefitId, m.status);
      positiveEvidenceById.set(m.benefitId, m.hasPositiveEvidence);
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
      const summary: BenefitSummary = getBenefitSummary(relevant, statusById);
      const recommended = getRecommendedBenefits(relevant, statusById, profile, HOME_PREVIEW_LIMIT);
      const needsReview = getUnknownBenefits(relevant, statusById, HOME_PREVIEW_LIMIT);
      const previewStatuses: Record<string, EligibilityStatus> = {};
      for (const b of [...recommended, ...needsReview]) previewStatuses[b.id] = statusById.get(b.id) ?? "unknown";
      return NextResponse.json({ counts, summary, recommended, needsReview, statuses: previewStatuses });
    }

    let filtered = relevant;
    if (typeof body.search === "string" && body.search.trim()) {
      filtered = searchBenefits(filtered, body.search);
    }
    if (body.group && body.group !== "all") {
      filtered = filtered.filter((b) => getSourceGroup(b) === body.group);
    }
    if (body.category && body.category !== "all") {
      filtered = filtered.filter((b) => b.category === body.category);
    }
    filtered = sortBenefits(filtered, statusById, profile, body.sort ?? "recommended");

    const pageSize = Math.min(Math.max(Math.trunc(Number(body.pageSize)) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = Math.max(Math.trunc(Number(body.page)) || 1, 1);
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const start = (page - 1) * pageSize;
    const pageBenefits = filtered.slice(start, start + pageSize);

    const statuses: Record<string, EligibilityStatus> = {};
    for (const b of pageBenefits) statuses[b.id] = statusById.get(b.id) ?? "unknown";

    return NextResponse.json({ benefits: pageBenefits, statuses, page, pageSize, total, totalPages, counts });
  } catch (err) {
    console.error("[POST /api/benefits/match] Failed to compute matches:", err);
    return NextResponse.json({ error: "Failed to compute matches" }, { status: 500 });
  }
}
