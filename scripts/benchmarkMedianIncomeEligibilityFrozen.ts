/**
 * Frozen-snapshot before/after measurement for the Phase 3 median-income
 * (기준중위소득) eligibility work, comparing the pre-Phase-3 baseline commit
 * 796d7a0e5174f759db29a198aaa576b7921b7652 against the current
 * wip/median-income-phase3 implementation.
 *
 * Mirrors scripts/benchmarkFamilyEligibilityFrozen.ts's frozen-fetch pattern
 * exactly (see that file for the full rationale): both "before" and "after"
 * invocations load the SAME frozen /tmp/mois_serviceList_full.json,
 * /tmp/mois_supportConditions_full.json, /tmp/youth_policy_full.json files —
 * no live network call either way — so the two runs are evaluated against
 * byte-identical input data and the only variable is the code.
 *
 * ---------------------------------------------------------------------------
 * REAL PROVIDERS ONLY — never MockBenefitProvider
 * ---------------------------------------------------------------------------
 * Same guard pattern as benchmarkFamilyEligibilityFrozen.ts: dummy,
 * non-secret env values activate real-provider registration in
 * providers/index.ts, installFrozenFetch() intercepts every network call
 * with the frozen snapshots, and assertRealCatalog() aborts loudly rather
 * than silently reporting Mock-fallback numbers.
 *
 * At the baseline commit (796d7a0), median_income_threshold does not exist
 * as an operator at all (Phase 3 hadn't started) — extractEligibilityFromText
 * never emits it, and classifyDimension has no median-income-specific
 * branch (median-income rules simply never appear as `income`-dimension
 * necessary rules there). Every median-income-specific metric below is
 * feature-detected and reported as `null` (not 0) on that commit rather than
 * guessed.
 *
 * Usage:
 *   1. Snapshots already frozen at /tmp/mois_serviceList_full.json,
 *      /tmp/mois_supportConditions_full.json, /tmp/youth_policy_full.json.
 *   2. Run against the baseline (from a worktree checked out at 796d7a0):
 *        BENCHMARK_LABEL=before npx tsx scripts/benchmarkMedianIncomeEligibilityFrozen.ts
 *      Run against current (from this repo, on wip/median-income-phase3):
 *        BENCHMARK_LABEL=after  npx tsx scripts/benchmarkMedianIncomeEligibilityFrozen.ts
 *   3. Diff:
 *        npx tsx scripts/benchmarkMedianIncomeEligibilityFrozen.ts --diff
 *
 * No .env.local needed either way — this script never depends on the real
 * MOIS_API_KEY / YOUTH_POLICY_API_KEY being present.
 */
import fs from "fs";
import type { MOISRawServiceListItem, MOISRawSupportCondition } from "../adapters/mois/MOISAdapter";
import type { YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { extractEligibilityFromText } from "../lib/eligibility/extraction/koreanEligibilityParser";
import * as candidateIndexModule from "../lib/eligibility/candidateIndex";
import { evaluateRule } from "../lib/eligibility/ruleEngine";
import { matchBenefitsDetailed, isRelevantForFeed } from "../domain/eligibility/matchBenefits";
import { MOISBenefitProvider } from "../providers/MOISBenefitProvider";
import { YouthCenterBenefitProvider } from "../providers/YouthCenterBenefitProvider";
import type { Benefit, EligibilityRule, EligibilityStatus } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_SERVICE_LIST_SNAPSHOT = "/tmp/mois_serviceList_full.json";
const MOIS_SUPPORT_CONDITIONS_SNAPSHOT = "/tmp/mois_supportConditions_full.json";
const YOUTH_POLICY_SNAPSHOT = "/tmp/youth_policy_full.json";

const DUMMY_MOIS_KEY = "benchmark-dummy-mois-key-not-real";
const DUMMY_YOUTH_KEY = "benchmark-dummy-youth-key-not-real";

const MIN_SANE_PROVIDER_COUNT = 300;
const MIN_SANE_MERGED_COUNT = 500;

// ---------------------------------------------------------------------------
// Profiles A-E (Part 9 spec): cumulative richness, household-income data
// (the fields median_income_threshold rules actually key off) added last.
// Plain object literals with no UserProfile type annotation — this script
// intentionally runs unmodified against a commit whose UserProfile shape may
// not declare householdIncomeBand; tsx only transpiles (no type-checking),
// so this is safe at runtime on either commit.
// ---------------------------------------------------------------------------
function profileA() {
  return { birthDate: "1995-06-15" };
}
function profileB() {
  return { ...profileA(), residence: { province: "경기도", city: "이천시" } };
}
function profileC() {
  return { ...profileB(), householdSize: 4 };
}
function profileD() {
  return { ...profileC(), householdIncomeBand: "3000_4000" };
}
function profileE() {
  return {
    ...profileD(),
    individualIncomeBand: "2000_3000",
    employmentStatus: "employed",
    educationStatus: "university",
    housingType: "jeonse",
    homeowner: false,
    businessOwner: false,
    smeEmployee: true,
    maritalStatus: "married",
    childrenCount: 2,
    interests: ["housing", "employment"],
  };
}

const PROFILES: { label: string; profile: Record<string, unknown> }[] = [
  { label: "A (age only)", profile: profileA() },
  { label: "B (+region)", profile: profileB() },
  { label: "C (+householdSize)", profile: profileC() },
  { label: "D (+householdIncomeBand)", profile: profileD() },
  { label: "E (rich profile)", profile: profileE() },
];

/** Strips household-income fields from a profile (median-income-attributable pruning comparison). */
function stripMedianIncomeFields(profile: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...profile };
  delete stripped.householdIncomeBand;
  delete stripped.annualHouseholdIncome;
  return stripped;
}

