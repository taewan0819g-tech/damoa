/**
 * READ-ONLY precision audit for the "Category / Topic / Interest Semantics"
 * checkpoint (beta-personalization-pass, docs/beta-personalization-audit.md
 * §4 + §6).
 *
 * §4 bug: the OLD `mapCategory` in both adapters tagged `asset_building`
 * whenever `has("금융", "자산형성", "저축")` matched ANY of the fields it
 * scanned — including, for Youth Center, `lclsfNm`, which is the literal
 * combined umbrella string "금융·복지·문화" shared by its entire
 * welfare/health/culture supercategory. Measured baseline (§4 of the audit
 * doc, 2026-09-02 frozen snapshot): 422 benefits tagged `asset_building`
 * (26 MOIS + 396 Youth), of which 372/422 (88.2%) matched ONLY the bare
 * "금융" keyword with no deposit/savings/loan/자산형성-specific signal
 * anywhere in the text — mental-health counseling, music/culture programs,
 * civic events, none of them a financial product.
 *
 * §6 bug: `deposit`/`savings`/`loan` are user-selectable `BenefitCategory`
 * interests (`INTEREST_CATEGORIES`) that neither real adapter has ever
 * produced (0/0/0 across the whole 13,712-item catalog) — a user selecting
 * them got zero personalization benefit all session.
 *
 * This script re-implements the OLD single-value `has("금융", "자산형성",
 * "저축")` logic LOCALLY (comparison-only — never imported by production
 * code) and diffs it against the real, current adapter output
 * (`normalizeMOISServiceListItem`/`normalizeYouthPolicy`, which now derive
 * `topics`/`financialFacets` via the centralized `domain/benefit/topics.ts`
 * module) over the same frozen catalog used by every other audit in this
 * repo. It reports:
 *
 *   (a) OLD vs NEW asset_building tag counts (MOIS / Youth / total)
 *   (b) how many of the OLD tags were false positives now correctly removed
 *       (sample titles, capped)
 *   (c) how many genuine asset_building records are still correctly tagged
 *       (sample titles, capped)
 *   (d) NEW financialFacets coverage (deposit/savings/loan) — was
 *       structurally 0/0/0 for both real adapters before this checkpoint
 *   (e) multi-topic coverage — how many benefits now carry 2+ topics
 *       (previously impossible: `category` was always exactly one value)
 *
 * Run with:
 *   npx tsx scripts/auditCategoryTopicPrecision.ts
 *
 * Writes the full (scratch, uncommitted) report to
 * /tmp/category-topic-precision-audit.json, a compact deterministic
 * COMMITTED artifact to docs/audits/category-topic-precision-audit.json
 * (hashes/counts/samples only — never the raw government snapshot rows),
 * and prints a compact summary to stdout.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { normalizeMOISServiceListItem, type MOISRawServiceListItem } from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import type { Benefit } from "../types/benefit";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const REPORT_PATH = "/tmp/category-topic-precision-audit.json";
const ARTIFACT_PATH = path.join(__dirname, "../docs/audits/category-topic-precision-audit.json");

const REQUIRED_INPUTS = [
  { path: MOIS_LIST_PATH, label: "MOIS service list" },
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
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));
  const inputHashes = REQUIRED_INPUTS.map((f) => ({ path: f.path, label: f.label, sha256: sha256File(f.path) }));
  return { moisRawList, youthRaw, inputHashes };
}

/**
 * Bit-for-bit reimplementation of the OLD (pre-checkpoint) `mapCategory`
 * functions, for comparison only — verified against the actual pre-checkpoint
 * source at commit 3669592 (`git show 3669592:adapters/mois/MOISAdapter.ts` /
 * `...YouthAdapter.ts`). CRITICAL: both were FIRST-MATCH-WINS single-value
 * classifiers — a record that matched an earlier bucket (주거/보육/교육/취업/
 * 창업/가족/교통) NEVER reached the `asset_building` check at all, even if it
 * also happened to contain "금융". Reimplementing only the bare keyword
 * check in isolation (without the priority short-circuit) would overcount
 * OLD asset_building matches, so the full priority chain is reproduced here.
 */
