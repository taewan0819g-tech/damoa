/**
 * Frozen-snapshot before/after measurement for the Phase 2 marital/family
 * eligibility work (marriageDate, singleParentFamily, multiculturalFamily,
 * marriage_duration_within, and the candidateIndex `family` dimension),
 * comparing the pre-Phase-2 baseline commit b8e5f24c82219f28faea44a397bcac875ff39b21
 * against the current wip/family-phase2 implementation.
 *
 * Mirrors scripts/benchmarkRegionExtractionFrozen.ts's frozen-fetch pattern
 * exactly (see that file for the full rationale): both "before" and "after"
 * invocations load the SAME frozen /tmp/mois_serviceList_full.json,
 * /tmp/mois_supportConditions_full.json, /tmp/youth_policy_full.json files —
 * no live network call either way — so the two runs are evaluated against
 * byte-identical input data and the only variable is the code.
 *
 * ---------------------------------------------------------------------------
 * REAL PROVIDERS ONLY — never MockBenefitProvider (2026-09 correctness fix)
 * ---------------------------------------------------------------------------
 * providers/index.ts only registers MOISBenefitProvider/YouthCenterBenefitProvider
 * when process.env.MOIS_API_KEY / YOUTH_POLICY_API_KEY are truthy AT MODULE
 * IMPORT TIME; otherwise it silently falls back to MockBenefitProvider
 * (~53 demo records, several flagged isDemo:true). An earlier run of this
 * script via plain `npx tsx` (no env file) silently hit that fallback and
 * reported ~30 "personalizable" records — nowhere close to the real MOIS +
 * Youth catalog (thousands of records).
 *
 * Fix: before ever importing providers/index.ts, this script sets
 * BENCHMARK-ONLY, NON-SECRET dummy values for both env vars — enough to
 * activate real-provider registration — and relies entirely on
 * `installFrozenFetch()` below to intercept every network call the real
 * providers make (both providers read their key from `process.env` on
 * every call, matching only URL prefixes, never inspecting the key/auth
 * header, so a dummy key is safe and never reaches a real server). This
 * NEVER reads or exposes the real secrets in .env.local. An explicit guard
 * (`assertRealCatalog`) aborts the whole run if the resulting catalog is
 * suspiciously small or contains any `isDemo: true` record — i.e. if the
 * Mock fallback were ever silently hit again, this script now fails loudly
 * instead of reporting bogus numbers.
 *
 * This single script file is copied verbatim into a `git worktree` checked
 * out at the baseline commit and run there for "before" (that worktree's own
 * lib/eligibility/candidateIndex.ts, koreanEligibilityParser.ts, etc. — the
 * REAL unmodified baseline code, not a re-implementation). It is written to
 * degrade gracefully at that commit: the baseline's IndexDimension union has
 * no "family" member and exports no `classifyDimension`/family-index
 * symbols, so every family-specific metric below is feature-detected via a
 * namespace import and reported as `null` (with an explanatory note) rather
 * than guessed, whenever the running commit doesn't have that capability.
 * (matchBenefitsDetailed/isRelevantForFeed and the MOIS/Youth provider
 * classes ARE already present, byte-identical, at the baseline commit — no
 * feature detection needed for those.)
 *
 * Usage:
 *   1. Snapshots already frozen at /tmp/mois_serviceList_full.json,
 *      /tmp/mois_supportConditions_full.json, /tmp/youth_policy_full.json.
 *   2. Run against the baseline (from a worktree checked out at b8e5f24):
 *        BENCHMARK_LABEL=before npx tsx scripts/benchmarkFamilyEligibilityFrozen.ts
 *      Run against current (from this repo, on wip/family-phase2):
 *        BENCHMARK_LABEL=after  npx tsx scripts/benchmarkFamilyEligibilityFrozen.ts
 *   3. Diff:
 *        npx tsx scripts/benchmarkFamilyEligibilityFrozen.ts --diff
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

// Non-secret, benchmark-only placeholders. Real MOISBenefitProvider /
// YouthCenterBenefitProvider read this value per-call and put it in a URL
// query param / Authorization header, but installFrozenFetch() below never
// inspects either — it only matches on URL path prefix — so this value is
// never sent anywhere real and never needs to be (or be near) a real key.
const DUMMY_MOIS_KEY = "benchmark-dummy-mois-key-not-real";
const DUMMY_YOUTH_KEY = "benchmark-dummy-youth-key-not-real";

/** Below this, assume the Mock fallback (or some other catalog regression) was silently hit and abort rather than report bogus numbers. Real MOIS+Youth is in the thousands; Mock is ~53. */
const MIN_SANE_PROVIDER_COUNT = 300;
const MIN_SANE_MERGED_COUNT = 500;