/**
 * Monkey-patches globalThis.fetch so MOISBenefitProvider and
 * YouthCenterBenefitProvider instead serve paginated responses built from
 * the frozen snapshot files, matching each provider's real response
 * envelope. Identical to installFrozenFetch in
 * scripts/benchmarkFamilyEligibilityFrozen.ts.
 */
function installFrozenFetch(): () => void {
  const moisServiceList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_SNAPSHOT, "utf8"));
  const moisSupportConditions: MOISRawSupportCondition[] = JSON.parse(
    fs.readFileSync(MOIS_SUPPORT_CONDITIONS_SNAPSHOT, "utf8")
  );
  const youthPolicies: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_POLICY_SNAPSHOT, "utf8"));

  const originalFetch = globalThis.fetch;

  function paginate<T>(all: T[], page: number, perPage: number): T[] {
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage);
  }

  const frozenFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

    if (url.startsWith("https://api.odcloud.kr/api/gov24/v3/serviceList")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page") ?? "1");
      const perPage = Number(u.searchParams.get("perPage") ?? "1000");
      const data = paginate(moisServiceList, page, perPage);
      const body = { data, totalCount: moisServiceList.length, currentCount: data.length, matchCount: moisServiceList.length, page, perPage };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.startsWith("https://api.odcloud.kr/api/gov24/v3/supportConditions")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page") ?? "1");
      const perPage = Number(u.searchParams.get("perPage") ?? "1000");
      const data = paginate(moisSupportConditions, page, perPage);
      const body = { data, totalCount: moisSupportConditions.length, currentCount: data.length, matchCount: moisSupportConditions.length, page, perPage };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.startsWith("https://www.youthcenter.go.kr/go/ythip/getPlcy")) {
      const u = new URL(url);
      const pageNum = Number(u.searchParams.get("pageNum") ?? "1");
      const pageSize = Number(u.searchParams.get("pageSize") ?? "1000");
      const youthPolicyList = paginate(youthPolicies, pageNum, pageSize);
      const body = {
        resultCode: 200,
        resultMessage: "OK",
        result: { pagging: { totCount: youthPolicies.length, pageNum, pageSize }, youthPolicyList },
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error(`[benchmarkMedianIncomeEligibilityFrozen] Unexpected live fetch during frozen-snapshot run: ${url}`);
  };

  globalThis.fetch = frozenFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function main() {
  const label = process.argv.includes("--diff") ? "diff" : process.env.BENCHMARK_LABEL;

  if (label === "diff") {
    const before = JSON.parse(fs.readFileSync("/tmp/median-income-benchmark-frozen-before.json", "utf8"));
    const after = JSON.parse(fs.readFileSync("/tmp/median-income-benchmark-frozen-after.json", "utf8"));

    console.log("\n=== [FROZEN SNAPSHOT, REAL PROVIDERS] Catalog composition: before vs after ===");
    console.table([
      { metric: "moisNormalizedCount", before: before.catalog.moisNormalizedCount, after: after.catalog.moisNormalizedCount },
      { metric: "youthNormalizedCount", before: before.catalog.youthNormalizedCount, after: after.catalog.youthNormalizedCount },
      { metric: "sourceCatalogCount (merged)", before: before.catalog.sourceCatalogCount, after: after.catalog.sourceCatalogCount },
      { metric: "activeCount", before: before.catalog.activeCount, after: after.catalog.activeCount },
      { metric: "dateUnknownCount", before: before.catalog.dateUnknownCount, after: after.catalog.dateUnknownCount },
      { metric: "expiredCount", before: before.catalog.expiredCount, after: after.catalog.expiredCount },
      { metric: "upcomingCount", before: before.catalog.upcomingCount, after: after.catalog.upcomingCount },
      { metric: "personalizableCount", before: before.catalog.personalizableCount, after: after.catalog.personalizableCount },
    ]);

    console.log("\n=== [FROZEN SNAPSHOT] MOIS median-income structured-rule extraction coverage: before vs after ===");
    console.table([
      { metric: "catalogCount (serviceList rows)", before: before.extraction.catalogCount, after: after.extraction.catalogCount },
      { metric: "recordsWithMedianIncomeRule", before: before.extraction.recordsWithMedianIncomeRule, after: after.extraction.recordsWithMedianIncomeRule },
      { metric: "totalMedianIncomeRules", before: before.extraction.totalMedianIncomeRules, after: after.extraction.totalMedianIncomeRules },
    ]);

    console.log("\n=== [FROZEN SNAPSHOT, REAL PROVIDERS] Candidate retrieval + full matching funnel: before vs after (per profile) ===");
    for (const p of Object.keys(before.profiles)) {
      const b = before.profiles[p];
      const a = after.profiles[p];
      console.log(`\n-- ${p} --`);
      console.table([
        { metric: "personalizableCatalogCount", before: b.personalizableCatalogCount, after: a.personalizableCatalogCount },
        { metric: "candidateCount", before: b.candidateCount, after: a.candidateCount },
        { metric: "retrievalWorkCount (indexed+fallback)", before: b.retrievalWorkCount, after: a.retrievalWorkCount },
        { metric: "indexedLookupCount", before: b.indexedLookupCount, after: a.indexedLookupCount },
        { metric: "fallbackScanCount", before: b.fallbackScanCount, after: a.fallbackScanCount },
        { metric: "detailedEvaluationCount", before: b.detailedEvaluationCount, after: a.detailedEvaluationCount },
        { metric: "relevantCount", before: b.relevantCount, after: a.relevantCount },
        { metric: "likelyEligibleCount", before: b.likelyEligibleCount, after: a.likelyEligibleCount },
        { metric: "unknownRelevantCount", before: b.unknownRelevantCount, after: a.unknownRelevantCount },
        { metric: "notEligibleAfterDetailedEvaluationCount", before: b.notEligibleAfterDetailedEvaluationCount, after: a.notEligibleAfterDetailedEvaluationCount },
        { metric: "zeroPositiveEvidenceExcludedCount", before: b.zeroPositiveEvidenceExcludedCount, after: a.zeroPositiveEvidenceExcludedCount },
        { metric: "ms", before: b.ms.toFixed(3), after: a.ms.toFixed(3) },
        { metric: "medianIncomeAttributableCandidateDelta", before: b.medianIncomeAttributableCandidateDelta, after: a.medianIncomeAttributableCandidateDelta },
        { metric: "medianIncomeRuleFailsCount", before: b.medianIncomeRuleFailsCount, after: a.medianIncomeRuleFailsCount },
        { metric: "positiveMedianIncomeEvidenceCount", before: b.positiveMedianIncomeEvidenceCount, after: a.positiveMedianIncomeEvidenceCount },
        { metric: "mismatchCount (optimized vs full-scan)", before: b.mismatchCount, after: a.mismatchCount },
      ]);
    }

    const ageOnlyKey = Object.keys(before.profiles).find((k) => k.startsWith("A "));
    if (ageOnlyKey) {
      const b = before.profiles[ageOnlyKey].candidateCount;
      const a = after.profiles[ageOnlyKey].candidateCount;
      console.log(
        `\n[invariant check] age-only profile candidateCount: before=${b} after=${a} -> ${b === a ? "IDENTICAL (expected)" : "DIFFERENT (needs justification)"}`
      );
    }

    const totalMismatchesBefore = Object.values(before.profiles as Record<string, { mismatchCount: number }>).reduce((s, p) => s + p.mismatchCount, 0);
    const totalMismatchesAfter = Object.values(after.profiles as Record<string, { mismatchCount: number }>).reduce((s, p) => s + p.mismatchCount, 0);
    console.log(`\n[equivalence check] total optimized-vs-full-scan mismatches across all 5 profiles: before=${totalMismatchesBefore} after=${totalMismatchesAfter}`);
    return;
  }

  if (label !== "before" && label !== "after") {
    throw new Error("Set BENCHMARK_LABEL=before|after, or pass --diff");
  }

  for (const f of [MOIS_SERVICE_LIST_SNAPSHOT, MOIS_SUPPORT_CONDITIONS_SNAPSHOT, YOUTH_POLICY_SNAPSHOT]) {
    if (!fs.existsSync(f)) throw new Error(`Missing frozen snapshot ${f} — freeze it once before running before/after.`);
  }

  process.env.MOIS_API_KEY = DUMMY_MOIS_KEY;
  process.env.YOUTH_POLICY_API_KEY = DUMMY_YOUTH_KEY;

  console.log(`[${label}] Loading frozen MOIS snapshot from disk (no live fetch)...`);
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_SNAPSHOT, "utf8"));
  console.log(`[${label}] MOIS serviceList: ${moisRawList.length} rows (frozen)`);

  // =========================================================================
  // Section: structured median-income-rule extraction coverage, computed
  // directly via the REAL (this-commit's) extractEligibilityFromText over
  // the frozen MOIS text — no provider/network involved either way.
  // =========================================================================
  let recordsWithMedianIncomeRule = 0;
  let totalMedianIncomeRules = 0;
  for (const raw of moisRawList) {
    let recordHasRule = false;
    for (const text of [raw.지원대상, raw.선정기준]) {
      const extracted = extractEligibilityFromText("median-income-benchmark", text);
      for (const rule of extracted.rules as EligibilityRule[]) {
        if (rule.operator === "median_income_threshold") {
          recordHasRule = true;
          totalMedianIncomeRules++;
        }
      }
    }
    if (recordHasRule) recordsWithMedianIncomeRule++;
  }
  const extraction = { catalogCount: moisRawList.length, recordsWithMedianIncomeRule, totalMedianIncomeRules };
  console.log(`[${label}] median-income extraction coverage (frozen snapshot):`, extraction);

  // =========================================================================
  // Section: REAL provider catalogs (never MockBenefitProvider), real merged
  // catalog, real candidate index, real indexed retrieval + full matching
  // pipeline (matchBenefitsDetailed / isRelevantForFeed — the exact
  // production functions app/api/benefits/match/route.ts uses).
  // =========================================================================
  const restoreFetch = installFrozenFetch();
  console.log(`[${label}] Fetching MOIS + Youth catalogs directly via the real provider classes (fetch mocked to frozen snapshot)...`);

  const moisProvider = new MOISBenefitProvider();
  const youthProvider = new YouthCenterBenefitProvider();
  const [moisBenefits, youthBenefits] = await Promise.all([moisProvider.getBenefits(), youthProvider.getBenefits()]);
  console.log(`[${label}] MOIS normalized: ${moisBenefits.length}, Youth normalized: ${youthBenefits.length}`);

  console.log(`[${label}] Building merged catalog + candidate index (real providers, fetch mocked to frozen snapshot)...`);
  const { getCatalogWithCandidateIndex } = await import("../providers/index");
  const catalog = await getCatalogWithCandidateIndex();
  restoreFetch();

  function assertRealCatalog() {
    if (moisBenefits.length < MIN_SANE_PROVIDER_COUNT) {
      throw new Error(
        `[assertRealCatalog] MOIS normalized count (${moisBenefits.length}) is suspiciously low (< ${MIN_SANE_PROVIDER_COUNT}) — MockBenefitProvider fallback or a real regression is suspected. Aborting rather than reporting bogus numbers.`
      );
    }
    if (youthBenefits.length < MIN_SANE_PROVIDER_COUNT) {
      throw new Error(
        `[assertRealCatalog] Youth normalized count (${youthBenefits.length}) is suspiciously low (< ${MIN_SANE_PROVIDER_COUNT}) — MockBenefitProvider fallback or a real regression is suspected. Aborting rather than reporting bogus numbers.`
      );
    }
    if (catalog.counts.sourceCatalogCount < MIN_SANE_MERGED_COUNT) {
      throw new Error(
        `[assertRealCatalog] Merged sourceCatalogCount (${catalog.counts.sourceCatalogCount}) is suspiciously low (< ${MIN_SANE_MERGED_COUNT}) — MockBenefitProvider fallback or a real regression is suspected. Aborting rather than reporting bogus numbers.`
      );
    }
    const allCatalogBenefits: Benefit[] = [...catalog.benefits, ...catalog.expiredBenefits, ...catalog.upcomingBenefits];
    const demoBenefit = allCatalogBenefits.find((b) => b.isDemo === true);
    if (demoBenefit) {
      throw new Error(
        `[assertRealCatalog] Found isDemo:true benefit (id=${demoBenefit.id}) in a run that is supposed to use ONLY real MOIS/Youth providers — MockBenefitProvider fallback is suspected. Aborting rather than reporting bogus numbers.`
      );
    }
  }
  assertRealCatalog();

  const catalogSummary = {
    moisNormalizedCount: moisBenefits.length,
    youthNormalizedCount: youthBenefits.length,
    sourceCatalogCount: catalog.counts.sourceCatalogCount,
    activeCount: catalog.counts.activeCount,
    dateUnknownCount: catalog.counts.dateUnknownCount,
    expiredCount: catalog.counts.expiredCount,
    upcomingCount: catalog.counts.upcomingCount,
    personalizableCount: catalog.benefits.length,
  };
  console.log(`[${label}] catalog summary (real providers, verified non-demo):`, catalogSummary);

  const index = catalog.index as unknown as Record<string, unknown>;
  const mod = candidateIndexModule as unknown as Record<string, unknown>;

  const classifyDimension = mod.classifyDimension as ((rule: EligibilityRule) => string) | undefined;
  const getCandidateBenefitsWithDiagnostics = mod.getCandidateBenefitsWithDiagnostics as (
    index: unknown,
    profile: unknown
  ) => { candidates: Benefit[]; diagnostics: { indexedLookupCount: number; fallbackScanCount: number; finalCandidateCount: number } };
  const getCandidateBenefitsFullScan = mod.getCandidateBenefitsFullScan as (
    index: unknown,
    profile: unknown
  ) => { id: string }[];

  // Feature detection: does this commit's constrainedByDimension actually
  // contain any median_income_threshold-classified necessary rule at all?
  // (classifyDimension itself exists at both commits since "income" already
  // existed pre-Phase-3 for annualHouseholdIncome/etc — but at baseline no
  // rule ever has operator "median_income_threshold", so this is always 0
  // there rather than a hard feature-absence.)
  const constrainedByDimensionProbe = index.constrainedByDimension as
    | Map<string, { necessaryRules: EligibilityRule[] }[]>
    | undefined;
  let hasMedianIncomeRules = false;
  if (constrainedByDimensionProbe) {
    const incomeEntries = constrainedByDimensionProbe.get("income") ?? [];
    hasMedianIncomeRules = incomeEntries.some((e) =>
      e.necessaryRules.some((r) => r.operator === "median_income_threshold")
    );
  }

  const profileResults: Record<string, unknown> = {};
  for (const { label: pLabel, profile } of PROFILES) {
    const t0 = performance.now();
    const { candidates, diagnostics } = getCandidateBenefitsWithDiagnostics(index, profile);
    const ms = performance.now() - t0;

    const fullScanCandidates = getCandidateBenefitsFullScan(index, profile);
    const idsIndexed = new Set(candidates.map((b: { id: string }) => b.id));
    const idsFullScan = new Set(fullScanCandidates.map((b: { id: string }) => b.id));
    const mismatchCount =
      [...idsIndexed].filter((id) => !idsFullScan.has(id)).length +
      [...idsFullScan].filter((id) => !idsIndexed.has(id)).length;

    const detailed = matchBenefitsDetailed(candidates as Benefit[], profile as UserProfile);
    let likelyEligibleCount = 0;
    let relevantCount = 0;
    let unknownRelevantCount = 0;
    let notEligibleAfterDetailedEvaluationCount = 0;
    let zeroPositiveEvidenceExcludedCount = 0;
    for (const m of detailed) {
      const status = m.status as EligibilityStatus;
      if (status === "likely_eligible") likelyEligibleCount++;
      if (status === "not_eligible") notEligibleAfterDetailedEvaluationCount++;
      const relevant = isRelevantForFeed(status, m.hasPositiveEvidence);
      if (relevant) {
        relevantCount++;
        if (status === "unknown") unknownRelevantCount++;
      } else if (status === "unknown") {
        zeroPositiveEvidenceExcludedCount++;
      }
    }

    // -----------------------------------------------------------------
    // Median-income-attributable pruning: compare candidate retrieval for
    // the SAME profile with vs. without householdIncomeBand/
    // annualHouseholdIncome. Since every other field is identical, any
    // benefit present without-median-income but absent with-median-income
    // was necessarily excluded by a rule that only resolves to "fail" once
    // household-income data is present.
    // -----------------------------------------------------------------
    let medianIncomeAttributableCandidateDelta: number | null = null;
    let medianIncomeRuleFailsCount: number | null = null;
    let positiveMedianIncomeEvidenceCount: number | null = null;
    if (hasMedianIncomeRules && classifyDimension && constrainedByDimensionProbe) {
      const noMedianIncomeProfile = stripMedianIncomeFields(profile);
      const { candidates: noMIcandidates } = getCandidateBenefitsWithDiagnostics(index, noMedianIncomeProfile);
      const idsNoMI = new Set(noMIcandidates.map((b: { id: string }) => b.id));
      medianIncomeAttributableCandidateDelta = idsNoMI.size - idsIndexed.size;

      const incomeEntries = (constrainedByDimensionProbe.get("income") ?? []) as {
        benefit: { id: string };
        necessaryRules: EligibilityRule[];
      }[];
      const medianIncomeEntries = incomeEntries.filter((e) =>
        e.necessaryRules.some((r) => r.operator === "median_income_threshold")
      );
      medianIncomeRuleFailsCount = medianIncomeEntries.filter((e) =>
        e.necessaryRules.some(
          (rule) => rule.operator === "median_income_threshold" && evaluateRule(rule, profile as UserProfile) === "fail"
        )
      ).length;
      positiveMedianIncomeEvidenceCount = medianIncomeEntries.filter((e) => {
        if (!idsIndexed.has(e.benefit.id)) return false;
        return e.necessaryRules.some(
          (rule) => rule.operator === "median_income_threshold" && evaluateRule(rule, profile as UserProfile) === "pass"
        );
      }).length;
    }

    profileResults[pLabel] = {
      personalizableCatalogCount: catalog.benefits.length,
      candidateCount: diagnostics.finalCandidateCount,
      retrievalWorkCount: diagnostics.indexedLookupCount + diagnostics.fallbackScanCount,
      indexedLookupCount: diagnostics.indexedLookupCount,
      fallbackScanCount: diagnostics.fallbackScanCount,
      detailedEvaluationCount: detailed.length,
      relevantCount,
      likelyEligibleCount,
      unknownRelevantCount,
      notEligibleAfterDetailedEvaluationCount,
      zeroPositiveEvidenceExcludedCount,
      ms,
      medianIncomeAttributableCandidateDelta,
      medianIncomeRuleFailsCount,
      positiveMedianIncomeEvidenceCount,
      mismatchCount,
    };
    console.log(`[${label}] profile ${pLabel}:`, profileResults[pLabel]);
  }

  const out = { label, hasMedianIncomeRules, catalog: catalogSummary, extraction, profiles: profileResults };
  fs.writeFileSync(`/tmp/median-income-benchmark-frozen-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`[${label}] Written to /tmp/median-income-benchmark-frozen-${label}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
