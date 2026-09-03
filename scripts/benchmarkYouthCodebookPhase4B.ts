/**
 * Phase 4-B §18: before/after frozen benchmark for the Youth codebook
 * production integration.
 *
 * This script is DELIBERATELY written with only relative imports (no `@/`
 * aliases) so the EXACT SAME file can run unmodified inside a temporary git
 * worktree checked out at the pre-Phase-4 commit
 * (main@a4d50f60597d2ef2851a41a335a03f8e8c41f7e7) as well as on this branch
 * (wip/youth-codebook-phase4) — the "before" and "after" runs are the same
 * code exercising two different snapshots of adapters/domain/lib.
 *
 * Both runs load the SAME frozen catalog snapshot
 * (/tmp/youth_policy_full.json, 2,745 real 온통청년 records) so any
 * difference in the reported metrics is caused ONLY by the Phase 4-B code
 * changes, never by catalog drift.
 *
 * Usage:
 *   npx tsx scripts/benchmarkYouthCodebookPhase4B.ts --label before --out /tmp/youth_phase4b_before.json
 *   npx tsx scripts/benchmarkYouthCodebookPhase4B.ts --label after  --out /tmp/youth_phase4b_after.json
 *
 * Then compare the two JSON reports (see the printed comparison table when
 * both files exist at the time "after" runs).
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import {
  buildCandidateIndex,
  getCandidateBenefitsFullScan,
  getCandidateBenefitsWithDiagnostics,
} from "../lib/eligibility/candidateIndex";
import { evaluateEligibilityDetailed } from "../lib/eligibility/ruleEngine";
import type { UserProfile } from "../types/profile";
import type { EligibilityStatus } from "../types/benefit";

const FROZEN_SNAPSHOT_PATH = "/tmp/youth_policy_full.json";

// --- 7 named profiles, A -> G, increasing richness. A-D mirror
// benchmarkCandidateRetrieval.ts's existing age/region/income progression;
// E-G add the three NEW Phase 4-B dimensions (marital/employment/education)
// one at a time, then combined. ---
function profileA(): UserProfile {
  return {}; // fully unknown -- baseline, nothing prunable.
}
function profileB(): UserProfile {
  return { birthDate: "2000-01-01" }; // 26세 청년, age known.
}
function profileC(): UserProfile {
  return { ...profileB(), residence: { province: "서울특별시" } };
}
function profileD(): UserProfile {
  return { ...profileC(), individualIncomeBand: "2000_3000" };
}
function profileE(): UserProfile {
  return { ...profileD(), maritalStatus: "single" };
}
function profileF(): UserProfile {
  return { ...profileD(), employmentStatus: "unemployed" };
}
function profileG(): UserProfile {
  // Combined: a realistic "young unemployed single job-seeker, currently in
  // university" persona -- exercises all three new dimensions together
  // alongside the pre-existing age/region/income ones.
  return {
    ...profileD(),
    maritalStatus: "single",
    employmentStatus: "unemployed",
    educationStatus: "university",
  };
}

const PROFILES: { label: string; profile: UserProfile }[] = [
  { label: "A (fully unknown)", profile: profileA() },
  { label: "B (+age)", profile: profileB() },
  { label: "C (+region)", profile: profileC() },
  { label: "D (+income)", profile: profileD() },
  { label: "E (+maritalStatus)", profile: profileE() },
  { label: "F (+employmentStatus)", profile: profileF() },
  { label: "G (combined: age+region+income+marital+employment+education)", profile: profileG() },
];

interface ProfileMetrics {
  label: string;
  candidateCount: number;
  fullScanCandidateCount: number;
  indexedLookupCount: number;
  fallbackScanCount: number;
  matchesFullScanExactly: boolean;
  likelyEligibleCount: number;
  notEligibleCount: number;
  unknownCount: number;
  hasPositiveEvidenceCount: number;
  downgradedFromPassCount: number;
}

interface BenchmarkReport {
  label: string;
  gitCommit: string;
  catalogSize: number;
  indexShape: {
    unconstrained: number;
    constrained: number;
    dimensionCounts: Record<string, number>;
  };
  profiles: ProfileMetrics[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const label = get("--label") ?? "unlabeled";
  const out = get("--out") ?? `/tmp/youth_phase4b_${label}.json`;
  return { label, out };
}

function main() {
  const { label, out } = parseArgs();

  if (!fs.existsSync(FROZEN_SNAPSHOT_PATH)) {
    console.error(`Frozen snapshot not found at ${FROZEN_SNAPSHOT_PATH} -- cannot run the benchmark.`);
    process.exit(1);
  }
  const raw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(FROZEN_SNAPSHOT_PATH, "utf-8"));
  const benefits = raw.map((r) => normalizeYouthPolicy(r));
  const index = buildCandidateIndex(benefits);

  const profileMetrics: ProfileMetrics[] = PROFILES.map(({ label: pLabel, profile }) => {
    const { candidates, diagnostics } = getCandidateBenefitsWithDiagnostics(index, profile);
    const fullScanCandidates = getCandidateBenefitsFullScan(index, profile);
    const indexedIds = new Set(candidates.map((b) => b.id));
    const fullScanIds = new Set(fullScanCandidates.map((b) => b.id));
    const matchesFullScanExactly =
      indexedIds.size === fullScanIds.size && [...indexedIds].every((id) => fullScanIds.has(id));

    const statusCounts: Record<EligibilityStatus, number> = {
      likely_eligible: 0,
      not_eligible: 0,
      unknown: 0,
    };
    let hasPositiveEvidenceCount = 0;
    let downgradedFromPassCount = 0;
    for (const b of candidates) {
      const diag = evaluateEligibilityDetailed(b, profile);
      statusCounts[diag.status]++;
      if (diag.hasPositiveEvidence) hasPositiveEvidenceCount++;
      if (diag.downgradedFromPass) downgradedFromPassCount++;
    }

    return {
      label: pLabel,
      candidateCount: candidates.length,
      fullScanCandidateCount: fullScanCandidates.length,
      indexedLookupCount: diagnostics.indexedLookupCount,
      fallbackScanCount: diagnostics.fallbackScanCount,
      matchesFullScanExactly,
      likelyEligibleCount: statusCounts.likely_eligible,
      notEligibleCount: statusCounts.not_eligible,
      unknownCount: statusCounts.unknown,
      hasPositiveEvidenceCount,
      downgradedFromPassCount,
    };
  });

  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse HEAD").toString().trim();
  } catch {
    // best-effort only
  }

  const report: BenchmarkReport = {
    label,
    gitCommit,
    catalogSize: benefits.length,
    indexShape: {
      unconstrained: index.unconstrained.length,
      constrained: index.constrained.length,
      dimensionCounts: index.dimensionCounts,
    },
    profiles: profileMetrics,
  };

  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`Wrote report (label=${label}, commit=${gitCommit}) to ${out}`);
  console.log(JSON.stringify(report, null, 2));
}

main();