const FAMILY_FIELDS = new Set([
  "maritalStatus",
  "childrenCount",
  "householdSize",
  "marriageDate",
  "singleParentFamily",
  "multiculturalFamily",
]);

// ---------------------------------------------------------------------------
// Profiles A-F (Part G spec): cumulative richness, family fields added last.
// Plain object literals with no UserProfile type annotation — this script
// intentionally runs unmodified against a commit whose UserProfile shape may
// not declare marriageDate/singleParentFamily/multiculturalFamily; tsx only
// transpiles (no type-checking), so this is safe at runtime on either commit.
// ---------------------------------------------------------------------------
function profileA() {
  return { birthDate: "1995-06-15" };
}
function profileB() {
  return { ...profileA(), maritalStatus: "married" };
}
function profileC() {
  return { ...profileB(), childrenCount: 2 };
}
function profileD() {
  return { ...profileC(), householdSize: 4 };
}
function profileE() {
  return {
    ...profileD(),
    singleParentFamily: true,
    multiculturalFamily: false,
    marriageDate: "2026-03-02", // 6 months before the fixed "today" (2026-09-02)
  };
}
function profileF() {
  return {
    ...profileE(),
    residence: { province: "경기도", city: "이천시" },
    individualIncomeBand: "2000_3000",
    householdIncomeBand: "3000_4000",
    employmentStatus: "employed",
    educationStatus: "university",
    housingType: "jeonse",
    homeowner: false,
    businessOwner: false,
    smeEmployee: true,
    interests: ["housing", "employment"],
  };
}

const PROFILES: { label: string; profile: Record<string, unknown> }[] = [
  { label: "A (age only)", profile: profileA() },
  { label: "B (+maritalStatus)", profile: profileB() },
  { label: "C (+childrenCount)", profile: profileC() },
  { label: "D (+householdSize)", profile: profileD() },
  { label: "E (+singleParentFamily+multiculturalFamily+marriageDate)", profile: profileE() },
  { label: "F (rich profile)", profile: profileF() },
];

/** Strips every family field from a profile (Part 3: family-attributable pruning comparison). */
function stripFamilyFields(profile: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...profile };
  for (const f of FAMILY_FIELDS) delete stripped[f];
  return stripped;
}

