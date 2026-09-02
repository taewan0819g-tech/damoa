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
 * This single script file is copied verbatim into a `git worktree` checked
 * out at the baseline commit and run there for "before" (that worktree's own
 * lib/eligibility/candidateIndex.ts, koreanEligibilityParser.ts, etc. — the
 * REAL unmodified baseline code, not a re-implementation). It is written to
 * degrade gracefully at that commit: the baseline's IndexDimension union has
 * no "family" member and exports no `classifyDimension`/family-index
 * symbols, so every family-specific metric below is feature-detected via a
 * namespace import and reported as `null` (with an explanatory note) rather
 * than guessed, whenever the running commit doesn't have that capability.
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
 */
import fs from "fs";
import type { MOISRawServiceListItem, MOISRawSupportCondition } from "../adapters/mois/MOISAdapter";
import type { YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { extractEligibilityFromText } from "../lib/eligibility/extraction/koreanEligibilityParser";
import * as candidateIndexModule from "../lib/eligibility/candidateIndex";
import { evaluateRule } from "../lib/eligibility/ruleEngine";
import type { EligibilityRule } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_SERVICE_LIST_SNAPSHOT = "/tmp/mois_serviceList_full.json";
const MOIS_SUPPORT_CONDITIONS_SNAPSHOT = "/tmp/mois_supportConditions_full.json";
const YOUTH_POLICY_SNAPSHOT = "/tmp/youth_policy_full.json";

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

    console.log("\n=== [FROZEN SNAPSHOT] Candidate retrieval funnel: before vs after (per profile) ===");
    for (const p of Object.keys(before.profiles)) {
      const b = before.profiles[p];
      const a = after.profiles[p];
      console.log(`\n-- ${p} --`);
      console.table([
        { metric: "personalizableCatalogCount", before: b.personalizableCatalogCount, after: a.personalizableCatalogCount },
        { metric: "candidateCount", before: b.candidateCount, after: a.candidateCount },
        { metric: "detailedEvaluationCount", before: b.detailedEvaluationCount, after: a.detailedEvaluationCount },
        { metric: "relevantCount", before: b.relevantCount, after: a.relevantCount },
        { metric: "indexedLookupCount", before: b.indexedLookupCount, after: a.indexedLookupCount },
        { metric: "fallbackScanCount", before: b.fallbackScanCount, after: a.fallbackScanCount },
        { metric: "ms", before: b.ms.toFixed(3), after: a.ms.toFixed(3) },
        { metric: "familySpecificPruningCount", before: b.familySpecificPruningCount, after: a.familySpecificPruningCount },
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

  console.log(`[${label}] Loading frozen MOIS snapshot from disk (no live fetch)...`);
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_SNAPSHOT, "utf8"));
  console.log(`[${label}] MOIS serviceList: ${moisRawList.length} rows (frozen)`);

  // =========================================================================
  // Section: structured family-rule extraction coverage, computed directly
  // via the REAL (this-commit's) extractEligibilityFromText over the frozen
  // MOIS text — no candidate index involved, no network either way.
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
  // Section: candidate-retrieval funnel (real merged MOIS+Youth catalog,
  // real candidate index, real indexed retrieval path) for profiles A-F.
  // =========================================================================
  const restoreFetch = installFrozenFetch();
  console.log(`[${label}] Building merged catalog + candidate index (fetch mocked to frozen snapshot)...`);

  const { getCatalogWithCandidateIndex } = await import("../providers/index");
  const catalog = await getCatalogWithCandidateIndex();
  restoreFetch();
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
  ) => { candidates: { id: string }[]; diagnostics: { indexedLookupCount: number; fallbackScanCount: number; finalCandidateCount: number } };
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

    let familySpecificPruningCount: number | null = null;
    let positiveFamilyEvidenceCount: number | null = null;
    if (hasFamilyDimension && classifyDimension) {
      const constrainedByDimension = index.constrainedByDimension as Map<
        string,
        { benefit: { id: string }; necessaryRules: EligibilityRule[] }[]
      >;
      const familyEntries = constrainedByDimension.get("family") ?? [];
      familySpecificPruningCount = familyEntries.filter((e) => !idsIndexed.has(e.benefit.id)).length;
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
      candidateCount: candidates.length,
      detailedEvaluationCount: diagnostics.indexedLookupCount + diagnostics.fallbackScanCount,
      relevantCount: diagnostics.finalCandidateCount,
      indexedLookupCount: diagnostics.indexedLookupCount,
      fallbackScanCount: diagnostics.fallbackScanCount,
      ms,
      familySpecificPruningCount,
      positiveFamilyEvidenceCount,
      mismatchCount,
    };
    console.log(`[${label}] profile ${pLabel}:`, profileResults[pLabel]);
  }

  const out = { label, hasFamilyDimension, extraction, profiles: profileResults };
  fs.writeFileSync(`/tmp/family-benchmark-frozen-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`[${label}] Written to /tmp/family-benchmark-frozen-${label}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
