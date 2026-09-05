/**
 * READ-ONLY closeout audit for "Damoa MOIS Region Parser — Final Closeout Fix".
 *
 * Compares the OLD (git blob at ba3dd7390147c502ca414e108f58a7817c724cfb —
 * the commit this checkpoint started from, right after the manual review
 * artifact docs/audits/mois-region-binding-manual-review.json was produced)
 * against the NEW (current working tree) `extractEligibilityFromText` region
 * output over the full frozen 10,967-row MOIS catalog, then cross-references
 * every one of the manual review's 28 records + 16 newly-empty fields against
 * their manually-assigned classification to produce a PASS/NEEDS_REVIEW
 * verdict for each.
 *
 * ZERO network calls. Prerequisite (temporary, uncommitted, deleted after use):
 *   git show ba3dd7390147c502ca414e108f58a7817c724cfb:lib/eligibility/extraction/koreanEligibilityParser.ts \
 *     > lib/eligibility/extraction/koreanEligibilityParserOld.ts
 *
 * Writes docs/audits/mois-region-parser-closeout.json (committed).
 */
import fs from "fs";
import path from "path";
import { extractEligibilityFromText as extractNew } from "../lib/eligibility/extraction/koreanEligibilityParser";
import type { EligibilityRule } from "../types/benefit";

const OLD_PARSER_PATH = path.join(__dirname, "../lib/eligibility/extraction/koreanEligibilityParserOld");
if (!fs.existsSync(OLD_PARSER_PATH + ".ts")) {
  console.error("Missing prerequisite: " + OLD_PARSER_PATH + ".ts");
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractEligibilityFromText: extractOld } = require(OLD_PARSER_PATH) as {
  extractEligibilityFromText: typeof extractNew;
};

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MANUAL_REVIEW_PATH = path.join(__dirname, "../docs/audits/mois-region-binding-manual-review.json");
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/mois-region-parser-closeout.json");

interface MOISRawRow {
  서비스ID: string;
  서비스명: string;
  지원대상?: string | null;
  선정기준?: string | null;
}
interface RegionSpec {
  province: string;
  city?: string;
}
interface ManualRecord {
  serviceId: string;
  serviceName: string;
  field: "지원대상" | "선정기준";
  sourceText: string;
  before: RegionSpec[];
  after: RegionSpec[];
  removed: RegionSpec[];
  added: RegionSpec[];
  newlyEmpty: boolean;
  classification: "A_confirmed_precision_fix" | "B_confirmed_valid_region_lost" | "C_mixed" | "D_ambiguous";
  validSpecs?: RegionSpec[];
  reasoning: string;
  anaphoricPattern?: string;
  newlyEmptyClassification?: "should_still_have_region_rule" | "correct_to_be_unrestricted" | "ambiguous";
}

function regionRule(rules: EligibilityRule[]): EligibilityRule | undefined {
  return rules.find((r) => r.field === "residence" && r.operator === "region_in");
}
function specsOf(rule: EligibilityRule | undefined): RegionSpec[] {
  return (rule?.value as RegionSpec[] | undefined) ?? [];
}
function specKey(s: RegionSpec): string {
  return s.city ? `${s.province}|${s.city}` : s.province;
}
function sameSpecSet(a: RegionSpec[], b: RegionSpec[]): boolean {
  const ak = new Set(a.map(specKey));
  const bk = new Set(b.map(specKey));
  if (ak.size !== bk.size) return false;
  for (const k of ak) if (!bk.has(k)) return false;
  return true;
}
/** Mirrors koreanEligibilityParser.ts's internal `normalizeText` so raw frozen-catalog
 * text (with \r\n) can be compared against `unresolvedClauses` entries, which are
 * pushed post-normalization. */
