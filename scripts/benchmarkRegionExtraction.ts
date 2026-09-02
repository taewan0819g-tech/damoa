/**
 * Before/after measurement for the region-extraction change to
 * lib/eligibility/extraction/koreanEligibilityParser.ts (gazetteer-backed
 * gazetteer + safe-context residence detection). READ-ONLY: fetches the
 * live MOIS + Youth Center catalogs and runs them through the REAL,
 * unmodified provider/adapter/candidate-index layers — never reimplements
 * or mutates production matching behavior.
 *
 * This script is meant to be run TWICE against two different working-tree
 * states of koreanEligibilityParser.ts (once with `git stash` applied to
 * revert to the pre-change parser, once with the change present), each time
 * writing a JSON snapshot keyed by BENCHMARK_LABEL, so a third invocation
 * (`--diff`) can load both snapshots and print a before/after comparison.
 *
 * Usage:
 *   BENCHMARK_LABEL=before node --env-file=.env.local -r tsx/cjs scripts/benchmarkRegionExtraction.ts
 *   BENCHMARK_LABEL=after  node --env-file=.env.local -r tsx/cjs scripts/benchmarkRegionExtraction.ts
 *   node --env-file=.env.local -r tsx/cjs scripts/benchmarkRegionExtraction.ts --diff
 */
import fs from "fs";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { extractEligibilityFromText } from "../lib/eligibility/extraction/koreanEligibilityParser";
import { getCatalogWithCandidateIndex } from "../providers/index";
import { getCandidateBenefitsWithDiagnostics } from "../lib/eligibility/candidateIndex";
import type { UserProfile } from "../types/profile";

const MOIS_BASE = "https://api.odcloud.kr/api/gov24/v3";

async function fetchMoisAll<T>(path: string, key: string): Promise<T[]> {
  const PER_PAGE = 1000;
  const MAX_PAGES = 30;
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${MOIS_BASE}${path}?page=${page}&perPage=${PER_PAGE}`, {
      headers: { Authorization: `Infuser ${key}` },
    });
    if (!res.ok) {
      console.error(`MOIS ${path} HTTP ${res.status} on page ${page}`);
      break;
    }
    const json = (await res.json()) as { data: T[]; totalCount: number };
    results.push(...json.data);
    if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
  }
  return results;
}

// Independent-of-parser heuristic: does the raw text contain ANY geographic
// residence-ish keyword at all? Same regex used for both before/after runs
// so it's a stable denominator for "coverage %".
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

async function main() {
  const label = process.argv.includes("--diff") ? "diff" : process.env.BENCHMARK_LABEL;

  if (label === "diff") {
    const before = JSON.parse(fs.readFileSync("/tmp/region-benchmark-before.json", "utf8"));
    const after = JSON.parse(fs.readFileSync("/tmp/region-benchmark-after.json", "utf8"));
    console.log("\n=== MOIS region text-extraction coverage: before vs after ===");
    console.table([
      { metric: "rawRegionSignalCount", before: before.region.rawRegionSignalCount, after: after.region.rawRegionSignalCount },
      { metric: "structuredRegionRuleCount", before: before.region.structuredRegionRuleCount, after: after.region.structuredRegionRuleCount },
      { metric: "regionUnresolvedCount", before: before.region.regionUnresolvedCount, after: after.region.regionUnresolvedCount },
      { metric: "coveragePercent", before: before.region.coveragePercent, after: after.region.coveragePercent },
    ]);

    console.log("\n=== Candidate retrieval funnel: before vs after (per profile) ===");
    for (const p of Object.keys(before.profiles)) {
      console.log(`\n-- ${p} --`);
      console.table([
        {
          metric: "personalizableCatalogCount",
          before: before.profiles[p].personalizableCatalogCount,
          after: after.profiles[p].personalizableCatalogCount,
        },
        { metric: "candidateCount", before: before.profiles[p].candidateCount, after: after.profiles[p].candidateCount },
        {
          metric: "detailedEvaluationCount (indexed+fallback touched)",
          before: before.profiles[p].detailedEvaluationCount,
          after: after.profiles[p].detailedEvaluationCount,
        },
        { metric: "relevantCount (final candidates)", before: before.profiles[p].relevantCount, after: after.profiles[p].relevantCount },
        {
          metric: "candidateRetrievalTimeMs",
          before: before.profiles[p].candidateRetrievalTimeMs.toFixed(3),
          after: after.profiles[p].candidateRetrievalTimeMs.toFixed(3),
        },
      ]);
    }
    return;
  }

  if (label !== "before" && label !== "after") {
    throw new Error('Set BENCHMARK_LABEL=before|after, or pass --diff');
  }

  const moisKey = process.env.MOIS_API_KEY;
  if (!moisKey) throw new Error("MOIS_API_KEY not set");

  console.log(`[${label}] Fetching raw MOIS serviceList + supportConditions...`);
  const [moisRawList, moisRawConditions] = await Promise.all([
    fetchMoisAll<MOISRawServiceListItem>("/serviceList", moisKey),
    fetchMoisAll<MOISRawSupportCondition>("/supportConditions", moisKey),
  ]);
  console.log(`[${label}] MOIS serviceList: ${moisRawList.length} rows`);

  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);

  // =========================================================================
  // Section: MOIS region text-extraction coverage (mirrors the REAL
  // per-field loop in MOISAdapter.buildEligibility exactly: 지원대상 and
  // 선정기준 run independently through extractEligibilityFromText).
  // =========================================================================
  let rawRegionSignalCount = 0;
  let structuredRegionRuleCount = 0;
  let regionUnresolvedCount = 0;
  const sampleRuleTexts: { text: string; value: unknown }[] = [];
  const sampleUnresolvedTexts: string[] = [];

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
    if (recordHasRegionRule) structuredRegionRuleCount++;
    else if (recordHasRegionUnresolved) regionUnresolvedCount++;
  }

  const region = {
    rawRegionSignalCount,
    structuredRegionRuleCount,
    regionUnresolvedCount,
    coveragePercent:
      rawRegionSignalCount > 0 ? Number(((structuredRegionRuleCount / rawRegionSignalCount) * 100).toFixed(1)) : null,
    sampleRuleTexts,
    sampleUnresolvedTexts,
  };

  console.log(`[${label}] region coverage:`, {
    rawRegionSignalCount,
    structuredRegionRuleCount,
    regionUnresolvedCount,
    coveragePercent: region.coveragePercent,
  });

  // Sanity check that this run's normalizeMOISServiceListItem output is
  // consistent with the direct extractEligibilityFromText count above
  // (uses the exact same production code path, just via the adapter).
  const moisBenefitsSample = moisRawList.slice(0, 200).map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeMOISSupportConditions(condRow) : undefined;
    return normalizeMOISServiceListItem(raw, ageGroup);
  });
  void moisBenefitsSample;

  // =========================================================================
  // Section: candidate-retrieval funnel (real merged MOIS+Youth catalog,
  // real candidate index, real indexed retrieval path) for profiles
  // A (age only), B (age+region), C (age+region+income), D (rich profile).
  // =========================================================================
  console.log(`[${label}] Building merged catalog + candidate index...`);
  const catalog = await getCatalogWithCandidateIndex();
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
  fs.writeFileSync(`/tmp/region-benchmark-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`[${label}] Written to /tmp/region-benchmark-${label}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