function oldMoisCategory(raw: MOISRawServiceListItem): string {
  const text = `${raw.서비스분야 ?? ""} ${raw.서비스명 ?? ""}`;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  if (has("보육", "육아", "아동", "출산")) return "childcare";
  if (has("주거", "주택", "전세", "임대")) return "housing";
  if (has("교육", "학비", "장학")) return "education";
  if (has("고용", "취업", "일자리", "직업훈련")) return "employment";
  if (has("창업")) return "startup";
  if (has("가족", "한부모", "다문화")) return "family";
  if (has("교통")) return "transport";
  if (has("금융", "저축", "자산형성")) return "asset_building";
  return "welfare";
}

function oldYouthCategory(raw: YouthRawPolicy): string {
  const text = `${raw.lclsfNm ?? ""} ${raw.mclsfNm ?? ""} ${raw.plcyNm}`;
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  if (has("주거")) return "housing";
  if (has("보육", "육아", "출산")) return "childcare";
  if (has("교육", "직업훈련", "학비", "장학")) return "education";
  if (has("일자리", "고용", "취업", "인턴")) return "employment";
  if (has("창업")) return "startup";
  if (has("가족", "한부모")) return "family";
  if (has("교통")) return "transport";
  if (has("금융", "자산형성", "저축")) return "asset_building";
  return "welfare";
}

function oldMoisIsAssetBuilding(raw: MOISRawServiceListItem): boolean {
  return oldMoisCategory(raw) === "asset_building";
}

function oldYouthIsAssetBuilding(raw: YouthRawPolicy): boolean {
  return oldYouthCategory(raw) === "asset_building";
}

/** Whether OLD would have tagged this a bare-"금융"-only false positive: matched OLD, but no genuine deposit/savings/loan/자산형성 word appears anywhere in the same text. */
function isBareGeumyungOnly(text: string): boolean {
  return text.includes("금융") && !["예금", "적금", "저축", "자산형성", "대출", "융자"].some((w) => text.includes(w));
}