function normalizeText(input: string): string {
  return input
    .replace(/[\r\t]/g, " ")
    .replace(/[∼～]/g, "~")
    .replace(/[ㅡ―—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function outcomeOf(rule: EligibilityRule | undefined, unresolvedClauses: string[], text: string): "rule" | "unresolved" | "none" {
  if (rule) return "rule";
  const normalized = normalizeText(text);
  if (unresolvedClauses.some((u) => u === text || u === normalized)) return "unresolved";
  return "none";
}

function loadFrozenCatalog(): MOISRawRow[] {
  if (!fs.existsSync(MOIS_LIST_PATH)) {
    console.error(`Frozen MOIS snapshot missing at ${MOIS_LIST_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
}

function main() {
  const rows = loadFrozenCatalog();
  const manual = JSON.parse(fs.readFileSync(MANUAL_REVIEW_PATH, "utf8")) as {
    records: ManualRecord[];
    section3_newlyEmptyFields: { serviceIds: Record<string, string[]> };
  };
  const rowById = new Map(rows.map((r) => [r.서비스ID, r]));

  // --- Section 9: recheck all 28 manually-reviewed records ---
  const section9 = manual.records.map((rec) => {
    const row = rowById.get(rec.serviceId);
    const text = rec.field === "지원대상" ? row?.지원대상 : row?.선정기준;
    if (!text) {
      return {
        serviceId: rec.serviceId,
        serviceName: rec.serviceName,
        classification: rec.classification,
        verdict: "NEEDS_REVIEW" as const,
        explanation: "source field text no longer present in frozen catalog snapshot",
      };
    }
    const oldResult = extractOld(rec.field, text);
    const newResult = extractNew(rec.field, text);
    const preCloseoutSpecs = specsOf(regionRule(oldResult.rules));
    const postCloseoutSpecs = specsOf(regionRule(newResult.rules));
    const postUnresolved = outcomeOf(regionRule(newResult.rules), newResult.unresolvedClauses, text) === "unresolved";

    let verdict: "PASS" | "NEEDS_REVIEW" = "PASS";
    let explanation = "";
    if (rec.classification === "A_confirmed_precision_fix") {
      // Must NOT reintroduce the confirmed-false spec(s) that were removed.
      const reintroducedFalseSpec = rec.removed.some((s) => postCloseoutSpecs.some((p) => specKey(p) === specKey(s)));
      if (reintroducedFalseSpec) {
        verdict = "NEEDS_REVIEW";
        explanation = "a confirmed false residence spec from the manual review's `removed` list reappeared after closeout";
      } else {
        explanation = "confirmed false spec stays removed after closeout";
      }
    } else if (rec.classification === "B_confirmed_valid_region_lost") {
      const wanted = rec.validSpecs && rec.validSpecs.length > 0 ? rec.validSpecs : rec.removed;
      const restored = sameSpecSet(postCloseoutSpecs, wanted);
      if (restored) {
        explanation = "valid residence restriction fully restored, matching manual review's validSpecs";
      } else if (rec.serviceId === "148000000035" && sameSpecSet(postCloseoutSpecs, [{ province: "서울특별시" }, { province: "경기도" }, { province: "강원특별자치도" }, { province: "충청북도" }])) {
        // Deliberate, documented deviation from the artifact's literal validSpecs list:
        // the manual review's validSpecs included "광주광역시", but direct inspection of
        // the source text ("경기도(남양주, 용인, 이천, 하남, 여주, 광주, 가평, 양평)") shows
        // that "광주" here is 경기도 광주시 (a real Han-river-basin city grouped with 남양주/
        // 용인/이천/하남/여주/가평/양평, all 경기도), not the unrelated metro city 광주광역시 —
        // restoring a bare "광주광역시" province spec would be a NEW confirmed false
        // residence spec, which this checkpoint's own Section 1 principle prohibits.
        // The parser now correctly treats "광주" as part of 경기도's own trailing detail
        // group (see skipTrailingParenGroup) instead of an independent province mention,
        // which correctly excludes it while still restoring 경기도/강원/충북.
        explanation =
          "restored {서울,경기,강원,충북} — deliberately excludes 광주광역시 from the artifact's validSpecs: source text's '광주' is 경기도 광주시 (grouped with 남양주/용인/이천/하남/여주/가평/양평), not 광주광역시; including it would reintroduce a confirmed false residence spec";
      } else if (postCloseoutSpecs.length === 0 && postUnresolved) {
        explanation =
          "not restored as a resolved rule, but correctly marked UNRESOLVED (not silently unrestricted) — acceptable per Section 4 when no structurally-safe anchor exists";
      } else {
        verdict = "NEEDS_REVIEW";
        explanation = `expected valid spec set ${JSON.stringify(wanted)} not restored and not left unresolved (got specs=${JSON.stringify(postCloseoutSpecs)}, unresolved=${postUnresolved})`;
      }
    } else if (rec.classification === "D_ambiguous") {
      // Must not guess: no confident rule should appear for an ambiguous case.
      if (postCloseoutSpecs.length === 0) {
        explanation = postUnresolved
          ? "correctly left UNRESOLVED, no guessed rule for an ambiguous case"
          : "correctly left with no region rule (no guess) for an ambiguous case";
      } else {
        verdict = "NEEDS_REVIEW";
        explanation = `ambiguous case unexpectedly resolved to a guessed rule: ${JSON.stringify(postCloseoutSpecs)}`;
      }
    } else {
      explanation = "C_mixed: none in this dataset (classificationCounts.C_mixed = 0)";
    }

    return {
      serviceId: rec.serviceId,
      serviceName: rec.serviceName,
      field: rec.field,
      classification: rec.classification,
      preCloseoutSpecs,
      postCloseoutSpecs,
      postCloseoutUnresolved: postUnresolved,
      verdict,
      explanation,
    };
  });

  // --- Section 10: recheck all 16 newly-empty fields ---
  const newlyEmptyByClass = manual.section3_newlyEmptyFields.serviceIds;
  const section10Groups: Record<string, unknown[]> = {};
  for (const [cls, ids] of Object.entries(newlyEmptyByClass)) {
    section10Groups[cls] = ids.map((id) => {
      const rec = manual.records.find((r) => r.serviceId === id && r.newlyEmpty);
      const row = rowById.get(id);
      const text = rec ? (rec.field === "지원대상" ? row?.지원대상 : row?.선정기준) : undefined;
      if (!rec || !text) {
        return { serviceId: id, verdict: "NEEDS_REVIEW", explanation: "manual record or source text not found" };
      }
      const newResult = extractNew(rec.field, text);
      const postSpecs = specsOf(regionRule(newResult.rules));
      const postUnresolved = outcomeOf(regionRule(newResult.rules), newResult.unresolvedClauses, text) === "unresolved";
      let verdict: "PASS" | "NEEDS_REVIEW" = "PASS";
      let explanation = "";
      if (cls === "correct_to_be_unrestricted") {
        if (postSpecs.length === 0) explanation = "stays without a false region rule";
        else {
          verdict = "NEEDS_REVIEW";
          explanation = `unexpectedly gained a region rule: ${JSON.stringify(postSpecs)}`;
        }
      } else if (cls === "should_still_have_region_rule") {
        if (postSpecs.length > 0) explanation = `restored: ${JSON.stringify(postSpecs)}`;
        else if (postUnresolved) explanation = "not restored as a rule, but safely marked UNRESOLVED rather than empty";
        else {
          verdict = "NEEDS_REVIEW";
          explanation = "neither restored nor marked unresolved — silently unrestricted";
        }
      } else {
        // ambiguous: must not guess
        if (postSpecs.length === 0) explanation = postUnresolved ? "left UNRESOLVED, no guess" : "left with no rule, no guess";
        else {
          verdict = "NEEDS_REVIEW";
          explanation = `ambiguous field unexpectedly guessed a rule: ${JSON.stringify(postSpecs)}`;
        }
      }
      return { serviceId: id, serviceName: rec.serviceName, postSpecs, postUnresolved, verdict, explanation };
    });
  }

  // --- Full catalog aggregate (Section 12) ---
  let fieldsProcessed = 0;
  let unexpectedNonRegionMismatchCount = 0;
  const unexpectedNonRegionMismatchSamples: unknown[] = [];
  let recordsWithRuleBefore = 0;
  let recordsWithRuleAfter = 0;
  let specsBefore = 0;
  let specsAfter = 0;
  let rulesRestoredByAnaphora = 0;
  let specsRemovedByGuard = 0;
  let newlyUnresolvedCount = 0;

  for (const row of rows) {
    const fields: ["지원대상" | "선정기준", string | null | undefined][] = [
      ["지원대상", row.지원대상],
      ["선정기준", row.선정기준],
    ];
    let recordHadRuleBefore = false;
    let recordHadRuleAfter = false;
    let recordSpecsBefore = 0;
    let recordSpecsAfter = 0;
    for (const [fieldName, text] of fields) {
      if (!text || !text.trim()) continue;
      fieldsProcessed++;
      const oldResult = extractOld(fieldName, text);
      const newResult = extractNew(fieldName, text);

      const oldOther = oldResult.rules.filter((r) => r.field !== "residence").map((r) => ({ field: r.field, operator: r.operator, value: r.value }));
      const newOther = newResult.rules.filter((r) => r.field !== "residence").map((r) => ({ field: r.field, operator: r.operator, value: r.value }));
      if (JSON.stringify(oldOther) !== JSON.stringify(newOther)) {
        unexpectedNonRegionMismatchCount++;
        if (unexpectedNonRegionMismatchSamples.length < 20) {
          unexpectedNonRegionMismatchSamples.push({ serviceId: row.서비스ID, field: fieldName, oldOther, newOther });
        }
      }

      const oldSpecs = specsOf(regionRule(oldResult.rules));
      const newSpecs = specsOf(regionRule(newResult.rules));
      if (oldSpecs.length > 0) {
        recordHadRuleBefore = true;
        recordSpecsBefore += oldSpecs.length;
      }
      if (newSpecs.length > 0) {
        recordHadRuleAfter = true;
        recordSpecsAfter += newSpecs.length;
      }
      const oldOutcome = outcomeOf(regionRule(oldResult.rules), oldResult.unresolvedClauses, text);
      const newOutcome = outcomeOf(regionRule(newResult.rules), newResult.unresolvedClauses, text);

      if (oldOutcome !== "rule" && newOutcome === "rule") rulesRestoredByAnaphora++;
      if (oldSpecs.length > newSpecs.length) specsRemovedByGuard += oldSpecs.length - newSpecs.length;
      if (oldOutcome === "rule" && newOutcome === "unresolved") newlyUnresolvedCount++;
    }
    if (recordHadRuleBefore) recordsWithRuleBefore++;
    if (recordHadRuleAfter) recordsWithRuleAfter++;
    specsBefore += recordSpecsBefore;
    specsAfter += recordSpecsAfter;
  }

  const section9Counts = {
    total: section9.length,
    pass: section9.filter((r) => r.verdict === "PASS").length,
    needsReview: section9.filter((r) => r.verdict === "NEEDS_REVIEW").length,
  };
  const section10Counts = Object.fromEntries(
    Object.entries(section10Groups).map(([cls, items]) => [
      cls,
      {
        total: items.length,
        pass: (items as { verdict: string }[]).filter((i) => i.verdict === "PASS").length,
        needsReview: (items as { verdict: string }[]).filter((i) => i.verdict === "NEEDS_REVIEW").length,
      },
    ])
  );

  const artifact = {
    generatedAt: new Date().toISOString(),
    checkpoint: "Damoa MOIS Region Parser — Final Closeout Fix",
    auditedBeforeSha: "ba3dd7390147c502ca414e108f58a7817c724cfb",
    frozenInput: { path: MOIS_LIST_PATH, rowCount: rows.length },
    section9_manualReview28: { counts: section9Counts, records: section9 },
    section10_newlyEmpty16: { counts: section10Counts, groups: section10Groups },
    section12_fullCatalogSafety: {
      totalMOISRecords: rows.length,
      totalFieldsProcessed: fieldsProcessed,
      recordsWithRegionRuleBefore: recordsWithRuleBefore,
      recordsWithRegionRuleAfter: recordsWithRuleAfter,
      regionSpecCountBefore: specsBefore,
      regionSpecCountAfter: specsAfter,
      fieldRulesRestoredByAnaphoraOrDisambiguation: rulesRestoredByAnaphora,
      specsRemovedByExampleInstitutionBrandGuards: specsRemovedByGuard,
      newlyUnresolvedFieldCount: newlyUnresolvedCount,
      unexpectedNonRegionMismatchCount,
      unexpectedNonRegionMismatchSamples,
    },
  };

  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`Written to ${ARTIFACT_PATH}`);
  console.log("section9Counts", section9Counts);
  console.log("section10Counts", section10Counts);
  console.log("section12", artifact.section12_fullCatalogSafety);
  for (const r of section9.filter((x) => x.verdict === "NEEDS_REVIEW")) {
    console.log("NEEDS_REVIEW(9):", r.serviceId, r.explanation);
  }
  for (const [cls, items] of Object.entries(section10Groups)) {
    for (const i of items as { verdict: string; serviceId: string; explanation: string }[]) {
      if (i.verdict === "NEEDS_REVIEW") console.log(`NEEDS_REVIEW(10:${cls}):`, i.serviceId, i.explanation);
    }
  }
}

main();
