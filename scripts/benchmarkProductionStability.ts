/**
 * Phase 5 (Production Stabilization) production-stability benchmark.
 *
 * Exercises the REAL provider layer (MOISBenefitProvider,
 * YouthCenterBenefitProvider, providers/index.ts's merge/classification/
 * candidate-index pipeline, and a representative matching pass) end-to-end,
 * but with `global.fetch` stubbed to serve the frozen snapshots instead of
 * hitting any live upstream API — consistent with this repo's existing
 * frozen-snapshot-driven benchmark/audit scripts and with §15 (CI/scripts
 * must not depend on api.odcloud.kr or youthcenter.go.kr being reachable).
 *
 * Reports:
 *   - COLD timing: first `getBenefits()` call per provider (full pagination
 *     + normalization, resilientCache empty).
 *   - WARM timing: second call immediately after (resilientCache hit).
 *   - Merged/classified catalog counts (MOIS, Youth, merged, active/expired/
 *     upcoming/date-unknown).
 *   - A representative personalized matching request's timing
 *     (`getCatalogWithCandidateIndex` + candidate retrieval + full rule
 *     engine), run once cold (right after catalog warms up) and once warm
 *     (index cache hit).
 *
 * Run with: npx tsx scripts/benchmarkProductionStability.ts
 */
import fs from "node:fs";

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

function ms(n: number): string {
  return `${n.toFixed(1)}ms`;
}

async function main() {
  const missing = [MOIS_SERVICE_LIST_PATH, MOIS_SUPPORT_CONDITIONS_PATH, YOUTH_POLICY_PATH].filter(
    (p) => !fs.existsSync(p)
  );
  if (missing.length > 0) {
    console.log(`Skipping benchmark -- missing frozen snapshot(s): ${missing.join(", ")}`);
    return;
  }

  const moisServiceList = JSON.parse(fs.readFileSync(MOIS_SERVICE_LIST_PATH, "utf-8"));
  const moisSupportConditions = JSON.parse(fs.readFileSync(MOIS_SUPPORT_CONDITIONS_PATH, "utf-8"));
  const youthPolicies = JSON.parse(fs.readFileSync(YOUTH_POLICY_PATH, "utf-8"));

  console.log(
    `Frozen snapshot sizes: MOIS serviceList=${moisServiceList.length}, MOIS supportConditions=${moisSupportConditions.length}, Youth policies=${youthPolicies.length}\n`
  );

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
        // Not exercised by getBenefits() -- only relevant to single-record lookups.
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
    throw new Error(`Unexpected URL in benchmark: ${url.toString()}`);
  };
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  process.env.MOIS_API_KEY = "benchmark-key";
  process.env.YOUTH_POLICY_API_KEY = "benchmark-key";

  const { MOISBenefitProvider } = await import("../providers/MOISBenefitProvider");
  const { YouthCenterBenefitProvider } = await import("../providers/YouthCenterBenefitProvider");
  const moisProvider = new MOISBenefitProvider();
  const youthProvider = new YouthCenterBenefitProvider();

  console.log("=== Provider catalog build timing (cold vs. warm) ===\n");

  let t0 = performance.now();
  const moisColdBenefits = await moisProvider.getBenefits();
  const moisColdMs = performance.now() - t0;

  t0 = performance.now();
  const moisWarmBenefits = await moisProvider.getBenefits();
  const moisWarmMs = performance.now() - t0;

  console.log(`MOIS   cold: ${ms(moisColdMs)}  (${moisColdBenefits.length} benefits)`);
  console.log(`MOIS   warm: ${ms(moisWarmMs)}  (${moisWarmBenefits.length} benefits, same reference: ${moisWarmBenefits === moisColdBenefits})`);
  console.log(`MOIS   health: ${JSON.stringify(moisProvider.getHealthStatus())}\n`);

  t0 = performance.now();
  const youthColdBenefits = await youthProvider.getBenefits();
  const youthColdMs = performance.now() - t0;

  t0 = performance.now();
  const youthWarmBenefits = await youthProvider.getBenefits();
  const youthWarmMs = performance.now() - t0;

  console.log(`Youth  cold: ${ms(youthColdMs)}  (${youthColdBenefits.length} benefits)`);
  console.log(`Youth  warm: ${ms(youthWarmMs)}  (${youthWarmBenefits.length} benefits, same reference: ${youthWarmBenefits === youthColdBenefits})`);
  console.log(`Youth  health: ${JSON.stringify(youthProvider.getHealthStatus())}\n`);

  console.log("=== Merged catalog + candidate index (via providers/index.ts) ===\n");

  const { getCatalogWithCandidateIndex } = await import("../providers");

  t0 = performance.now();
  const catalogCold = await getCatalogWithCandidateIndex();
  const catalogColdMs = performance.now() - t0;

  t0 = performance.now();
  const catalogWarm = await getCatalogWithCandidateIndex();
  const catalogWarmMs = performance.now() - t0;

  console.log(`Catalog+index cold: ${ms(catalogColdMs)}`);
  console.log(`Catalog+index warm: ${ms(catalogWarmMs)}  (same benefits reference: ${catalogWarm.benefits === catalogCold.benefits})`);
  console.log(`Counts: ${JSON.stringify(catalogCold.counts)}\n`);

  console.log("=== Representative personalized matching request timing ===\n");

  const { getCandidateBenefits } = await import("../lib/eligibility/candidateIndex");
  const { matchBenefitsDetailed } = await import("../domain/eligibility/matchBenefits");

  const representativeProfile = {
    birthDate: "2000-01-01",
    residence: { province: "서울특별시", city: "강남구" },
    maritalStatus: "single" as const,
    employmentStatus: "unemployed" as const,
    educationStatus: "university" as const,
    individualIncomeBand: "under_1000" as const,
  };

  t0 = performance.now();
  const candidates = getCandidateBenefits(catalogWarm.index, representativeProfile);
  const detailed = matchBenefitsDetailed(candidates, representativeProfile);
  const matchMs = performance.now() - t0;

  console.log(
    `Matching request: ${ms(matchMs)}  (candidates=${candidates.length}/${catalogWarm.benefits.length}, evaluated=${detailed.length})`
  );

  console.log("\n=== Summary ===\n");
  console.log(`MOIS catalog:   ${moisColdBenefits.length} records`);
  console.log(`Youth catalog:  ${youthColdBenefits.length} records`);
  console.log(`Merged catalog: ${catalogCold.counts.sourceCatalogCount} records`);
  console.log(`Cold total (MOIS+Youth+catalog+index): ${ms(moisColdMs + youthColdMs + catalogColdMs)}`);
  console.log(`Warm total (MOIS+Youth+catalog+index): ${ms(moisWarmMs + youthWarmMs + catalogWarmMs)}`);
  console.log(`Matching request timing: ${ms(matchMs)}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
