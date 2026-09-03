/**
 * Phase 4-B §19 codebook coverage report — REWRITTEN during the Phase 4-B
 * pre-merge cleanup (§2/§7) to report TRUE per-field record counts instead
 * of the earlier "no rule built = unresolved" approximation, which wrongly
 * lumped a family's own 제한없음(unrestricted) code in with genuinely
 * unresolved data.
 *
 * For every family in the versioned codebook (domain/youthCodebook/table.ts)
 * reports the implementationStatus breakdown (unrestricted/safe/unresolved
 * code counts), and cross-references against the REAL frozen 2,745-record
 * catalog (/tmp/youth_policy_full.json) to report, per rule-building field
 * (mrgSttsCd/earnCndSeCd/jobCd/schoolCd/sbizCd/plcyMajorCd/zipCd), the TRUE
 * per-record classification breakdown:
 *   missing / unrestricted / fullyStructured /
 *   partiallyStructuredWithUnresolvedBranch / unresolvedOnly / unknownCode
 * (see domain/youthCodebook/types.ts's `YouthDimensionStatus` for the exact
 * definition of each bucket), plus `ruleBuiltCount` reported SEPARATELY
 * (never derived as `nonBlank - ruleBuilt`, which conflates "unrestricted"
 * with "unresolved").
 *
 * Also reports real-catalog `hasUnresolvedEligibility`/structured-evidence
 * cross-cuts (§7): policies with a newly built marital/job/school rule,
 * policies with `hasUnresolvedEligibility: true`, policies with zero
 * structured rules but unresolved eligibility, and policies with BOTH
 * positive structured evidence and an unresolved branch remaining.
 *
 * Run with: npx tsx scripts/youthCodebookCoverageReport.ts
 */
import fs from "node:fs";
import { YOUTH_CODEBOOK } from "../domain/youthCodebook/table";
import { classifyYouthDimension } from "../domain/youthCodebook/compatibility";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import type { EligibilityRule, EligibilityRuleGroup } from "../types/benefit";

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

// ---------------------------------------------------------------------------
// True per-field, per-record classification (§2/§7).
// ---------------------------------------------------------------------------

interface FieldCoverage {
  apiField: string;
  totalRecords: number;
  missing: number;
  unrestricted: number;
  fullyStructured: number;
  partiallyStructuredWithUnresolvedBranch: number;
  unresolvedOnly: number;
  unknownCode: number;
  /** Reported SEPARATELY from the classification buckets above — never derived as nonBlank - ruleBuilt. */
  ruleBuiltCount: number;
}

/** The 6 codebook-covered fields classifyYouthDimension understands (has a family in table.ts). */
const CODEBOOK_FIELDS = ["mrgSttsCd", "earnCndSeCd", "jobCd", "schoolCd", "sbizCd", "plcyMajorCd"] as const;

/** The specific EligibilityRule `id`s YouthAdapter.ts emits for each codebook field, when it emits one at all. */
const RULE_IDS_BY_FIELD: Record<(typeof CODEBOOK_FIELDS)[number], readonly string[]> = {
  mrgSttsCd: ["youth-marital"],
  earnCndSeCd: ["youth-income", "youth-income-max", "youth-income-min"],
  jobCd: ["youth-employment"],
  schoolCd: ["youth-education"],
  sbizCd: [], // never wired into a rule this phase
  plcyMajorCd: [], // never wired into a rule this phase
};

/** Flattens a benefit's eligibility rule tree to its leaf rule ids (Youth records are always flat, but guard the union type anyway). */
function leafRuleIds(group: EligibilityRuleGroup | undefined): Set<string> {
  const ids = new Set<string>();
  if (!group) return ids;
  const visit = (node: EligibilityRuleGroup | EligibilityRule) => {
    if ("id" in node) {
      ids.add(node.id);
    } else {
      for (const child of node.rules) visit(child);
    }
  };
  for (const rule of group.rules) visit(rule);
  return ids;
}

function computeFieldCoverage(raw: YouthRawPolicy[], apiField: (typeof CODEBOOK_FIELDS)[number]): FieldCoverage {
  const coverage: FieldCoverage = {
    apiField,
    totalRecords: raw.length,
    missing: 0,
    unrestricted: 0,
    fullyStructured: 0,
    partiallyStructuredWithUnresolvedBranch: 0,
    unresolvedOnly: 0,
    unknownCode: 0,
    ruleBuiltCount: 0,
  };
  const ruleIds = RULE_IDS_BY_FIELD[apiField];
  for (const r of raw) {
    const classification = classifyYouthDimension(apiField, r[apiField] as string | undefined);
    switch (classification.status) {
      case "missing":
        coverage.missing++;
        break;
      case "unrestricted":
        coverage.unrestricted++;
        break;
      case "fully_structured":
        coverage.fullyStructured++;
        break;
      case "partially_structured_with_unresolved_branch":
        coverage.partiallyStructuredWithUnresolvedBranch++;
        break;
      case "unresolved":
        coverage.unresolvedOnly++;
        break;
      case "unknown_code":
        coverage.unknownCode++;
        break;
    }
    if (ruleIds.length > 0) {
      const benefit = normalizeYouthPolicy(r);
      const ids = leafRuleIds(benefit.eligibility);
      if (ruleIds.some((id) => ids.has(id))) coverage.ruleBuiltCount++;
    }
  }
  return coverage;
}

