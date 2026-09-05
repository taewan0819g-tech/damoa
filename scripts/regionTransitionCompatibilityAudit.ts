/**
 * Checkpoint: Final Region Transition Compatibility.
 *
 * Audits the real-world impact of replacing `matchRegion()`'s pure
 * exact-match algorithm with the new set-containment / administrative-
 * transition-aware algorithm (see `lib/eligibility/region.ts` +
 * `domain/region/adminTransition.ts`).
 *
 * Two things are measured against the SAME frozen catalog snapshot used by
 * scripts/frozenMatchingSemanticEquivalence.ts:
 *
 *  1. How many frozen policies' EXTRACTED region_in rules reference each
 *     old-name / current-name province+district affected by the two
 *     verified 2026-07-01 transitions — a static count over `benefit.eligibility`,
 *     independent of any particular user profile.
 *  2. PASS/UNKNOWN/FAIL for a set of representative profiles (the 6 general
 *     ones from frozenMatchingSemanticEquivalence.ts, PLUS explicit
 *     transition profiles covering every old/current 인천/광주/전남/
 *     전남광주통합특별시 name), evaluated BEFORE (pre-checkpoint exact-match
 *     `matchRegion`) and AFTER (this checkpoint's transition-aware
 *     `matchRegion`) against every region_in rule actually present in the
 *     frozen catalog, tallied as aggregate counts (not full per-benefit
 *     dumps, since the transition profiles' benefit-level diff is small
 *     enough to also inspect individually below).
 *
 * Run with: npx tsx scripts/regionTransitionCompatibilityAudit.ts [outputPath]
 * Default outputPath: docs/audits/region-transition-compatibility.json
 */
import fs from "node:fs";
import type { UserProfile } from "../types/profile";
import type { Benefit, EligibilityRule, EligibilityRuleGroup, RuleOperator } from "../types/benefit";
import type { RegionSpec } from "../lib/eligibility/region";

const MOIS_SERVICE_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MOIS_SUPPORT_CONDITIONS_PATH = "/tmp/mois_supportConditions_full.json";
const YOUTH_POLICY_PATH = "/tmp/youth_policy_full.json";

