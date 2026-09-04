/**
 * Phase 5 (Production Stabilization) §20 frozen semantic-equivalence dump.
 *
 * Loads the frozen MOIS + Youth snapshots (same three files used by
 * scripts/benchmarkProductionStability.ts), stubs `global.fetch` to serve
 * them (never a live upstream API — §15), builds the real merged catalog +
 * candidate index via the actual provider layer, and runs a fixed set of
 * representative profiles through the exact same candidate-retrieval + rule
 * -engine pipeline `app/api/benefits/match/route.ts` uses.
 *
 * Dumps a deterministic JSON snapshot of, per profile: the sorted candidate
 * benefit ids, and the sorted {id, status} pairs from the full rule engine.
 * This script is run TWICE — once checked out at the pre-Phase-5 base SHA
 * (dda9248654d5d9abb6059b3fd70ba62a35fc9353) and once on the current
 * stabilization branch, both against the SAME frozen inputs — and the two
 * dumps are diffed to confirm 0 semantic mismatches (see the Phase 5 report
 * for the actual comparison run). This script intentionally only calls
 * exports that are stable across both versions
 * (MOISBenefitProvider/YouthCenterBenefitProvider classes,
 * getCatalogWithCandidateIndex, getCandidateBenefits, matchBenefitsDetailed)
 * so the identical file can be used unmodified against either checkout.
 *
 * Run with: npx tsx scripts/frozenMatchingSemanticEquivalence.ts [outputPath]
 * Default outputPath: /tmp/frozen_matching_semantic_equivalence.json
 */
import fs from "node:fs";
import type { UserProfile } from "../types/profile";

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

/**
 * A fixed, representative spread of profiles — deliberately including an
 * entirely-empty profile (maximum ambiguity/candidate breadth) and profiles
 * that vary marital/employment/education/income/region, since those are
 * exactly the dimensions Phase 4-B's rule-building and this Phase's
 * provider/cache changes could interact with.
 */
const REPRESENTATIVE_PROFILES: Record<string, UserProfile> = {
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

async function main() {
  const outputPath = process.argv[2] ?? "/tmp/frozen_matching_semantic_equivalence.json";

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
          currentCount: data.length,
          data,
          matchCount: moisServiceList.length,
          page,
          perPage,
          totalCount: moisServiceList.length,
        });
      }
      if (url.pathname.endsWith("/supportConditions")) {
        const data = paginate(moisSupportConditions, page, perPage);
        return jsonResponse({
          currentCount: data.length,
          data,
          matchCount: moisSupportConditions.length,
          page,
          perPage,
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
        resultCode: 200,
        resultMessage: "OK",
        result: { pagging: { totCount: youthPolicies.length, pageNum, pageSize }, youthPolicyList },
      });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  process.env.MOIS_API_KEY = "semantic-equivalence-key";
  process.env.YOUTH_POLICY_API_KEY = "semantic-equivalence-key";

  const { getCatalogWithCandidateIndex } = await import("../providers");
  const { getCandidateBenefits } = await import("../lib/eligibility/candidateIndex");
  const { matchBenefitsDetailed } = await import("../domain/eligibility/matchBenefits");

  const catalog = await getCatalogWithCandidateIndex();

  const results: Record<
    string,
    { candidateIds: string[]; statuses: { id: string; status: string; hasPositiveEvidence: boolean }[] }
  > = {};

  for (const [name, profile] of Object.entries(REPRESENTATIVE_PROFILES)) {
    const candidates = getCandidateBenefits(catalog.index, profile);
    const detailed = matchBenefitsDetailed(candidates, profile);
    results[name] = {
      candidateIds: candidates.map((b) => b.id).sort(),
      statuses: detailed
        .map((m) => ({ id: m.benefitId, status: m.status, hasPositiveEvidence: m.hasPositiveEvidence }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  const output = {
    catalogCounts: catalog.counts,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Wrote semantic-equivalence snapshot to ${outputPath}`);
  console.log(`Catalog counts: ${JSON.stringify(catalog.counts)}`);
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${name}: candidates=${r.candidateIds.length} statuses=${r.statuses.length}`);
  }
}

main().catch((err) => {
  console.error("Frozen semantic-equivalence dump failed:", err);
  process.exitCode = 1;
});