/**
 * zipCd has NO codebook family at all (see domain/youthCodebook/provenance.ts's
 * ZIP_CD_PROVENANCE) — `classifyYouthDimension` can't be used for it the same
 * way (every code would trivially classify as "unknown_code" since there's no
 * family to check against, which would be a misleading label for "we simply
 * haven't verified this code system yet"). Classified directly instead:
 * missing when blank, unresolvedOnly when populated (never a rule, always
 * real region-eligibility data we don't structure — §4/§9).
 */
function computeZipCdCoverage(raw: YouthRawPolicy[]): FieldCoverage {
  const coverage: FieldCoverage = {
    apiField: "zipCd",
    totalRecords: raw.length,
    missing: 0,
    unrestricted: 0,
    fullyStructured: 0,
    partiallyStructuredWithUnresolvedBranch: 0,
    unresolvedOnly: 0,
    unknownCode: 0,
    ruleBuiltCount: 0,
  };
  for (const r of raw) {
    if (r.zipCd && r.zipCd.trim() !== "") coverage.unresolvedOnly++;
    else coverage.missing++;
  }
  return coverage;
}

function printFieldCoverage(c: FieldCoverage) {
  console.log(`${c.apiField}:`);
  console.log(`  totalRecords=${c.totalRecords}`);
  console.log(
    `  missing=${c.missing}  unrestricted=${c.unrestricted}  fullyStructured=${c.fullyStructured}  ` +
      `partiallyStructuredWithUnresolvedBranch=${c.partiallyStructuredWithUnresolvedBranch}  ` +
      `unresolvedOnly=${c.unresolvedOnly}  unknownCode=${c.unknownCode}`
  );
  console.log(`  ruleBuiltCount=${c.ruleBuiltCount}  (reported separately -- NOT derived as nonBlank - ruleBuilt)`);
}

// ---------------------------------------------------------------------------
// Policy-level cross-cuts (§7).
// ---------------------------------------------------------------------------

interface PolicyLevelStats {
  totalRecords: number;
  withNewMaritalJobSchoolRule: number;
  withHasUnresolvedEligibility: number;
  withZeroStructuredRulesButUnresolved: number;
  withPositiveStructuredEvidenceAndUnresolvedBranch: number;
}

function computePolicyLevelStats(raw: YouthRawPolicy[]): PolicyLevelStats {
  const newRuleIds = new Set(["youth-marital", "youth-employment", "youth-education"]);
  const stats: PolicyLevelStats = {
    totalRecords: raw.length,
    withNewMaritalJobSchoolRule: 0,
    withHasUnresolvedEligibility: 0,
    withZeroStructuredRulesButUnresolved: 0,
    withPositiveStructuredEvidenceAndUnresolvedBranch: 0,
  };
  for (const r of raw) {
    const benefit = normalizeYouthPolicy(r);
    const ids = leafRuleIds(benefit.eligibility);
    const hasNewRule = [...ids].some((id) => newRuleIds.has(id));
    const hasAnyStructuredRule = ids.size > 0;
    const unresolved = benefit.hasUnresolvedEligibility === true;

    if (hasNewRule) stats.withNewMaritalJobSchoolRule++;
    if (unresolved) stats.withHasUnresolvedEligibility++;
    if (!hasAnyStructuredRule && unresolved) stats.withZeroStructuredRulesButUnresolved++;
    if (hasAnyStructuredRule && unresolved) stats.withPositiveStructuredEvidenceAndUnresolvedBranch++;
  }
  return stats;
}

function printRealCatalogCoverage() {
  if (!fs.existsSync(FROZEN_SNAPSHOT_PATH)) {
    console.log(`\n(Skipping real-catalog coverage cross-check -- ${FROZEN_SNAPSHOT_PATH} not found.)`);
    return;
  }
  const raw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(FROZEN_SNAPSHOT_PATH, "utf-8"));
  console.log(`\n=== Real-catalog per-field classification (${raw.length} frozen 온통청년 records) ===\n`);
  console.log(
    'TRUE per-record classification -- "unrestricted" (the family\'s own 제한없음) is reported\n' +
      'separately from genuinely unresolved data, and a multi-code value that mixes a usable\n' +
      '"safe" branch with an unsupported one is its own bucket (a rule may still be built from\n' +
      "the safe branch). ruleBuiltCount is reported independently, never as nonBlank - ruleBuilt.\n"
  );

  for (const apiField of CODEBOOK_FIELDS) {
    printFieldCoverage(computeFieldCoverage(raw, apiField));
  }
  printFieldCoverage(computeZipCdCoverage(raw));

  console.log(`\n=== Policy-level cross-cuts (${raw.length} frozen 온통청년 records) ===\n`);
  const stats = computePolicyLevelStats(raw);
  console.log(`policies with >=1 newly built marital/job/school rule: ${stats.withNewMaritalJobSchoolRule}`);
  console.log(`policies with hasUnresolvedEligibility = true: ${stats.withHasUnresolvedEligibility}`);
  console.log(
    `policies with zero structured rules but hasUnresolvedEligibility = true: ${stats.withZeroStructuredRulesButUnresolved}`
  );
  console.log(
    `policies with BOTH >=1 structured rule AND hasUnresolvedEligibility = true: ${stats.withPositiveStructuredEvidenceAndUnresolvedBranch}`
  );
}

function main() {
  printCodebookBreakdown();
  printRealCatalogCoverage();
}

main();