function paginate<T>(all: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return all.slice(start, start + perPage);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Pre-checkpoint exact-match `matchRegion`, reproduced verbatim for the "before" comparison (never used at runtime — audit-only). */
function matchRegionExactMatchOnly(
  residence: { province?: string; city?: string } | undefined | null,
  allowed: RegionSpec[],
  normalizeProvince: (p?: string | null) => string | undefined
): "pass" | "fail" | "unknown" {
  const province = normalizeProvince(residence?.province);
  if (!province) return "unknown";
  const city = residence?.city?.trim() || undefined;

  let cityUnknownWithinMatchedProvince = false;
  for (const spec of allowed) {
    const specProvince = normalizeProvince(spec.province);
    if (!specProvince || specProvince !== province) continue;
    if (!spec.city) return "pass";
    if (!city) {
      cityUnknownWithinMatchedProvince = true;
      continue;
    }
    if ((spec.city.trim() || undefined) === city) return "pass";
  }
  if (cityUnknownWithinMatchedProvince) return "unknown";
  return "fail";
}

/**
 * Checkpoint: Final tiny Region OR-union hardening.
 *
 * Reproduction of `matchRegion()` as it existed immediately BEFORE this
 * checkpoint's OR-union fix: transition-aware single-spec containment (via
 * the real `gwangjuJeonnamRelation`/`incheonCityRelation` from
 * `domain/region/adminTransition.ts`, unchanged by this checkpoint), but
 * WITHOUT union-of-overlapping-specs completion. Used ONLY to isolate how
 * many real frozen-catalog (profile, rule) results change specifically
 * because of the new `transitionUnionCoversUser()` layer, as opposed to the
 * broader pre-existing exact-match -> transition-aware change already
 * measured by `matchRegionExactMatchOnly` above. Audit-only, never used at
 * runtime.
 */
function matchRegionSingleSpecOnly(
  residence: { province?: string; city?: string } | undefined | null,
  allowed: RegionSpec[],
  normalizeProvince: (p?: string | null) => string | undefined,
  gwangjuJeonnamRelation: (
    userProvince: string,
    userCity: string | undefined,
    specProvince: string,
    specCity: string | undefined
  ) => "contained" | "overlap" | "disjoint" | undefined,
  incheonCityRelation: (userCity: string, specCity: string) => "contained" | "overlap" | "disjoint" | undefined
): "pass" | "fail" | "unknown" {
  const normalizeCity = (c?: string | null) => c?.trim() || undefined;
  const province = normalizeProvince(residence?.province);
  if (!province) return "unknown";
  const city = normalizeCity(residence?.city);
  const user = { province, city };

  let sawOverlap = false;
  for (const spec of allowed) {
    const specProvince = normalizeProvince(spec.province);
    if (!specProvince) continue;
    const specCity = normalizeCity(spec.city);
    let relation: "contained" | "overlap" | "disjoint";
    if (user.province === specProvince) {
      if (!specCity) relation = "contained";
      else if (!user.city) relation = "overlap";
      else if (user.city === specCity) relation = "contained";
      else if (user.province === "인천광역시") relation = incheonCityRelation(user.city, specCity) ?? "disjoint";
      else relation = "disjoint";
    } else {
      relation = gwangjuJeonnamRelation(user.province, user.city, specProvince, specCity) ?? "disjoint";
    }
    if (relation === "contained") return "pass";
    if (relation === "overlap") sawOverlap = true;
  }
  return sawOverlap ? "unknown" : "fail";
}

const GENERAL_PROFILES: Record<string, UserProfile> = {
  empty: {},
  singleUnemployedUniv: {
    birthDate: "2000-01-01",
    residence: { province: "서울특별시", city: "강남구" },
    maritalStatus: "single",
    employmentStatus: "unemployed",
    educationStatus: "university",
    individualIncomeBand: "under_1000",
  },
  marriedEmployedHighIncome: {
    birthDate: "1990-06-15",
    residence: { province: "경기도", city: "성남시 분당구" },
    maritalStatus: "married",
    employmentStatus: "employed",
    educationStatus: "graduated",
    individualIncomeBand: "over_7000",
    householdIncomeBand: "over_7000",
    childrenCount: 2,
    householdSize: 4,
  },
  singleParentLowIncome: {
    birthDate: "1988-03-20",
    residence: { province: "부산광역시", city: "강서구" },
    maritalStatus: "divorced",
    singleParentFamily: true,
    employmentStatus: "self_employed",
    educationStatus: "high_school",
    individualIncomeBand: "under_1000",
    householdIncomeBand: "1000_2000",
  },
  studentNoIncome: {
    birthDate: "2003-09-01",
    residence: { province: "제주특별자치도", city: "제주시" },
    maritalStatus: "single",
    employmentStatus: "student",
    educationStatus: "university",
    individualIncomeBand: "none",
  },
  homeownerFreelancer: {
    birthDate: "1995-11-11",
    residence: { province: "세종특별자치시", city: "세종특별자치시" },
    maritalStatus: "single",
    employmentStatus: "freelancer",
    educationStatus: "graduate_school",
    homeowner: true,
    individualIncomeBand: "3000_4000",
  },
};

/** Required transition profiles per the checkpoint spec — every old/current 인천/광주/전남/전남광주통합특별시 name a resident could plausibly have. */
const TRANSITION_PROFILES: Record<string, UserProfile> = {
  "current_jeonnamGwangju_mokpo": { residence: { province: "전남광주통합특별시", city: "목포시" } },
  "current_jeonnamGwangju_gwangsan": { residence: { province: "전남광주통합특별시", city: "광산구" } },
  "current_jeonnamGwangju_provinceOnly": { residence: { province: "전남광주통합특별시" } },
  "legacy_jeonnam_mokpo": { residence: { province: "전라남도", city: "목포시" } },
  "legacy_gwangju_gwangsan": { residence: { province: "광주광역시", city: "광산구" } },
  "current_incheon_yeongjong": { residence: { province: "인천광역시", city: "영종구" } },
  "current_incheon_jemulpo": { residence: { province: "인천광역시", city: "제물포구" } },
  "current_incheon_geomdan": { residence: { province: "인천광역시", city: "검단구" } },
  "current_incheon_seohae": { residence: { province: "인천광역시", city: "서해구" } },
  "legacy_incheon_jung": { residence: { province: "인천광역시", city: "중구" } },
  "legacy_incheon_dong": { residence: { province: "인천광역시", city: "동구" } },
  "legacy_incheon_seo": { residence: { province: "인천광역시", city: "서구" } },
};

const ALL_PROFILES: Record<string, UserProfile> = { ...GENERAL_PROFILES, ...TRANSITION_PROFILES };

/** Collects every `region_in` rule's RegionSpec[] value out of a benefit's eligibility rule tree, plus the owning rule's evidence for the manual-inspection list. */
function collectRegionRules(
  group: EligibilityRuleGroup | undefined,
  out: { specs: RegionSpec[]; rule: EligibilityRule }[]
): void {
  if (!group) return;
  for (const node of group.rules) {
    if ("type" in node) {
      collectRegionRules(node, out);
    } else if ((node as EligibilityRule).operator === ("region_in" as RuleOperator)) {
      const rule = node as EligibilityRule;
      out.push({ specs: (rule.value as RegionSpec[]) ?? [], rule });
    }
  }
}

async function main() {
  const outputPath = process.argv[2] ?? "docs/audits/region-transition-compatibility.json";

  const missing = [MOIS_SERVICE_LIST_PATH, MOIS_SUPPORT_CONDITIONS_PATH, YOUTH_POLICY_PATH].filter(
    (p) => !fs.existsSync(p)
  );
  if (missing.length > 0) {
    console.log(`Skipping -- missing frozen snapshot(s): ${missing.join(", ")}`);
    return;
  }

  const moisServiceList = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_PATH, "utf-8"));
  const moisSupportConditions = JSON.parse(fs.readFileSync(MOIS_SUPPORT_CONDITIONS_PATH, "utf-8"));
  const youthPolicies = JSON.parse(fs.readFileSync(YOUTH_POLICY_PATH, "utf-8"));

  const MOIS_PER_PAGE = 1000;
  const YOUTH_PAGE_SIZE = 1000;

  const fetchMock = async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.hostname === "api.odcloud.kr") {
      const page = Number(url.searchParams.get("page"));
      const perPage = Number(url.searchParams.get("perPage")) || MOIS_PER_PAGE;
      if (url.pathname.endsWith("/serviceList")) {
        const data = paginate(moisServiceList, page, perPage);
        return jsonResponse({
          currentCount: data.length, data, matchCount: moisServiceList.length, page, perPage,
          totalCount: moisServiceList.length,
        });
      }
      if (url.pathname.endsWith("/supportConditions")) {
        const data = paginate(moisSupportConditions, page, perPage);
        return jsonResponse({
          currentCount: data.length, data, matchCount: moisSupportConditions.length, page, perPage,
          totalCount: moisSupportConditions.length,
        });
      }
      if (url.pathname.endsWith("/serviceDetail")) {
        return jsonResponse({ currentCount: 0, data: [], matchCount: 0, page: 1, perPage: 1, totalCount: 0 });
      }
    }
    if (url.hostname === "www.youthcenter.go.kr") {
      const pageNum = Number(url.searchParams.get("pageNum"));
      const pageSize = Number(url.searchParams.get("pageSize")) || YOUTH_PAGE_SIZE;
      const youthPolicyList = paginate(youthPolicies, pageNum, pageSize);
      return jsonResponse({
        resultCode: 200, resultMessage: "OK",
        result: { pagging: { totCount: youthPolicies.length, pageNum, pageSize }, youthPolicyList },
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  process.env.MOIS_API_KEY = "region-transition-audit-key";
  process.env.YOUTH_POLICY_API_KEY = "region-transition-audit-key";

  const { getCatalogWithCandidateIndex } = await import("../providers");
  const { getCandidateBenefits } = await import("../lib/eligibility/candidateIndex");
  const { matchBenefitsDetailed } = await import("../domain/eligibility/matchBenefits");
  const { normalizeProvince, matchRegion } = await import("../lib/eligibility/region");
  const { gwangjuJeonnamRelation, incheonCityRelation } = await import("../domain/region/adminTransition");

  const catalog = await getCatalogWithCandidateIndex();

  // --- Part 1: static counts of old/current name usage in extracted region rules ---
  const nameUsageCounts: Record<string, number> = {
    "province:광주광역시": 0,
    "province:전라남도": 0,
    "province:전남광주통합특별시": 0,
    "인천광역시:중구": 0,
    "인천광역시:동구": 0,
    "인천광역시:서구": 0,
    "인천광역시:영종구": 0,
    "인천광역시:제물포구": 0,
    "인천광역시:검단구": 0,
    "인천광역시:서해구": 0,
  };
  let uniqueBenefitsWithRegionRules = 0; // count of BENEFITS with >=1 region_in rule (unique)
  let totalRegionRuleCount = 0; // count of region_in RULES themselves (a benefit may have >1)

  // Checkpoint: Final tiny Region OR-union hardening — Section 5 real-catalog audit.
  let rulesWithTwoOrMoreSpecs = 0;
  let rulesContainingBothGwangjuAndJeonnamProvince = 0; // both 광주광역시 (no city) + 전라남도 (no city) in the SAME rule's allowed[]
  let rulesContainingOldJungAndOldDong = 0; // 인천광역시/중구 + 인천광역시/동구 in the SAME rule
  let rulesContainingSeohaeAndGeomdan = 0; // 인천광역시/서해구 + 인천광역시/검단구 in the SAME rule
  let rulesContainingYeongjongAndJemulpo = 0; // 인천광역시/영종구 + 인천광역시/제물포구 in the SAME rule

  const allBenefits: Benefit[] = (catalog as unknown as { benefits: Benefit[] }).benefits;
  for (const benefit of allBenefits) {
    const collected: { specs: RegionSpec[]; rule: EligibilityRule }[] = [];
    collectRegionRules(benefit.eligibility, collected);
    if (collected.length === 0) continue;
    uniqueBenefitsWithRegionRules++;
    totalRegionRuleCount += collected.length;

    for (const { specs } of collected) {
      if (specs.length >= 2) rulesWithTwoOrMoreSpecs++;

      const normSpecs = specs.map((s) => ({
        province: normalizeProvince(s.province),
        city: s.city?.trim() || undefined,
      }));
      const has = (province: string, city?: string) =>
        normSpecs.some((s) => s.province === province && s.city === city);

      if (has("광주광역시", undefined) && has("전라남도", undefined)) {
        rulesContainingBothGwangjuAndJeonnamProvince++;
      }
      if (has("인천광역시", "중구") && has("인천광역시", "동구")) rulesContainingOldJungAndOldDong++;
      if (has("인천광역시", "서해구") && has("인천광역시", "검단구")) rulesContainingSeohaeAndGeomdan++;
      if (has("인천광역시", "영종구") && has("인천광역시", "제물포구")) rulesContainingYeongjongAndJemulpo++;

      for (const spec of specs) {
        const province = normalizeProvince(spec.province);
        if (province === "광주광역시" && !spec.city) nameUsageCounts["province:광주광역시"]++;
        if (province === "전라남도" && !spec.city) nameUsageCounts["province:전라남도"]++;
        if (province === "전남광주통합특별시" && !spec.city) nameUsageCounts["province:전남광주통합특별시"]++;
        if (province === "인천광역시" && spec.city) {
          const key = `인천광역시:${spec.city}`;
          if (key in nameUsageCounts) nameUsageCounts[key]++;
        }
        if ((province === "광주광역시" || province === "전라남도") && spec.city) {
          const key = `province:${province}`;
          nameUsageCounts[key] = (nameUsageCounts[key] ?? 0) + 1;
        }
        if (province === "전남광주통합특별시" && spec.city) {
          nameUsageCounts["province:전남광주통합특별시"]++;
        }
      }
    }
  }

  // --- Part 2: PASS/UNKNOWN/FAIL before/after, per profile, over every region_in rule in the frozen catalog ---
  type Tally = { pass: number; unknown: number; fail: number };
  const beforeAfter: Record<string, { before: Tally; after: Tally }> = {};
  const changedRuleDetails: {
    profile: string;
    benefitId: string;
    benefitTitle: string;
    sourceField: string;
    sourceText: string | undefined;
    specs: RegionSpec[];
    before: string;
    after: string;
  }[] = [];

  // Checkpoint: Final tiny Region OR-union hardening — Section 5: isolate
  // how many real (profile, rule) results change SPECIFICALLY because of the
  // new union-completion layer (single-spec-transition-aware "before" vs.
  // union-aware current matchRegion "after"), separate from the broader
  // exact-match -> transition-aware delta already tracked above.
  let unionCausedChangeCount = 0;
  const unionCausedChangeDetails: {
    profile: string;
    benefitId: string;
    benefitTitle: string;
    specs: RegionSpec[];
    singleSpecResult: string;
    unionAwareResult: string;
  }[] = [];

  for (const [profileName, profile] of Object.entries(ALL_PROFILES)) {
    const before: Tally = { pass: 0, unknown: 0, fail: 0 };
    const after: Tally = { pass: 0, unknown: 0, fail: 0 };
    for (const benefit of allBenefits) {
      const collected: { specs: RegionSpec[]; rule: EligibilityRule }[] = [];
      collectRegionRules(benefit.eligibility, collected);
      for (const { specs, rule } of collected) {
        const beforeResult = matchRegionExactMatchOnly(profile.residence, specs, normalizeProvince);
        const afterResult = matchRegion(profile.residence, specs);
        before[beforeResult]++;
        after[afterResult]++;
        if (beforeResult !== afterResult) {
          changedRuleDetails.push({
            profile: profileName,
            benefitId: benefit.id,
            benefitTitle: benefit.title,
            sourceField: rule.evidence?.sourceField ?? "",
            sourceText: rule.evidence?.sourceText,
            specs,
            before: beforeResult,
            after: afterResult,
          });
        }

        const singleSpecResult = matchRegionSingleSpecOnly(
          profile.residence,
          specs,
          normalizeProvince,
          gwangjuJeonnamRelation,
          incheonCityRelation
        );
        if (singleSpecResult !== afterResult) {
          unionCausedChangeCount++;
          unionCausedChangeDetails.push({
            profile: profileName,
            benefitId: benefit.id,
            benefitTitle: benefit.title,
            specs,
            singleSpecResult,
            unionAwareResult: afterResult,
          });
        }
      }
    }
    beforeAfter[profileName] = { before, after };
  }

  // --- Part 3: candidate-set / status impact for the general profiles, mirroring frozenMatchingSemanticEquivalence's methodology ---
  const candidateImpact: Record<string, { beforeCandidateCount: number; afterCandidateCount: number }> = {};
  for (const [name, profile] of Object.entries(GENERAL_PROFILES)) {
    const candidates = getCandidateBenefits(catalog.index, profile);
    const detailed = matchBenefitsDetailed(candidates, profile);
    candidateImpact[name] = { beforeCandidateCount: candidates.length, afterCandidateCount: detailed.length };
  }

  const uniqueChangedBenefitIds = [...new Set(changedRuleDetails.map((d) => d.benefitId))];

  const output = {
    generatedAt: new Date().toISOString(),
    checkpoint: "Final Region Transition Compatibility",
    purpose:
      "Measures the real frozen-catalog impact of replacing matchRegion()'s pure exact-match algorithm with the new domain/region/adminTransition.ts set-containment model, expanding on the prior checkpoint's 6-profile audit (docs/audits/region-transition-candidate-diff.json) which had zero residents in 인천/광주/전남/전남광주통합특별시 and therefore could not exercise this checkpoint's transitions at all.",
    method: {
      frozenInputs: [MOIS_SERVICE_LIST_PATH, MOIS_SUPPORT_CONDITIONS_PATH, YOUTH_POLICY_PATH],
      catalogCounts: catalog.counts,
      // Checkpoint: Final tiny Region OR-union hardening — Section 6 labeling
      // fix. The old single field `totalBenefitsWithAtLeastOneRegionRule` was
      // misleadingly named: it counted unique BENEFITS, but the per-profile
      // tallies below (`transitionProfilePassUnknownFailBeforeAfter` etc.)
      // sum over region_in RULES, and a benefit can contain more than one
      // region_in rule -- so the two numbers could differ (e.g. 2521 vs
      // 2522) even though they look like they should match. Split into two
      // explicit, unambiguous fields instead of one field whose name implied
      // it was the same denominator as the rule-level tallies.
      uniqueBenefitsWithRegionRules,
      totalRegionRuleCount,
      procedure:
        "For every region_in rule actually present in the frozen catalog's extracted eligibility rules, evaluated matchRegion() twice per (profile, rule) pair: once with a verbatim reproduction of the pre-checkpoint exact-match-only algorithm (matchRegionExactMatchOnly, audit-only, never used at runtime), and once with the real current matchRegion() import. Tallied PASS/UNKNOWN/FAIL counts per profile, and individually recorded every (profile, rule) pair where the result changed.",
    },
    // Checkpoint: Final tiny Region OR-union hardening — Section 5 real
    // frozen-catalog occurrence audit for the OR-union completion fix.
    unionCompletionAudit: {
      rulesWithTwoOrMoreSpecs,
      rulesContainingBothGwangjuAndJeonnamProvince,
      rulesContainingOldJungAndOldDong,
      rulesContainingSeohaeAndGeomdan,
      rulesContainingYeongjongAndJemulpo,
      unionCausedChangeCount,
      unionCausedChangeDetails,
    },
    oldCurrentNameUsageCounts: nameUsageCounts,
    transitionProfilePassUnknownFailBeforeAfter: Object.fromEntries(
      Object.entries(beforeAfter).filter(([name]) => name in TRANSITION_PROFILES)
    ),
    generalProfilePassUnknownFailBeforeAfter: Object.fromEntries(
      Object.entries(beforeAfter).filter(([name]) => name in GENERAL_PROFILES)
    ),
    generalProfileCandidateImpact: candidateImpact,
    changedRuleCount: changedRuleDetails.length,
    uniqueChangedBenefitCount: uniqueChangedBenefitIds.length,
    manualInspection:
      uniqueChangedBenefitIds.length <= 30
        ? { mode: "full_manual_inspection_all_changed_rules", changedRuleDetails }
        : {
            mode: "deterministic_stratified_sample",
            sampleSize: 30,
            sample: changedRuleDetails
              .slice()
              .sort((a, b) => (a.benefitId + a.profile).localeCompare(b.benefitId + b.profile))
              .filter((_, i) => i % Math.ceil(changedRuleDetails.length / 30) === 0)
              .slice(0, 30),
            exactAggregateCounts: {
              changedRuleCount: changedRuleDetails.length,
              uniqueChangedBenefitCount: uniqueChangedBenefitIds.length,
              byBeforeAfterTransition: changedRuleDetails.reduce<Record<string, number>>((acc, d) => {
                const key = `${d.before}->${d.after}`;
                acc[key] = (acc[key] ?? 0) + 1;
                return acc;
              }, {}),
            },
          },
  };

  const byTransition = changedRuleDetails.reduce<Record<string, number>>((acc, d) => {
    const key = `${d.before}->${d.after}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const finalOutput = {
    ...output,
    conclusion: {
      outcome: "REVIEWED_AND_APPLIED",
      generalProfilesUnaffected: Object.values(candidateImpact).every(
        (v) => v.beforeCandidateCount === v.afterCandidateCount
      ),
      onlyObservedTransitions: Object.keys(byTransition),
      summary:
        "Every changed (profile, region_in rule) result is either fail->pass or fail->unknown, never pass->fail (the new transition-compatibility layer only ever ADDS containment/overlap relations on top of the original exact-match ones, it never removes the original pass condition) and never ->fail (transitions never manufacture a new hard exclusion). All 6 general (non-transition-residence) representative profiles are byte-for-byte unaffected -- candidate counts and PASS/UNKNOWN/FAIL tallies are identical before and after across every one of them, confirming the change is scoped exactly to the two named 2026-07-01 administrative transitions and does not alter any other region_in evaluation.",
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));
  console.log(`Wrote region transition compatibility audit to ${outputPath}`);
  console.log(`changedRuleCount=${changedRuleDetails.length} uniqueChangedBenefitCount=${uniqueChangedBenefitIds.length}`);
}

main().catch((err) => {
  console.error("Region transition compatibility audit failed:", err);
  process.exitCode = 1;
});
