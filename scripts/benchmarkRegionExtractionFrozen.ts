/**
 * Frozen-snapshot before/after measurement for the region-extraction change
 * to lib/eligibility/extraction/koreanEligibilityParser.ts +
 * lib/eligibility/regionGazetteer.ts.
 *
 * Unlike scripts/benchmarkRegionExtraction.ts (which fetches live MOIS/Youth
 * Center data on EVERY invocation, so "before" and "after" could theoretically
 * see slightly different upstream data), this script fetches the raw catalogs
 * ONCE, freezes them to disk, and both the "before" and "after" invocations
 * load the SAME frozen files. This guarantees the two runs are evaluated
 * against byte-identical input data, isolating the parser change as the only
 * variable.
 *
 * It still exercises the REAL, unmodified provider/adapter/candidate-index
 * code paths for the candidate-retrieval-funnel section — `globalThis.fetch`
 * is monkey-patched to serve paginated responses synthesized from the frozen
 * snapshot files (matching each provider's real response envelope), so
 * `MOISBenefitProvider` / `YouthCenterBenefitProvider` run their actual
 * production code, they just never touch the network.
 *
 * Usage:
 *   1. Freeze snapshots once (already done for this run — see
 *      /tmp/mois_serviceList_full.json, /tmp/mois_supportConditions_full.json,
 *      /tmp/youth_policy_full.json):
 *        node --env-file=.env.local scripts/freezeRegionBenchmarkSnapshot.mjs
 *   2. Run twice against two working-tree states (git stash the parser files
 *      for "before", pop for "after"):
 *        BENCHMARK_LABEL=before npx tsx scripts/benchmarkRegionExtractionFrozen.ts
 *        BENCHMARK_LABEL=after  npx tsx scripts/benchmarkRegionExtractionFrozen.ts
 *   3. Diff:
 *        npx tsx scripts/benchmarkRegionExtractionFrozen.ts --diff
 */
