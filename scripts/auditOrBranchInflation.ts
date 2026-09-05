/**
 * READ-ONLY audit for the "OR-branch personalization inflation" risk
 * (beta-personalization-pass ranker-hardening checkpoint, issue #2).
 *
 * Question: because `passedLeaves` used to be flattened across the ENTIRE
 * eligibility tree, could PASS leaves from DIFFERENT mutually-alternative
 * branches of an `any` group be unioned into the personalization evidence,
 * artificially inflating strength (e.g. (age PASS + income UNKNOWN) OR
 * (region PASS + employment UNKNOWN) wrongly becoming STRONG by unioning
 * age+region)?
 *
 * This script measures the REAL, committed frozen catalog — zero network
 * calls, same three frozen snapshots used by every other audit in this repo
 * (/tmp/mois_serviceList_full.json, /tmp/mois_supportConditions_full.json,
 * /tmp/youth_policy_full.json). It answers, with real counts:
 *
 *   (a) how many benefits' eligibility trees contain an `any` group at all
 *   (b) of those, how many representative-profile evaluations would have
 *       received PASS evidence from 2+ MUTUALLY ALTERNATIVE branches of the
 *       SAME `any` group under the OLD flat-union strategy (i.e. cases where
 *       the fix in lib/eligibility/ruleEngine.ts actually changes output)
 *   (c) how many of the current Top-20 recommended results per profile were
 *       affected
 *   (d) exact sample IDs/titles, if any
 *
 * It does this by re-implementing the OLD flat-union leaf-collection
 * strategy locally (for comparison purposes ONLY — this file is never
 * imported by production code) and diffing it against the real, currently
 * fixed `evaluateEligibilityDetailed().passedLeaves` (branch-aware) output.
 *
 * Run with:
 *   npx tsx scripts/auditOrBranchInflation.ts
 *
 * Writes the full (scratch, uncommitted) report to
 * /tmp/or-branch-inflation-audit.json (large output goes to a file, not
 * stdout, per context budget), a compact deterministic COMMITTED artifact to
 * docs/audits/or-branch-personalization-audit.json (hashes/counts/samples
 * only — never the raw government snapshot rows), and prints only a compact
 * summary to stdout.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { evaluateEligibilityDetailed, evaluateRule, isGroup, type NodeResult } from "../lib/eligibility/ruleEngine";
import { getRecommendedBenefits } from "../domain/benefit/recommend";
import { isRelevantForFeed } from "../domain/eligibility/matchBenefits";
import { derivePersonalizationEvidence } from "../domain/benefit/personalization";
import type { Benefit, EligibilityRule, EligibilityRuleGroup, EligibilityStatus } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MOIS_CONDITIONS_PATH = "/tmp/mois_supportConditions_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const REPORT_PATH = "/tmp/or-branch-inflation-audit.json";
const BASELINE_ARTIFACT_PATH = path.join(__dirname, "../docs/audits/or-branch-personalization-audit.json");

const REQUIRED_INPUTS = [
  { path: MOIS_LIST_PATH, label: "MOIS service list" },
  { path: MOIS_CONDITIONS_PATH, label: "MOIS support conditions" },
  { path: YOUTH_PATH, label: "Youth Center policy list" },
];

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function loadFrozenCatalog() {
  const missing = REQUIRED_INPUTS.filter((f) => !fs.existsSync(f.path));
  if (missing.length > 0) {
    console.error("Frozen input file(s) missing — this audit never fetches live data. Missing:");
    for (const m of missing) console.error(`  - ${m.label}: ${m.path}`);
    process.exit(1);
  }
  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
  const moisRawConditions: MOISRawSupportCondition[] = JSON.parse(fs.readFileSync(MOIS_CONDITIONS_PATH, "utf8"));
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));
  const inputHashes = REQUIRED_INPUTS.map((f) => ({ path: f.path, label: f.label, sha256: sha256File(f.path) }));
  return { moisRawList, moisRawConditions, youthRaw, inputHashes };
}

// Same 6 representative profiles used by auditPersonalizationBaseline.ts.
const PROFILES: { key: string; profile: UserProfile }[] = [
  {
    key: "A_icheon_unemployed_youth",
    profile: {
      birthDate: "2000-03-15",
      residence: { province: "경기도", city: "이천시" },
      maritalStatus: "single",
      employmentStatus: "unemployed",
      individualIncomeBand: "under_1000",
      homeowner: false,
      interests: ["employment", "housing", "asset_building"],
    },
  },
  {
    key: "B_seoul_university_student",
    profile: {
      birthDate: "2004-05-01",
      residence: { province: "서울특별시", city: "관악구" },
      maritalStatus: "single",
      employmentStatus: "student",
      educationStatus: "university",
      individualIncomeBand: "none",
      interests: ["education", "deposit", "savings"],
    },
  },
  {
    key: "C_suwon_high_income_employed",
    profile: {
      birthDate: "1992-01-01",
      residence: { province: "경기도", city: "수원시" },
      maritalStatus: "single",
      employmentStatus: "employed",
      individualIncomeBand: "over_7000",
      homeowner: true,
      housingType: "own",
      interests: ["asset_building", "loan"],
    },
  },
  {
    key: "D_icheon_newlywed",
    profile: {
      birthDate: "1996-06-01",
      residence: { province: "경기도", city: "이천시" },
      maritalStatus: "married",
      marriageDate: "2025-03-01",
      householdIncomeBand: "3000_4000",
      householdSize: 2,
      interests: ["housing", "childcare"],
    },
  },
  {
    key: "E_jeonnam_single_parent",
    profile: {
      birthDate: "1988-01-01",
      residence: { province: "전라남도" },
      maritalStatus: "divorced",
      singleParentFamily: true,
      employmentStatus: "freelancer",
      householdIncomeBand: "2000_3000",
      childrenCount: 1,
      interests: ["welfare", "childcare"],
    },
  },
  {
    key: "F_minimal_just_onboarded",
    profile: { birthDate: "1998-01-01" },
  },
];

// ---------------------------------------------------------------------------
// (a) Structural scan: does this benefit's eligibility tree contain ANY
// `any`-type group anywhere (at the top level or nested)?
// ---------------------------------------------------------------------------
function containsAnyGroup(node: EligibilityRule | EligibilityRuleGroup): boolean {
  if (!isGroup(node)) return false;
  if (node.type === "any") return true;
  return node.rules.some(containsAnyGroup);
}

// ---------------------------------------------------------------------------
// OLD strategy re-implementation (comparison-only, mirrors the pre-fix
// flat-union evaluateNode/evaluateGroup exactly as it existed before this
// session's ruleEngine.ts change) — collects every PASS leaf across the
// WHOLE tree regardless of which alternative `any`-branch it came from.
// ---------------------------------------------------------------------------
function oldFlatPassedLeaves(node: EligibilityRule | EligibilityRuleGroup, profile: UserProfile, out: EligibilityRule[]): NodeResult {
  if (isGroup(node)) {
    const results = node.rules.map((c) => oldFlatPassedLeaves(c, profile, out)).filter((r) => r !== "skip");
    if (node.type === "all") {
      if (results.includes("fail")) return "fail";
      if (results.includes("unknown")) return "unknown";
      return "pass";
    }
    if (results.includes("pass")) return "pass";
    if (results.includes("unknown")) return "unknown";
    if (results.length === 0) return "unknown";
    return "fail";
  }
  const result = evaluateRule(node, profile);
  if (result === "pass") out.push(node);
  return result;
}

function dimensionKey(rule: EligibilityRule): string {
  return rule.operator === "target_scope_in" || rule.operator === "median_income_threshold" ? rule.operator : rule.field;
}

async function main() {
  const { moisRawList, moisRawConditions, youthRaw, inputHashes } = loadFrozenCatalog();
  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);

  const moisBenefits: Benefit[] = moisRawList.map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeMOISSupportConditions(condRow) : undefined;
    return normalizeMOISServiceListItem(raw, ageGroup);
  });
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);
  const allBenefits: Benefit[] = [...moisBenefits, ...youthBenefits];

  // (a) Structural: benefits whose eligibility tree contains an `any` group.
  const benefitsWithAnyGroup = allBenefits.filter((b) => b.eligibility && containsAnyGroup(b.eligibility));

  // (b) + (d): per-profile, per-benefit — does old-flat-union differ from
  // the real (branch-aware) passedLeaves for THIS benefit+profile pair? Only
  // possible at all if the benefit has an `any` group per (a).
  interface Divergence {
    benefitId: string;
    title: string;
    profileKey: string;
    oldDimensions: string[];
    newDimensions: string[];
    oldStrength: string;
    newStrength: string;
  }
  const divergences: Divergence[] = [];
  let profileBenefitPairsChecked = 0;

  const perProfileTop20: { profileKey: string; top20AffectedIds: string[]; top20AffectedTitles: string[] }[] = [];

  for (const { key: profileKey, profile } of PROFILES) {
    const statusById = new Map<string, EligibilityStatus>();
    const hasPositiveEvidenceById = new Map<string, boolean>();

    for (const b of allBenefits) {
      const diag = evaluateEligibilityDetailed(b, profile);
      statusById.set(b.id, diag.status);
      hasPositiveEvidenceById.set(b.id, diag.hasPositiveEvidence);

      if (!b.eligibility || !containsAnyGroup(b.eligibility)) continue;
      profileBenefitPairsChecked++;

      const oldLeaves: EligibilityRule[] = [];
      oldFlatPassedLeaves(b.eligibility, profile, oldLeaves);
      const newLeaves = diag.passedLeaves; // real, current (branch-aware) output

      const oldDims = [...new Set(oldLeaves.map(dimensionKey))].sort();
      const newDims = [...new Set(newLeaves.map((l) => (l.operator === "target_scope_in" || l.operator === "median_income_threshold" ? l.operator : l.field)))].sort();

      if (oldDims.join(",") !== newDims.join(",")) {
        const oldEv = derivePersonalizationEvidence(
          oldLeaves.map((l) => ({ field: l.field, operator: l.operator, value: l.value })),
          profile
        );
        const newEv = derivePersonalizationEvidence(newLeaves, profile);
        divergences.push({
          benefitId: b.id,
          title: b.title,
          profileKey,
          oldDimensions: oldDims,
          newDimensions: newDims,
          oldStrength: oldEv.strength,
          newStrength: newEv.strength,
        });
      }
    }

    const relevantFeed = allBenefits.filter((b) => isRelevantForFeed(statusById.get(b.id)!, hasPositiveEvidenceById.get(b.id)!));
    const top20 = getRecommendedBenefits(relevantFeed, statusById, profile, 20);
    const top20Ids = new Set(top20.map((b) => b.id));
    const affected = divergences.filter((d) => d.profileKey === profileKey && top20Ids.has(d.benefitId));
    perProfileTop20.push({
      profileKey,
      top20AffectedIds: affected.map((d) => d.benefitId),
      top20AffectedTitles: affected.map((d) => d.title),
    });
  }

  const report = {
    catalogTotals: { mois: moisBenefits.length, youth: youthBenefits.length, total: allBenefits.length },
    a_benefitsWithAnyGroup: {
      count: benefitsWithAnyGroup.length,
      sampleIds: benefitsWithAnyGroup.slice(0, 20).map((b) => ({ id: b.id, title: b.title })),
    },
    b_profileBenefitPairsWithAnyGroupChecked: profileBenefitPairsChecked,
    b_divergentPairs: {
      count: divergences.length,
      samples: divergences.slice(0, 50),
    },
    c_top20AffectedByProfile: perProfileTop20,
    c_totalTop20Affected: perProfileTop20.reduce((sum, p) => sum + p.top20AffectedIds.length, 0),
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Compact deterministic COMMITTED artifact (baseline of record) — hashes
  // and derived counts/samples only, never the raw government snapshot rows.
  const baselineArtifact = {
    generatedAt: new Date().toISOString(),
    frozenInputs: inputHashes.map((h) => ({ label: h.label, path: h.path, sha256: h.sha256 })),
    catalogTotals: report.catalogTotals,
    benefitsContainingAnyGroups: report.a_benefitsWithAnyGroup.count,
    crossAlternativePassEvidenceCases: report.b_divergentPairs.count,
    top20StrengthInflationCases: report.c_totalTop20Affected,
    sampleIds: report.a_benefitsWithAnyGroup.sampleIds,
    conclusion:
      report.a_benefitsWithAnyGroup.count === 0
        ? "The real, committed frozen MOIS + Youth Center catalog currently contains ZERO benefits with an `any` eligibility group anywhere in their tree — every adapter only ever constructs `type: \"all\"` groups, and the Korean free-text parser's OR-detection safety net (koreanEligibilityParser.ts's hasLocalCrossDimensionOr) bails out to unresolvedClauses instead of building a nested `any` group. Cross-branch/cross-alternative personalization evidence inflation is therefore not reachable in production today. lib/eligibility/ruleEngine.ts's branch-aware evidenceLeaves collection (single-passing-branch selection for `any` groups) is kept as defense-in-depth for if/when an `any` group is ever introduced."
        : "Non-zero — see crossAlternativePassEvidenceCases/top20StrengthInflationCases and sampleIds above; the branch-aware fix in lib/eligibility/ruleEngine.ts addresses these cases.",
  };
  fs.mkdirSync(path.dirname(BASELINE_ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_ARTIFACT_PATH, JSON.stringify(baselineArtifact, null, 2));

  console.log("=== OR-branch personalization inflation audit ===");
  console.log(`Catalog: ${allBenefits.length} benefits (MOIS ${moisBenefits.length}, Youth ${youthBenefits.length})`);
  console.log(`(a) Benefits with an 'any' group anywhere in their eligibility tree: ${benefitsWithAnyGroup.length}`);
  console.log(`(b) Profile x benefit pairs checked (benefit has 'any' group): ${profileBenefitPairsChecked}`);
  console.log(`(b) Divergent pairs (old flat-union != real branch-aware evidence): ${divergences.length}`);
  console.log(`(c) Top-20 results across all profiles affected by the divergence: ${report.c_totalTop20Affected}`);
  console.log(`Full (scratch) report: ${REPORT_PATH}`);
  console.log(`Committed baseline artifact: ${BASELINE_ARTIFACT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
