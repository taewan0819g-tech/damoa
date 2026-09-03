/**
 * Phase 4-B §17: full-catalog equivalence sweep for the new Youth
 * marital/employment/education `status_compat` rules against
 * `lib/eligibility/candidateIndex.ts`'s indexed retrieval path.
 *
 * Loads the SAME frozen 2,745-record snapshot used by the Phase 4-A audit
 * (/tmp/youth_policy_full.json), runs every record through the REAL
 * `normalizeYouthPolicy` (adapters/youthCenter/YouthAdapter.ts) to build the
 * actual production Benefit objects (not synthetic fixtures), builds ONE
 * real `CandidateIndex` over them, then sweeps every combination of
 * maritalStatus x employmentStatus x educationStatus (each either "missing"
 * or one of its full UserProfile domain value) through BOTH
 * `getCandidateBenefits` (indexed) and `getCandidateBenefitsFullScan` (O(n)
 * reference implementation), comparing the two result sets exactly.
 *
 * `candidateIndex.test.ts` already property-tests the GENERIC indexing
 * logic against synthetic benefits; this script instead proves the SPECIFIC
 * real Youth catalog + the real `buildMaritalStatusRule`/
 * `buildEmploymentStatusRule`/`buildEducationStatusRule` wiring produces
 * zero indexed-vs-full-scan disagreements end to end.
 *
 * Run with: npx tsx scripts/sweepYouthCandidateIndexEquivalence.ts
 *
 * mismatchCount MUST print 0 — any nonzero value is a correctness bug in the
 * index (a benefit incorrectly pruned, or incorrectly kept) and must block
 * Phase 4-B from shipping.
 */
import fs from "node:fs";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { buildCandidateIndex, getCandidateBenefits, getCandidateBenefitsFullScan } from "../lib/eligibility/candidateIndex";
import type { UserProfile } from "../types/profile";

const FROZEN_SNAPSHOT_PATH = "/tmp/youth_policy_full.json";

const MARITAL_VALUES: (UserProfile["maritalStatus"] | undefined)[] = [
  undefined,
  "single",
  "married",
  "divorced",
  "widowed",
];
const EMPLOYMENT_VALUES: (UserProfile["employmentStatus"] | undefined)[] = [
  undefined,
  "employed",
  "unemployed",
  "self_employed",
  "freelancer",
  "student",
  "other",
];
const EDUCATION_VALUES: (UserProfile["educationStatus"] | undefined)[] = [
  undefined,
  "high_school",
  "university",
  "graduate_school",
  "graduated",
  "not_applicable",
];

function main() {
  if (!fs.existsSync(FROZEN_SNAPSHOT_PATH)) {
    console.error(`Frozen snapshot not found at ${FROZEN_SNAPSHOT_PATH} -- cannot run the sweep.`);
    process.exit(1);
  }
  const raw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(FROZEN_SNAPSHOT_PATH, "utf-8"));
  console.log(`Loaded ${raw.length} frozen 온통청년 records from ${FROZEN_SNAPSHOT_PATH}`);

  const benefits = raw.map((r) => normalizeYouthPolicy(r));
  const index = buildCandidateIndex(benefits);

  console.log("\n=== Index shape over the real Youth catalog ===");
  console.log("unconstrained:", index.unconstrained.length);
  console.log("constrained:", index.constrained.length);
  console.log("dimensionCounts:", index.dimensionCounts);

  let combosSwept = 0;
  let mismatchCount = 0;
  const mismatchSamples: { profile: UserProfile; onlyIndexed: string[]; onlyFullScan: string[] }[] = [];

  for (const maritalStatus of MARITAL_VALUES) {
    for (const employmentStatus of EMPLOYMENT_VALUES) {
      for (const educationStatus of EDUCATION_VALUES) {
        const profile: UserProfile = {};
        if (maritalStatus !== undefined) profile.maritalStatus = maritalStatus;
        if (employmentStatus !== undefined) profile.employmentStatus = employmentStatus;
        if (educationStatus !== undefined) profile.educationStatus = educationStatus;

        combosSwept++;
        const indexed = new Set(getCandidateBenefits(index, profile).map((b) => b.id));
        const fullScan = new Set(getCandidateBenefitsFullScan(index, profile).map((b) => b.id));

        const onlyIndexed = [...indexed].filter((id) => !fullScan.has(id));
        const onlyFullScan = [...fullScan].filter((id) => !indexed.has(id));

        if (onlyIndexed.length > 0 || onlyFullScan.length > 0) {
          mismatchCount++;
          if (mismatchSamples.length < 20) {
            mismatchSamples.push({ profile, onlyIndexed, onlyFullScan });
          }
        }
      }
    }
  }

  console.log(`\n=== Sweep result: ${MARITAL_VALUES.length} marital x ${EMPLOYMENT_VALUES.length} employment x ${EDUCATION_VALUES.length} education = ${combosSwept} combinations ===`);
  console.log("mismatchCount:", mismatchCount);

  if (mismatchCount > 0) {
    console.error("\nMISMATCH SAMPLES (first 20):");
    console.error(JSON.stringify(mismatchSamples, null, 2));
    console.error("\nFAIL: indexed retrieval disagrees with full-scan reference. This is a correctness bug.");
    process.exit(1);
  }

  console.log("\nPASS: indexed retrieval agrees with full-scan reference on every swept combination.");
}

main();
