import { NextResponse } from "next/server";
import { getCatalogWithCandidateIndex } from "@/providers";
import { getCandidateBenefits } from "@/lib/eligibility/candidateIndex";
import { matchBenefitsDetailed, isRelevantForFeed } from "@/domain/eligibility/matchBenefits";
import { isClosed } from "@/domain/benefit/closed";
import { searchBenefits } from "@/domain/benefit/search";
import { sortBenefits, type BenefitSort } from "@/domain/benefit/sort";
import { getSourceGroup, type BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import { parseUserProfile } from "@/lib/validation/profileSchema";
import type { UserProfile } from "@/types/profile";
import type { Benefit, BenefitCategory, EligibilityStatus } from "@/types/benefit";

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
 * "unknown" results actually backed by real evidence against the profile.
 * An "unknown" with zero evidence (nothing was ever compared — e.g. a
 * benefit with no structured eligibility data at all) is uninformative for
 * every user alike and is excluded from the personalized feed, same as a
 * definite not_eligible. Benefits whose application window has already
 * closed are excluded by default too (see `isClosed`) — pass
 * `includeClosed: true` to opt back in.
 *
 * Also does NOT run the full rule engine over the entire catalog. The
 * catalog is fetched together with a precomputed `CandidateIndex` (see
 * providers/index.ts + lib/eligibility/candidateIndex.ts), which is built
 * once per catalog refresh, not per request. `getCandidateBenefits` first
 * conservatively prunes only the benefits with a *verified necessary* rule
 * that *definitely* conflicts with the profile (e.g. a hard age range or
 * region requirement the profile clearly fails) — anything uncertain is
 * kept. Only the surviving candidates are run through the full
 * deterministic rule engine (`matchBenefitsDetailed`). Flow:
 *   UserProfile -> candidate index -> rule engine -> relevance filter -> pagination -> client.
 *
 * Two response shapes, chosen by whether `page`/`pageSize` is present:
 *  - Without them: the original `{ likelyEligible, unknown, counts }` shape
 *    (backward compatible — used by the non-paginated default feed on the
 *    home page, via useMatchedBenefits).
 *  - With them: a paginated `{ benefits, statuses, page, pageSize, total,
 *    totalPages, counts }` shape that also applies server-side `search`,
 *    `group`, `category`, and `sort` over the relevant set before paging —
 *    used by the benefits listing page, via usePaginatedBenefits.
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
    const { benefits: allBenefits, index } = await getCatalogWithCandidateIndex();

    // Step 1: candidate retrieval. Conservative — only removes benefits
    // with a verified necessary rule that definitively fails the profile.
    // These pruned-out records are guaranteed not_eligible had they gone
    // through the full engine (a failing required rule inside an all-only
    // path always fails the whole tree), so they're safe to count as
    // notEligible without actually evaluating them.
    const candidates = getCandidateBenefits(index, profile);
    const prunedCount = allBenefits.length - candidates.length;

    // Step 2: full deterministic rule engine, only over the candidates.
    const detailed = matchBenefitsDetailed(candidates, profile);
    const statusById = new Map<string, EligibilityStatus>();
    const evidenceById = new Map<string, boolean>();
    for (const m of detailed) {
      statusById.set(m.benefitId, m.status);
      evidenceById.set(m.benefitId, m.hasEvidence);
    }

    const includeClosed = body.includeClosed === true;

    // Step 3: personalized relevance filtering.
    let notEligibleCount = prunedCount;
    let excludedCount = 0;
    const relevant: Benefit[] = [];
    for (const benefit of candidates) {
      const status = statusById.get(benefit.id) ?? "unknown";
      const hasEvidence = evidenceById.get(benefit.id) ?? false;
      if (status === "not_eligible") {
        notEligibleCount += 1;
        continue;
      }
      if (!isRelevantForFeed(status, hasEvidence)) {
        excludedCount += 1; // unknown with zero evidence — uninformative, never shown
        continue;
      }
      if (!includeClosed && isClosed(benefit)) {
        excludedCount += 1;
        continue;
      }
      relevant.push(benefit);
    }

    const counts: MatchCounts = {
      likelyEligible: countByStatus(relevant, statusById, "likely_eligible"),
      unknown: countByStatus(relevant, statusById, "unknown"),
      notEligible: notEligibleCount,
      excluded: excludedCount,
      totalEvaluated: allBenefits.length,
      candidatesEvaluated: candidates.length,
    };

    const isPaginated = typeof body.page === "number" || typeof body.pageSize === "number";

    if (!isPaginated) {
      const likelyEligible = relevant.filter((b) => statusById.get(b.id) === "likely_eligible");
      const unknown = relevant.filter((b) => statusById.get(b.id) === "unknown");
      return NextResponse.json({ likelyEligible, unknown, counts });
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