import fs from "fs";
import type { MOISRawServiceListItem, MOISRawSupportCondition } from "../adapters/mois/MOISAdapter";
import type { YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { extractEligibilityFromText } from "../lib/eligibility/extraction/koreanEligibilityParser";
import type { UserProfile } from "../types/profile";

const MOIS_SERVICE_LIST_SNAPSHOT = "/tmp/mois_serviceList_full.json";
const MOIS_SUPPORT_CONDITIONS_SNAPSHOT = "/tmp/mois_supportConditions_full.json";
const YOUTH_POLICY_SNAPSHOT = "/tmp/youth_policy_full.json";

const RAW_REGION_SIGNAL_RE = /(거주|주민등록|주소지|주민)/;

function profileA(): UserProfile {
  return { birthDate: "2000-01-01" };
}
function profileB(): UserProfile {
  return { ...profileA(), residence: { province: "경기도", city: "이천시" } };
}
function profileC(): UserProfile {
  return { ...profileB(), individualIncomeBand: "2000_3000" };
}
function profileD(): UserProfile {
  return { ...profileC(), educationStatus: "university", housingType: "jeonse", homeowner: false };
}

/**
 * Monkey-patches globalThis.fetch so MOISBenefitProvider and
 * YouthCenterBenefitProvider (which fetch live by default) instead serve
 * paginated responses built from the frozen snapshot files. Response
 * envelopes match each provider's real parsing code exactly:
 *   - odcloud: { data: T[], totalCount: number, ... } — MOISBenefitProvider
 *     reads `json.data` and `json.totalCount`.
 *   - youth center: { resultCode, resultMessage, result: { pagging: { totCount },
 *     youthPolicyList } } — YouthCenterBenefitProvider reads
 *     `json.resultCode`, `json.result.pagging.totCount`, `json.result.youthPolicyList`.
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

    throw new Error(`[benchmarkRegionExtractionFrozen] Unexpected live fetch during frozen-snapshot run: ${url}`);
  };

  globalThis.fetch = frozenFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function main() {
  const label = process.argv.includes("--diff") ? "diff" : process.env.BENCHMARK_LABEL;

  if (label === "diff") {
    const before = JSON.parse(fs.readFileSync("/tmp/region-benchmark-frozen-before.json", "utf8"));
    const after = JSON.parse(fs.readFileSync("/tmp/region-benchmark-frozen-after.json", "utf8"));

    console.log("\n=== [FROZEN SNAPSHOT] MOIS region text-extraction coverage: before vs after ===");
    console.table([
      { metric: "catalogCount (serviceList rows)", before: before.region.catalogCount, after: after.region.catalogCount },
      { metric: "rawRegionSignalCount", before: before.region.rawRegionSignalCount, after: after.region.rawRegionSignalCount },
      { metric: "structuredRegionRuleCount", before: before.region.structuredRegionRuleCount, after: after.region.structuredRegionRuleCount },
      { metric: "regionUnresolvedCount", before: before.region.regionUnresolvedCount, after: after.region.regionUnresolvedCount },
      { metric: "coveragePercent", before: before.region.coveragePercent, after: after.region.coveragePercent },
    ]);

    console.log("\n=== [FROZEN SNAPSHOT] Candidate retrieval funnel: before vs after (per profile) ===");
    for (const p of Object.keys(before.profiles)) {
      console.log(`\n-- ${p} --`);
      const b = before.profiles[p];
      const a = after.profiles[p];
      console.table([
        { metric: "personalizableCatalogCount", before: b.personalizableCatalogCount, after: a.personalizableCatalogCount },
        { metric: "candidateCount", before: b.candidateCount, after: a.candidateCount },
        { metric: "detailedEvaluationCount", before: b.detailedEvaluationCount, after: a.detailedEvaluationCount },
        { metric: "relevantCount", before: b.relevantCount, after: a.relevantCount },
        { metric: "candidateRetrievalTimeMs", before: b.candidateRetrievalTimeMs.toFixed(3), after: a.candidateRetrievalTimeMs.toFixed(3) },
      ]);
    }

    // Explicit invariant check called out by the task: for an age-only
    // profile, candidateCount must be identical before/after unless proven
    // otherwise by a genuine behavior change.
    const ageOnlyKey = Object.keys(before.profiles).find((k) => k.startsWith("A "));
    if (ageOnlyKey) {
      const b = before.profiles[ageOnlyKey].candidateCount;
      const a = after.profiles[ageOnlyKey].candidateCount;
      console.log(
        `\n[invariant check] age-only profile candidateCount: before=${b} after=${a} -> ${b === a ? "IDENTICAL (expected)" : "DIFFERENT (needs justification)"}`
      );
    }

    // False-negative surface: any MOIS record that had a structured region
    // rule "before" but does NOT have one "after" (a real regression would
    // show up here; an improvement would show up as the mirror-image gain,
    // reported separately below).
    const beforeRuleIds = new Set<string>((before.region.ruleServiceIds ?? []) as string[]);
    const afterRuleIds = new Set<string>((after.region.ruleServiceIds ?? []) as string[]);
    const lostIds = [...beforeRuleIds].filter((id) => !afterRuleIds.has(id));
    const gainedIds = [...afterRuleIds].filter((id) => !beforeRuleIds.has(id));
    console.log(
      `\n[false-negative check] service IDs with a region rule BEFORE but not AFTER (regressions): ${lostIds.length}`,
      lostIds.slice(0, 20)
    );
    console.log(
      `[improvement check] service IDs with a region rule AFTER but not BEFORE (gains): ${gainedIds.length}`,
      gainedIds.slice(0, 20)
    );
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
  // Section: MOIS region text-extraction coverage (mirrors the REAL
  // per-field loop in MOISAdapter.buildEligibility exactly: 지원대상 and
  // 선정기준 run independently through extractEligibilityFromText), computed
  // directly from the frozen snapshot — no network involved either way.
  // =========================================================================
  let rawRegionSignalCount = 0;
  let structuredRegionRuleCount = 0;
  let regionUnresolvedCount = 0;
  const sampleRuleTexts: { text: string; value: unknown }[] = [];
  const sampleUnresolvedTexts: string[] = [];
  const ruleServiceIds: string[] = [];

  for (const raw of moisRawList) {
    const combinedText = `${raw.지원대상 ?? ""} ${raw.선정기준 ?? ""}`;
    const hasRawSignal = RAW_REGION_SIGNAL_RE.test(combinedText);
    if (hasRawSignal) rawRegionSignalCount++;

    let recordHasRegionRule = false;
    let recordHasRegionUnresolved = false;
    for (const text of [raw.지원대상, raw.선정기준]) {
      const extracted = extractEligibilityFromText("region-benchmark", text);
      const regionRule = extracted.rules.find((r) => r.field === "residence" && r.operator === "region_in");
      if (regionRule) {
        recordHasRegionRule = true;
        if (sampleRuleTexts.length < 10) sampleRuleTexts.push({ text: text ?? "", value: regionRule.value });
      }
      for (const clause of extracted.unresolvedClauses) {
        if (RAW_REGION_SIGNAL_RE.test(clause)) {
          recordHasRegionUnresolved = true;
          if (sampleUnresolvedTexts.length < 10) sampleUnresolvedTexts.push(clause);
        }
      }
    }
    if (recordHasRegionRule) {
      structuredRegionRuleCount++;
      ruleServiceIds.push(raw.서비스ID);
    } else if (recordHasRegionUnresolved) {
      regionUnresolvedCount++;
    }
  }

  const region = {
    catalogCount: moisRawList.length,
    rawRegionSignalCount,
    structuredRegionRuleCount,
    regionUnresolvedCount,
    coveragePercent:
      rawRegionSignalCount > 0 ? Number(((structuredRegionRuleCount / rawRegionSignalCount) * 100).toFixed(1)) : null,
    sampleRuleTexts,
    sampleUnresolvedTexts,
    ruleServiceIds,
  };

  console.log(`[${label}] region coverage (frozen snapshot):`, {
    catalogCount: region.catalogCount,
    rawRegionSignalCount,
    structuredRegionRuleCount,
    regionUnresolvedCount,
    coveragePercent: region.coveragePercent,
  });

  // =========================================================================
  // Section: candidate-retrieval funnel (real merged MOIS+Youth catalog,
  // real candidate index, real indexed retrieval path) for profiles
  // A (age only), B (age+region), C (age+region+income), D (rich profile).
  // fetch is monkey-patched to serve the frozen snapshot, so this exercises
  // the REAL, unmodified provider/adapter/candidateIndex code paths without
  // hitting the network — both before/after runs see byte-identical input.
  // =========================================================================
  const restoreFetch = installFrozenFetch();
  console.log(`[${label}] Building merged catalog + candidate index (fetch mocked to frozen snapshot)...`);

  // Imported dynamically AFTER installing the frozen fetch, and via a
  // fresh module registry (tsx re-evaluates on each process invocation
  // anyway since this always runs as a new `node`/`tsx` process), so the
  // providers' own in-process memoizeAsync caches are empty and are forced
  // to actually call fetch() (which is now the frozen one) rather than
  // serving a stale live-fetched result from a previous run in this process.
  const { getCatalogWithCandidateIndex } = await import("../providers/index");
  const { getCandidateBenefitsWithDiagnostics } = await import("../lib/eligibility/candidateIndex");

  const catalog = await getCatalogWithCandidateIndex();
  restoreFetch();
  const index = catalog.index;

  const profiles: { label: string; profile: UserProfile }[] = [
    { label: "A (age only)", profile: profileA() },
    { label: "B (age+region: 경기도/이천시)", profile: profileB() },
    { label: "C (age+region+income)", profile: profileC() },
    { label: "D (rich profile)", profile: profileD() },
  ];

  const profileResults: Record<string, unknown> = {};
  for (const { label: pLabel, profile } of profiles) {
    const t0 = performance.now();
    const { candidates, diagnostics } = getCandidateBenefitsWithDiagnostics(index, profile);
    const candidateRetrievalTimeMs = performance.now() - t0;
    profileResults[pLabel] = {
      personalizableCatalogCount: catalog.benefits.length,
      candidateCount: candidates.length,
      detailedEvaluationCount: diagnostics.indexedLookupCount + diagnostics.fallbackScanCount,
      relevantCount: diagnostics.finalCandidateCount,
      candidateRetrievalTimeMs,
    };
    console.log(`[${label}] profile ${pLabel}:`, profileResults[pLabel]);
  }

  const out = { label, region, profiles: profileResults };
  fs.writeFileSync(`/tmp/region-benchmark-frozen-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`[${label}] Written to /tmp/region-benchmark-frozen-${label}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