/**
 * Monkey-patches globalThis.fetch so MOISBenefitProvider and
 * YouthCenterBenefitProvider instead serve paginated responses built from
 * the frozen snapshot files, matching each provider's real response
 * envelope. Identical to installFrozenFetch in
 * scripts/benchmarkRegionExtractionFrozen.ts.
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

    throw new Error(`[benchmarkFamilyEligibilityFrozen] Unexpected live fetch during frozen-snapshot run: ${url}`);
  };

  globalThis.fetch = frozenFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function main() {
  const label = process.argv.includes("--diff") ? "diff" : process.env.BENCHMARK_LABEL;

  if (label === "diff") {
    const before = JSON.parse(fs.readFileSync("/tmp/family-benchmark-frozen-before.json", "utf8"));
    const after = JSON.parse(fs.readFileSync("/tmp/family-benchmark-frozen-after.json", "utf8"));

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

    console.log("\n=== [FROZEN SNAPSHOT] MOIS family-field structured-rule extraction coverage: before vs after ===");
    console.table([
      { metric: "catalogCount (serviceList rows)", before: before.extraction.catalogCount, after: after.extraction.catalogCount },
      { metric: "recordsWithAnyFamilyRule", before: before.extraction.recordsWithAnyFamilyRule, after: after.extraction.recordsWithAnyFamilyRule },
      ...Object.keys({ ...before.extraction.perField, ...after.extraction.perField }).map((f) => ({
        metric: `perField.${f}`,
        before: before.extraction.perField[f] ?? 0,
        after: after.extraction.perField[f] ?? 0,
      })),
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
        { metric: "familyAttributableCandidateDelta", before: b.familyAttributableCandidateDelta, after: a.familyAttributableCandidateDelta },
        { metric: "familyRuleFailsCount", before: b.familyRuleFailsCount, after: a.familyRuleFailsCount },
        { metric: "alreadyExcludedByOtherDimensionCount", before: b.alreadyExcludedByOtherDimensionCount, after: a.alreadyExcludedByOtherDimensionCount },
        { metric: "positiveFamilyEvidenceCount", before: b.positiveFamilyEvidenceCount, after: a.positiveFamilyEvidenceCount },
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
    console.log(`\n[equivalence check] total optimized-vs-full-scan mismatches across all 6 profiles: before=${totalMismatchesBefore} after=${totalMismatchesAfter}`);
    return;
  }

  if (label !== "before" && label !== "after") {
    throw new Error("Set BENCHMARK_LABEL=before|after, or pass --diff");
  }

  for (const f of [MOIS_SERVICE_LIST_SNAPSHOT, MOIS_SUPPORT_CONDITIONS_SNAPSHOT, YOUTH_POLICY_SNAPSHOT]) {
    if (!fs.existsSync(f)) throw new Error(`Missing frozen snapshot ${f} — freeze it once before running before/after.`);
  }

  // Benchmark-only dummy env values — see the module docstring's "REAL
  // PROVIDERS ONLY" section. Set unconditionally (never reads/depends on a
  // real .env.local) BEFORE providers/index.ts is ever imported below, so
  // its module-level `if (process.env.MOIS_API_KEY) ...` gate registers the
  // real provider classes instead of silently falling back to Mock.
  process.env.MOIS_API_KEY = DUMMY_MOIS_KEY;
  process.env.YOUTH_POLICY_API_KEY = DUMMY_YOUTH_KEY;

  console.log(`[${label}] Loading frozen MOIS snapshot from disk (no live fetch)...`);
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_SNAPSHOT, "utf8"));
  console.log(`[${label}] MOIS serviceList: ${moisRawList.length} rows (frozen)`);

  // =========================================================================
  // Section: structured family-rule extraction coverage, computed directly
  // via the REAL (this-commit's) extractEligibilityFromText over the frozen
  // MOIS text — no provider/network involved either way.
  // =========================================================================
  let recordsWithAnyFamilyRule = 0;
  const perField: Record<string, number> = {};
  for (const raw of moisRawList) {
    let recordHasFamilyRule = false;
    for (const text of [raw.지원대상, raw.선정기준]) {
      const extracted = extractEligibilityFromText("family-benchmark", text);
      for (const rule of extracted.rules as EligibilityRule[]) {
        if (FAMILY_FIELDS.has(rule.field)) {
          recordHasFamilyRule = true;
          perField[rule.field] = (perField[rule.field] ?? 0) + 1;
        }
      }
    }
    if (recordHasFamilyRule) recordsWithAnyFamilyRule++;
  }
  const extraction = { catalogCount: moisRawList.length, recordsWithAnyFamilyRule, perField };
  console.log(`[${label}] family extraction coverage (frozen snapshot):`, extraction);

  // =========================================================================
  // Section: REAL provider catalogs (never MockBenefitProvider), real merged
  // catalog, real candidate index, real indexed retrieval + full matching
  // pipeline (matchBenefitsDetailed / isRelevantForFeed — the exact
  // production functions app/api/benefits/match/route.ts uses).
  // =========================================================================
  const restoreFetch = installFrozenFetch();
  console.log(`[${label}] Fetching MOIS + Youth catalogs directly via the real provider classes (fetch mocked to frozen snapshot)...`);

  // Call each real provider directly (not just through the merged
  // providers/index.ts aggregate) so MOIS and Youth normalized counts can be
  // reported separately, per Part 1's requirement.
  const moisProvider = new MOISBenefitProvider();
  const youthProvider = new YouthCenterBenefitProvider();
  const [moisBenefits, youthBenefits] = await Promise.all([moisProvider.getBenefits(), youthProvider.getBenefits()]);
  console.log(`[${label}] MOIS normalized: ${moisBenefits.length}, Youth normalized: ${youthBenefits.length}`);

  console.log(`[${label}] Building merged catalog + candidate index (real providers, fetch mocked to frozen snapshot)...`);
  const { getCatalogWithCandidateIndex } = await import("../providers/index");
  const catalog = await getCatalogWithCandidateIndex();
  restoreFetch();

  // ---------------------------------------------------------------------
  // Guard: abort loudly if this ever looks like the Mock fallback (or any
  // other catalog regression) instead of quietly reporting bogus numbers.
  // ---------------------------------------------------------------------
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

  // `index`'s real shape varies by commit (the baseline CandidateIndex has
  // no `familyIndex` member) — typed as an untyped record and narrowed via
  // feature detection below rather than cast to `any`.
  const index = catalog.index as unknown as Record<string, unknown>;
  const mod = candidateIndexModule as unknown as Record<string, unknown>;

  // Feature detection: the baseline commit (b8e5f24) has no "family"
  // IndexDimension and exports no classifyDimension/family-index symbols.
  // Every family-specific metric degrades to null (not 0 — 0 would
  // misleadingly imply "measured and found zero") on that commit.
  const hasFamilyDimension = typeof mod.classifyDimension === "function" && index.familyIndex !== undefined;
  const classifyDimension = mod.classifyDimension as ((rule: EligibilityRule) => string) | undefined;
  const getCandidateBenefitsWithDiagnostics = mod.getCandidateBenefitsWithDiagnostics as (
    index: unknown,
    profile: unknown
  ) => { candidates: Benefit[]; diagnostics: { indexedLookupCount: number; fallbackScanCount: number; finalCandidateCount: number } };
  const getCandidateBenefitsFullScan = mod.getCandidateBenefitsFullScan as (
    index: unknown,
    profile: unknown
  ) => { id: string }[];

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

    // -----------------------------------------------------------------
    // Part 2: run the ACTUAL production-style downstream flow over the
    // candidates — matchBenefitsDetailed (full deterministic rule engine)
    // then isRelevantForFeed (the exact functions
    // app/api/benefits/match/route.ts uses) — instead of mislabeling
    // candidate-retrieval diagnostics as evaluation/relevance metrics.
    // -----------------------------------------------------------------
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
    // Part 3: causally-attributed family pruning. Compare candidate
    // retrieval for the SAME profile with vs. without the 6 family
    // fields. Since every other field is identical between the two runs,
    // any benefit present without-family but absent with-family was
    // necessarily excluded by a rule that only resolves to "fail" once
    // family data is present — i.e. a verified-necessary FAMILY rule.
    // Also reports, for completeness, how many family-constrained
    // benefits have a failing necessary family rule for this profile but
        // were ALREADY excluded by another dimension (not newly attributable
    // to family) — so no policy is double-counted or overclaimed.
    // -----------------------------------------------------------------
    let familyAttributableCandidateDelta: number | null = null;
    let familyRuleFailsCount: number | null = null;
    let alreadyExcludedByOtherDimensionCount: number | null = null;
    let positiveFamilyEvidenceCount: number | null = null;
    if (hasFamilyDimension && classifyDimension) {
      const noFamilyProfile = stripFamilyFields(profile);
      const { candidates: noFamilyCandidates } = getCandidateBenefitsWithDiagnostics(index, noFamilyProfile);
      const idsNoFamily = new Set(noFamilyCandidates.map((b: { id: string }) => b.id));
      // Positive = candidates lost specifically because family fields were added.
      familyAttributableCandidateDelta = idsNoFamily.size - idsIndexed.size;

      const constrainedByDimension = index.constrainedByDimension as Map<
        string,
        { benefit: { id: string }; necessaryRules: EligibilityRule[] }[]
      >;
      const familyEntries = constrainedByDimension.get("family") ?? [];
      const familyRuleFailingEntries = familyEntries.filter((e) =>
        e.necessaryRules.some((rule) => classifyDimension(rule) === "family" && evaluateRule(rule, profile as UserProfile) === "fail")
      );
      familyRuleFailsCount = familyRuleFailingEntries.length;
      // Of those, ones NOT present even without family fields were already
      // excluded by some other (non-family) necessary rule — family isn't
      // the sole/attributable cause for those, so don't double-count them
      // against familyAttributableCandidateDelta.
      alreadyExcludedByOtherDimensionCount = familyRuleFailingEntries.filter((e) => !idsNoFamily.has(e.benefit.id)).length;

      positiveFamilyEvidenceCount = familyEntries.filter((e) => {
        if (!idsIndexed.has(e.benefit.id)) return false;
        return e.necessaryRules.some((rule) => {
          if (classifyDimension(rule) !== "family") return false;
          return evaluateRule(rule, profile as UserProfile) === "pass";
        });
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
      familyAttributableCandidateDelta,
      familyRuleFailsCount,
      alreadyExcludedByOtherDimensionCount,
      positiveFamilyEvidenceCount,
      mismatchCount,
    };
    console.log(`[${label}] profile ${pLabel}:`, profileResults[pLabel]);
  }

  const out = { label, hasFamilyDimension, catalog: catalogSummary, extraction, profiles: profileResults };
  fs.writeFileSync(`/tmp/family-benchmark-frozen-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`[${label}] Written to /tmp/family-benchmark-frozen-${label}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
