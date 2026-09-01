/**
 * One-off benchmark for the indexed candidate-retrieval layer
 * (lib/eligibility/candidateIndex.ts). Not part of the app or test suite —
 * run manually with:
 *
 *   node --env-file=.env.local -r tsx/cjs scripts/benchmarkCandidateRetrieval.ts
 *
 * Fetches the REAL merged catalog (MOIS + Youth Center, via
 * providers/index.ts, which reads MOIS_API_KEY / YOUTH_POLICY_API_KEY from
 * process.env) if configured, builds the candidate index once, then runs a
 * handful of profiles of increasing richness (A: age only, B: +region,
 * C: +income, D: +education+housing) through both the new indexed retrieval
 * path and the old full-scan reference implementation, reporting exactly
 * how many policies each request actually touched.
 */
import { getCatalogWithCandidateIndex } from "../providers/index";
import {
  getCandidateBenefitsFullScan,
  getCandidateBenefitsWithDiagnostics,
} from "../lib/eligibility/candidateIndex";
import type { UserProfile } from "../types/profile";

function profileA(): UserProfile {
  return { birthDate: "2000-01-01" };
}
function profileB(): UserProfile {
  return { ...profileA(), residence: { province: "서울특별시" } };
}
function profileC(): UserProfile {
  return { ...profileB(), individualIncomeBand: "2000_3000" };
}
function profileD(): UserProfile {
  return { ...profileC(), educationStatus: "university", housingType: "jeonse", homeowner: false };
}

async function main() {
  console.log("MOIS_API_KEY set:", Boolean(process.env.MOIS_API_KEY));
  console.log("YOUTH_POLICY_API_KEY set:", Boolean(process.env.YOUTH_POLICY_API_KEY));

  const fetchStart = performance.now();
  const catalog = await getCatalogWithCandidateIndex();
  const fetchMs = performance.now() - fetchStart;

  console.log("\n=== Catalog counts ===");
  console.log(catalog.counts);
  console.log(`personalizable (active+dateUnknown) benefit count: ${catalog.benefits.length}`);
  console.log(`catalog fetch+classify+index-build time: ${fetchMs.toFixed(1)}ms`);

  const index = catalog.index;
  console.log("\n=== Index shape ===");
  console.log("unconstrained:", index.unconstrained.length);
  console.log("constrained:", index.constrained.length);
  console.log("dimensionCounts:", index.dimensionCounts);
  console.log("ageIndex items (byMinAsc):", index.ageIndex.byMinAsc.length, "fallback:", index.ageIndex.fallback.length);
  console.log(
    "incomeIndex fields:",
    [...index.incomeIndex.byField.entries()].map(([f, idx]) => `${f}:${idx.byMinAsc.length}`),
    "fallback:",
    index.incomeIndex.fallback.length
  );
  console.log("regionIndex provinces:", index.regionIndex.byProvince.size, "total region entries:", index.regionIndex.all.length);
  console.log(
    "categoricalIndex sizes:",
    [...index.categoricalIndex.entries()].map(([d, m]) => `${d}:${m.size} keys`)
  );
  console.log("targetScopeIndex:", {
    alwaysFail: index.targetScopeIndex.alwaysFail.length,
    businessOwnerRelevant: index.targetScopeIndex.businessOwnerRelevant.length,
    fallback: index.targetScopeIndex.fallback.length,
  });

  const profiles: { label: string; profile: UserProfile }[] = [
    { label: "A (age only)", profile: profileA() },
    { label: "B (+region)", profile: profileB() },
    { label: "C (+income)", profile: profileC() },
    { label: "D (+education+housing)", profile: profileD() },
  ];

  console.log("\n=== Per-profile funnel (indexed retrieval) ===");
  for (const { label, profile } of profiles) {
    const t0 = performance.now();
    const { candidates, diagnostics } = getCandidateBenefitsWithDiagnostics(index, profile);
    const indexedMs = performance.now() - t0;

    const t1 = performance.now();
    const fullScanCandidates = getCandidateBenefitsFullScan(index, profile);
    const fullScanMs = performance.now() - t1;

    const idsIndexed = new Set(candidates.map((b) => b.id));
    const idsFullScan = new Set(fullScanCandidates.map((b) => b.id));
    const equivalent =
      idsIndexed.size === idsFullScan.size && [...idsIndexed].every((id) => idsFullScan.has(id));

    console.log(`\n-- Profile ${label} --`);
    console.log("activeCatalogCount:", catalog.benefits.length);
    console.log("indexedLookupCount:", diagnostics.indexedLookupCount);
    console.log("fallbackScanCount:", diagnostics.fallbackScanCount);
    console.log("totalTouchedCount (indexedLookupCount+fallbackScanCount):", diagnostics.indexedLookupCount + diagnostics.fallbackScanCount);
    console.log("finalCandidateCount:", diagnostics.finalCandidateCount);
    console.log("indexed retrieval time:", `${indexedMs.toFixed(3)}ms`);
    console.log("full-scan reference time:", `${fullScanMs.toFixed(3)}ms`);
    console.log("matches full-scan reference exactly:", equivalent);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
