/**
 * Phase 4-B §19: codebook coverage report.
 *
 * For every family in the versioned codebook (domain/youthCodebook/table.ts)
 * reports the implementationStatus breakdown (unrestricted/safe/unresolved
 * code counts), and cross-references against the REAL frozen 2,745-record
 * catalog (/tmp/youth_policy_full.json) to report, per rule-building field
 * (mrgSttsCd/jobCd/schoolCd), what fraction of REAL records with a non-blank
 * value in that field actually get a structured rule built (vs. staying
 * unresolved because of an unresolved/unknown code somewhere in their raw
 * value).
 *
 * Run with: npx tsx scripts/youthCodebookCoverageReport.ts
 */
import fs from "node:fs";
import { YOUTH_CODEBOOK } from "../domain/youthCodebook/table";
import { buildEducationStatusRule, buildEmploymentStatusRule, buildMaritalStatusRule } from "../domain/youthCodebook/compatibility";
import type { YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";

const FROZEN_SNAPSHOT_PATH = "/tmp/youth_policy_full.json";

function printCodebookBreakdown() {
  console.log("=== Codebook implementationStatus breakdown (domain/youthCodebook/table.ts) ===\n");
  for (const family of YOUTH_CODEBOOK) {
    const counts = { unrestricted: 0, safe: 0, unresolved: 0 };
    for (const e of family.entries) counts[e.implementationStatus]++;
    console.log(`${family.apiField} (family ${family.familyId}): ${family.entries.length} codes`);
    console.log(`  unrestricted=${counts.unrestricted}  safe=${counts.safe}  unresolved=${counts.unresolved}`);
    for (const e of family.entries) {
      console.log(`    ${e.code}  ${e.label.padEnd(12, " ")}  ${e.implementationStatus}`);
    }
    console.log();
  }
}

interface FieldRuleCoverage {
  apiField: string;
  totalRecords: number;
  nonBlankRecords: number;
  ruleBuiltCount: number;
  noRuleCount: number;
  coveragePctOfNonBlank: string;
}

function computeRuleCoverage(
  raw: YouthRawPolicy[],
  apiField: "mrgSttsCd" | "jobCd" | "schoolCd",
  build: (v: string | undefined) => unknown
): FieldRuleCoverage {
  let nonBlank = 0;
  let ruleBuilt = 0;
  for (const r of raw) {
    const v = (r[apiField] as string | undefined)?.trim();
    if (!v) continue;
    nonBlank++;
    if (build(v) !== undefined) ruleBuilt++;
  }
  return {
    apiField,
    totalRecords: raw.length,
    nonBlankRecords: nonBlank,
    ruleBuiltCount: ruleBuilt,
    noRuleCount: nonBlank - ruleBuilt,
    coveragePctOfNonBlank: nonBlank > 0 ? `${((ruleBuilt / nonBlank) * 100).toFixed(1)}%` : "n/a",
  };
}

function printRealCatalogCoverage() {
  if (!fs.existsSync(FROZEN_SNAPSHOT_PATH)) {
    console.log(`\n(Skipping real-catalog coverage cross-check -- ${FROZEN_SNAPSHOT_PATH} not found.)`);
    return;
  }
  const raw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(FROZEN_SNAPSHOT_PATH, "utf-8"));
  console.log(`\n=== Real-catalog rule-building coverage (${raw.length} frozen 온통청년 records) ===\n`);
  console.log("For each field, of the REAL records with a non-blank raw value, what fraction");
  console.log("actually gets a structured rule built (the rest stay unresolved -- either an");
  console.log("entirely-제한없음/unresolved-only value, or a value containing at least one code");
  console.log("unknown to the official codebook).\n");

  const rows = [
    computeRuleCoverage(raw, "mrgSttsCd", buildMaritalStatusRule),
    computeRuleCoverage(raw, "jobCd", buildEmploymentStatusRule),
    computeRuleCoverage(raw, "schoolCd", buildEducationStatusRule),
  ];
  for (const row of rows) {
    console.log(`${row.apiField}:`);
    console.log(`  totalRecords=${row.totalRecords}  nonBlankRecords=${row.nonBlankRecords}`);
    console.log(`  ruleBuiltCount=${row.ruleBuiltCount}  noRuleCount=${row.noRuleCount}  coverage=${row.coveragePctOfNonBlank} of non-blank`);
  }

  // sbizCd / plcyMajorCd: report raw non-blank frequency only (no rule-building this phase).
  console.log("\nsbizCd / plcyMajorCd (NOT wired into buildEligibility this phase -- raw non-blank frequency only):");
  for (const field of ["sbizCd", "plcyMajorCd"] as const) {
    const nonBlank = raw.filter((r) => (r[field] as string | undefined)?.trim()).length;
    console.log(`  ${field}: nonBlankRecords=${nonBlank} / ${raw.length}`);
  }
}

function main() {
  printCodebookBreakdown();
  printRealCatalogCoverage();
}

main();