async function main() {
  const { moisRawList, youthRaw, inputHashes } = loadFrozenCatalog();

  const moisBenefits: Benefit[] = moisRawList.map((raw) => normalizeMOISServiceListItem(raw));
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);

  // ---- (a)/(b)/(c): asset_building OLD vs NEW -----------------------------
  const moisOldTagged = moisRawList.filter(oldMoisIsAssetBuilding);
  const youthOldTagged = youthRaw.filter(oldYouthIsAssetBuilding);

  const moisNewTagged = moisBenefits.filter((b) => b.topics?.includes("asset_building"));
  const youthNewTagged = youthBenefits.filter((b) => b.topics?.includes("asset_building"));

  const moisById = new Map(moisRawList.map((r, i) => [r.서비스ID, { raw: r, benefit: moisBenefits[i] }]));
  const youthById = new Map(youthRaw.map((r, i) => [r.plcyNo, { raw: r, benefit: youthBenefits[i] }]));

  const moisFalsePositivesRemoved = moisOldTagged.filter((raw) => !moisById.get(raw.서비스ID)!.benefit.topics?.includes("asset_building"));
  const youthFalsePositivesRemoved = youthOldTagged.filter((raw) => !youthById.get(raw.plcyNo)!.benefit.topics?.includes("asset_building"));

  const moisBareGeumyungOnlyOld = moisOldTagged.filter((raw) => isBareGeumyungOnly(`${raw.서비스분야 ?? ""} ${raw.서비스명 ?? ""}`));
  const youthBareGeumyungOnlyOld = youthOldTagged.filter((raw) =>
    isBareGeumyungOnly(`${raw.lclsfNm ?? ""} ${raw.mclsfNm ?? ""} ${raw.plcyNm}`)
  );

  // Records still (correctly) tagged NEW that were also tagged OLD — true positives retained.
  const moisTruePositivesRetained = moisNewTagged.filter((b) => oldMoisIsAssetBuilding(moisById.get(b.id.replace(/^mois-/, ""))!.raw));
  const youthTruePositivesRetained = youthNewTagged.filter((b) => oldYouthIsAssetBuilding(youthById.get(b.id.replace(/^youth-/, ""))!.raw));

  // Records tagged NEW that were NOT tagged OLD — newly discovered via mclsfNm/plcyKywdNm signal that lclsfNm alone wouldn't have surfaced, or MOIS records where 지원유형 wasn't scanned before.
  const moisNewlyDiscovered = moisNewTagged.filter((b) => !oldMoisIsAssetBuilding(moisById.get(b.id.replace(/^mois-/, ""))!.raw));
  const youthNewlyDiscovered = youthNewTagged.filter((b) => !oldYouthIsAssetBuilding(youthById.get(b.id.replace(/^youth-/, ""))!.raw));

  // ---- (d): financialFacets coverage (§6) ----------------------------------
  const allBenefits = [...moisBenefits, ...youthBenefits];
  const facetCounts = {
    deposit: allBenefits.filter((b) => b.financialFacets?.includes("deposit")).length,
    savings: allBenefits.filter((b) => b.financialFacets?.includes("savings")).length,
    loan: allBenefits.filter((b) => b.financialFacets?.includes("loan")).length,
  };
  const anyFacetCount = allBenefits.filter((b) => (b.financialFacets ?? []).length > 0).length;

  // ---- (e): multi-topic coverage -------------------------------------------
  const multiTopicBenefits = allBenefits.filter((b) => (b.topics ?? []).length >= 2);

  const report = {
    catalogTotals: { mois: moisBenefits.length, youth: youthBenefits.length, total: allBenefits.length },
    a_assetBuildingOldVsNew: {
      old: { mois: moisOldTagged.length, youth: youthOldTagged.length, total: moisOldTagged.length + youthOldTagged.length },
      new: { mois: moisNewTagged.length, youth: youthNewTagged.length, total: moisNewTagged.length + youthNewTagged.length },
    },
    b_falsePositivesRemoved: {
      mois: moisFalsePositivesRemoved.length,
      youth: youthFalsePositivesRemoved.length,
      total: moisFalsePositivesRemoved.length + youthFalsePositivesRemoved.length,
      bareGeumyungOnlyOld_mois: moisBareGeumyungOnlyOld.length,
      bareGeumyungOnlyOld_youth: youthBareGeumyungOnlyOld.length,
      sampleTitlesRemoved: [...moisFalsePositivesRemoved.slice(0, 10).map((r) => r.서비스명), ...youthFalsePositivesRemoved.slice(0, 15).map((r) => r.plcyNm)],
    },
    c_truePositivesRetained: {
      mois: moisTruePositivesRetained.length,
      youth: youthTruePositivesRetained.length,
      sampleTitles: [...moisTruePositivesRetained.slice(0, 10).map((b) => b.title), ...youthTruePositivesRetained.slice(0, 15).map((b) => b.title)],
    },
    c2_newlyDiscovered: {
      mois: moisNewlyDiscovered.length,
      youth: youthNewlyDiscovered.length,
      sampleTitles: [...moisNewlyDiscovered.slice(0, 10).map((b) => b.title), ...youthNewlyDiscovered.slice(0, 15).map((b) => b.title)],
    },
    d_financialFacetCoverage: { ...facetCounts, anyFacet: anyFacetCount },
    e_multiTopicCoverage: {
      count: multiTopicBenefits.length,
      sample: multiTopicBenefits.slice(0, 15).map((b) => ({ id: b.id, title: b.title, topics: b.topics })),
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const artifact = {
    generatedAt: new Date().toISOString(),
    frozenInputs: inputHashes,
    catalogTotals: report.catalogTotals,
    assetBuildingOldVsNew: report.a_assetBuildingOldVsNew,
    falsePositivesRemoved: {
      mois: report.b_falsePositivesRemoved.mois,
      youth: report.b_falsePositivesRemoved.youth,
      total: report.b_falsePositivesRemoved.total,
      bareGeumyungOnlyOld_mois: report.b_falsePositivesRemoved.bareGeumyungOnlyOld_mois,
      bareGeumyungOnlyOld_youth: report.b_falsePositivesRemoved.bareGeumyungOnlyOld_youth,
    },
    truePositivesRetained: { mois: report.c_truePositivesRetained.mois, youth: report.c_truePositivesRetained.youth },
    newlyDiscovered: { mois: report.c2_newlyDiscovered.mois, youth: report.c2_newlyDiscovered.youth },
    financialFacetCoverage: report.d_financialFacetCoverage,
    multiTopicCoverage: { count: report.e_multiTopicCoverage.count },
    sampleTitlesRemoved: report.b_falsePositivesRemoved.sampleTitlesRemoved,
    sampleTitlesRetained: report.c_truePositivesRetained.sampleTitles,
    conclusion: `OLD bare-keyword rule tagged ${report.a_assetBuildingOldVsNew.old.total} benefits (${report.a_assetBuildingOldVsNew.old.mois} MOIS + ${report.a_assetBuildingOldVsNew.old.youth} Youth) as asset_building; the NEW centralized domain/benefit/topics.ts rule (deposit/savings/loan/자산형성-specific words only, never scanning Youth Center's combined lclsfNm umbrella field) tags ${report.a_assetBuildingOldVsNew.new.total} (${report.a_assetBuildingOldVsNew.new.mois} MOIS + ${report.a_assetBuildingOldVsNew.new.youth} Youth), removing ${report.b_falsePositivesRemoved.total} false positives while retaining ${report.c_truePositivesRetained.mois + report.c_truePositivesRetained.youth} genuine matches. financialFacets (deposit/savings/loan) now cover ${report.d_financialFacetCoverage.anyFacet} benefits catalog-wide (0 before this checkpoint on real adapter data, per audit §6) — deposit/savings/loan interests are no longer structurally dead. ${report.e_multiTopicCoverage.count} benefits now carry 2+ topics, a shape the old single-value category could never represent.`,
  };
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));

  console.log("=== Category / Topic precision audit (checkpoint 3) ===");
  console.log(`Catalog: ${allBenefits.length} benefits (MOIS ${moisBenefits.length}, Youth ${youthBenefits.length})`);
  console.log(`(a) asset_building OLD: ${report.a_assetBuildingOldVsNew.old.total} (${report.a_assetBuildingOldVsNew.old.mois} MOIS + ${report.a_assetBuildingOldVsNew.old.youth} Youth)`);
  console.log(`(a) asset_building NEW: ${report.a_assetBuildingOldVsNew.new.total} (${report.a_assetBuildingOldVsNew.new.mois} MOIS + ${report.a_assetBuildingOldVsNew.new.youth} Youth)`);
  console.log(`(b) False positives removed: ${report.b_falsePositivesRemoved.total}`);
  console.log(`(c) True positives retained: ${report.c_truePositivesRetained.mois + report.c_truePositivesRetained.youth}`);
  console.log(`(c2) Newly discovered (mclsfNm/plcyKywdNm/지원유형 signal not scanned before): ${report.c2_newlyDiscovered.mois + report.c2_newlyDiscovered.youth}`);
  console.log(`(d) financialFacets coverage: deposit=${facetCounts.deposit} savings=${facetCounts.savings} loan=${facetCounts.loan} (any=${anyFacetCount})`);
  console.log(`(e) Multi-topic (2+) benefits: ${multiTopicBenefits.length}`);
  console.log(`Full (scratch) report: ${REPORT_PATH}`);
  console.log(`Committed artifact: ${ARTIFACT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
