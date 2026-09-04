/**
 * READ-ONLY beta-personalization baseline audit.
 *
 * Measures how the CURRENT (unmodified) matching/ranking pipeline behaves
 * against representative user profiles, using a FROZEN snapshot of the real
 * MOIS + Youth Center catalogs (same three files auditEligibilityCoverage.ts
 * and the Phase 2/4 audits already used: /tmp/mois_serviceList_full.json,
 * /tmp/mois_supportConditions_full.json, /tmp/youth_policy_full.json —
 * fetched live on 2026-09-02, 10,967 MOIS rows / 2,745 Youth rows). If any
 * of those files are missing, this script fetches them fresh (same
 * pagination logic as auditEligibilityCoverage.ts) and writes them back to
 * those exact paths so subsequent runs stay reproducible from the same
 * snapshot.
 *
 * Never modifies production matching/ranking code — only imports and calls
 * the real, unmodified functions (evaluateEligibilityDetailed,
 * getRecommendedBenefits, isRelevantForFeed, the adapter normalizers).
 *
 * Run with:
 *   node --env-file=.env.local -r tsx/cjs scripts/auditPersonalizationBaseline.ts
 *
 * Writes a full JSON report to /tmp/personalization-audit.json and prints a
 * condensed summary to stdout.
 */
import fs from "fs";
import {
  normalizeMOISServiceListItem,
  normalizeMOISSupportConditions,
  type MOISRawServiceListItem,
  type MOISRawSupportCondition,
} from "../adapters/mois/MOISAdapter";
import { normalizeYouthPolicy, type YouthRawPolicy } from "../adapters/youthCenter/YouthAdapter";
import { evaluateEligibilityDetailed, evaluateRule, isGroup } from "../lib/eligibility/ruleEngine";
import { getRecommendedBenefits } from "../domain/benefit/recommend";
import { isRelevantForFeed } from "../domain/eligibility/matchBenefits";
import type { Benefit, BenefitCategory, EligibilityRule, EligibilityRuleGroup, EligibilityStatus } from "../types/benefit";
import type { UserProfile } from "../types/profile";

const MOIS_LIST_PATH = "/tmp/mois_serviceList_full.json";
const MOIS_CONDITIONS_PATH = "/tmp/mois_supportConditions_full.json";
const YOUTH_PATH = "/tmp/youth_policy_full.json";
const REPORT_PATH = "/tmp/personalization-audit.json";

const MOIS_BASE = "https://api.odcloud.kr/api/gov24/v3";
const YOUTH_BASE = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

async function fetchMoisAll<T>(path: string, key: string): Promise<T[]> {
  const PER_PAGE = 1000;
  const MAX_PAGES = 30;
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${MOIS_BASE}${path}?page=${page}&perPage=${PER_PAGE}`, {
      headers: { Authorization: `Infuser ${key}` },
    });
    if (!res.ok) break;
    const json = (await res.json()) as { data: T[]; totalCount: number };
    results.push(...json.data);
    if (json.data.length < PER_PAGE || page * PER_PAGE >= json.totalCount) break;
  }
  return results;
}

async function fetchYouthAll(key: string): Promise<YouthRawPolicy[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20;
  const results: YouthRawPolicy[] = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = `${YOUTH_BASE}?apiKeyNm=${key}&pageType=1&rtnType=json&pageNum=${pageNum}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json = (await res.json()) as {
      resultCode: number;
      result?: { pagging?: { totCount: number }; youthPolicyList?: YouthRawPolicy[] };
    };
    if (json.resultCode !== 200) break;
    const list = json.result?.youthPolicyList ?? [];
    const totCount = json.result?.pagging?.totCount ?? 0;
    results.push(...list);
    if (list.length < PAGE_SIZE || pageNum * PAGE_SIZE >= totCount) break;
  }
  return results;
}

async function loadFrozenCatalog(): Promise<{
  moisRawList: MOISRawServiceListItem[];
  moisRawConditions: MOISRawSupportCondition[];
  youthRaw: YouthRawPolicy[];
  snapshotAge: { moisListMtime: string; youthMtime: string };
}> {
  const haveAll =
    fs.existsSync(MOIS_LIST_PATH) && fs.existsSync(MOIS_CONDITIONS_PATH) && fs.existsSync(YOUTH_PATH);

  if (!haveAll) {
    const moisKey = process.env.MOIS_API_KEY;
    const youthKey = process.env.YOUTH_POLICY_API_KEY;
    if (!moisKey || !youthKey) throw new Error("Frozen snapshot missing and MOIS_API_KEY/YOUTH_POLICY_API_KEY not set");
    console.log("Frozen snapshot not found on disk — fetching fresh and caching to /tmp for reproducibility...");
    const [moisRawList, moisRawConditions, youthRaw] = await Promise.all([
      fetchMoisAll<MOISRawServiceListItem>("/serviceList", moisKey),
      fetchMoisAll<MOISRawSupportCondition>("/supportConditions", moisKey),
      fetchYouthAll(youthKey),
    ]);
    fs.writeFileSync(MOIS_LIST_PATH, JSON.stringify(moisRawList));
    fs.writeFileSync(MOIS_CONDITIONS_PATH, JSON.stringify(moisRawConditions));
    fs.writeFileSync(YOUTH_PATH, JSON.stringify(youthRaw));
  }

  const moisRawList: MOISRawServiceListItem[] = JSON.parse(fs.readFileSync(MOIS_LIST_PATH, "utf8"));
  const moisRawConditions: MOISRawSupportCondition[] = JSON.parse(fs.readFileSync(MOIS_CONDITIONS_PATH, "utf8"));
  const youthRaw: YouthRawPolicy[] = JSON.parse(fs.readFileSync(YOUTH_PATH, "utf8"));

  return {
    moisRawList,
    moisRawConditions,
    youthRaw,
    snapshotAge: {
      moisListMtime: fs.statSync(MOIS_LIST_PATH).mtime.toISOString(),
      youthMtime: fs.statSync(YOUTH_PATH).mtime.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Representative profiles (Item 3). Chosen to stress the region PASS/FAIL
// example from the product spec (경기도 이천시 vs 수원시), asset_building /
// deposit-savings-loan interest pollution, family/marital rules, and the
// degenerate "just finished onboarding, most fields unanswered" case.
// ---------------------------------------------------------------------------
const PROFILES: { key: string; label: string; profile: UserProfile }[] = [
  {
    key: "A_icheon_unemployed_youth",
    label: "이천시 청년 무직 (경기도 이천시, 26세, 무직, 저소득)",
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
    label: "서울 대학생 (서울특별시 관악구, 22세, 대학생, 무소득)",
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
    label: "수원시 직장인 고소득 (경기도 수원시, 34세, 재직, 고소득, 자가)",
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
    label: "이천시 신혼부부 (경기도 이천시, 30세, 기혼, 혼인 1.5년차, 가구소득 3~4천)",
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
    label: "전남 한부모가족 (전라남도, 38세, 프리랜서, 자녀 1명)",
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
    label: "온보딩 직후 최소 입력 (생년월일만 입력, 나머지 미입력)",
    profile: {
      birthDate: "1998-01-01",
    },
  },
];

// ---------------------------------------------------------------------------
// Leaf-level rule trace: walks an eligibility tree recording {field,
// operator, result} for every leaf — used only to classify WHICH rule(s)
// produced positive evidence (e.g. "only ever target_scope_in passed").
// Read-only audit mirror of the tree-walk evaluateGroup already does
// internally; does not change or duplicate any pass/fail semantics
// (evaluateRule itself, imported unmodified, is what actually decides each
// leaf's result).
// ---------------------------------------------------------------------------
interface LeafTrace {
  id: string;
  field: string;
  operator: string;
  result: "pass" | "fail" | "unknown" | "skip";
}

function traceLeaves(node: EligibilityRule | EligibilityRuleGroup, profile: UserProfile, out: LeafTrace[]): void {
  if (isGroup(node)) {
    for (const child of node.rules) traceLeaves(child, profile, out);
    return;
  }
  out.push({ id: node.id, field: node.field, operator: node.operator, result: evaluateRule(node, profile) });
}

function freq<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function sortedFreq<T>(m: Map<T, number>): [T, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const { moisRawList, moisRawConditions, youthRaw, snapshotAge } = await loadFrozenCatalog();
  console.log(`Frozen snapshot: MOIS ${moisRawList.length} rows (mtime ${snapshotAge.moisListMtime}), Youth ${youthRaw.length} rows (mtime ${snapshotAge.youthMtime})`);

  const conditionsById = new Map<string, MOISRawSupportCondition>();
  for (const row of moisRawConditions) conditionsById.set(row.서비스ID, row);

  const moisBenefits: Benefit[] = moisRawList.map((raw) => {
    const condRow = conditionsById.get(raw.서비스ID);
    const ageGroup = condRow ? normalizeMOISSupportConditions(condRow) : undefined;
    return normalizeMOISServiceListItem(raw, ageGroup);
  });
  const youthBenefits: Benefit[] = youthRaw.map(normalizeYouthPolicy);
  const allBenefits: Benefit[] = [...moisBenefits, ...youthBenefits];

  // =========================================================================
  // Section D: category / benefitType taxonomy frequency (Items 6, 7, 8)
  // =========================================================================
  const moisCategoryFreq = sortedFreq(freq(moisBenefits.map((b) => b.category)));
  const youthCategoryFreq = sortedFreq(freq(youthBenefits.map((b) => b.category)));
  const moisBenefitTypeFreq = sortedFreq(freq(moisBenefits.map((b) => b.benefitType)));
  const youthBenefitTypeFreq = sortedFreq(freq(youthBenefits.map((b) => b.benefitType)));

  // Item 7: asset_building precision. Split MOIS+Youth asset_building
  // benefits by which keyword(s) in the source text actually triggered the
  // mapping, to see how many are truly deposit/savings/loan-specific vs.
  // only matched on the broad "금융" token.
  function assetBuildingKeywordBreakdown() {
    const DEPOSIT_SAVINGS_RE = /(예금|적금|저축)/;
    const LOAN_RE = /(대출|융자)/;
    const ASSET_RE = /자산형성/;
    const BROAD_FINANCE_ONLY_RE = /금융/;

    let depositSavings = 0;
    let loan = 0;
    let assetFormation = 0;
    let broadFinanceOnlyNoOtherSignal = 0;
    const broadFinanceOnlySamples: { id: string; title: string; source: string; text: string }[] = [];

    for (const raw of moisRawList) {
      const cat = mapCategoryMirror(raw.서비스분야, raw.서비스명);
      if (cat !== "asset_building") continue;
      const text = `${raw.서비스분야 ?? ""} ${raw.서비스명 ?? ""}`;
      if (DEPOSIT_SAVINGS_RE.test(text)) depositSavings++;
      if (LOAN_RE.test(text)) loan++;
      if (ASSET_RE.test(text)) assetFormation++;
      if (BROAD_FINANCE_ONLY_RE.test(text) && !DEPOSIT_SAVINGS_RE.test(text) && !LOAN_RE.test(text) && !ASSET_RE.test(text)) {
        broadFinanceOnlyNoOtherSignal++;
        if (broadFinanceOnlySamples.length < 15) {
          broadFinanceOnlySamples.push({ id: raw.서비스ID, title: raw.서비스명, source: "MOIS", text: text.trim() });
        }
      }
    }
    for (const raw of youthRaw) {
      const cat = mapCategoryMirrorYouth(raw);
      if (cat !== "asset_building") continue;
      const text = `${raw.lclsfNm ?? ""} ${raw.mclsfNm ?? ""} ${raw.plcyNm}`;
      if (DEPOSIT_SAVINGS_RE.test(text)) depositSavings++;
      if (LOAN_RE.test(text)) loan++;
      if (ASSET_RE.test(text)) assetFormation++;
      if (BROAD_FINANCE_ONLY_RE.test(text) && !DEPOSIT_SAVINGS_RE.test(text) && !LOAN_RE.test(text) && !ASSET_RE.test(text)) {
        broadFinanceOnlyNoOtherSignal++;
        if (broadFinanceOnlySamples.length < 15) {
          broadFinanceOnlySamples.push({ id: raw.plcyNo, title: raw.plcyNm, source: "Youth", text: text.trim() });
        }
      }
    }

    const total = moisCategoryFreq.find(([c]) => c === "asset_building")?.[1] ?? 0;
    const totalYouth = youthCategoryFreq.find(([c]) => c === "asset_building")?.[1] ?? 0;
    return {
      totalAssetBuildingMois: total,
      totalAssetBuildingYouth: totalYouth,
      totalAssetBuildingCombined: total + totalYouth,
      matchedDepositSavingsKeyword: depositSavings,
      matchedLoanKeyword: loan,
      matchedAssetFormationKeyword: assetFormation,
      matchedOnlyBroadFinanceKeywordNoSpecificSignal: broadFinanceOnlyNoOtherSignal,
      broadFinanceOnlySamples,
    };
  }

  // Mirrors of the adapters' private mapCategory (read-only, for text-level
  // keyword attribution only — never used to alter production output).
  function mapCategoryMirror(field: string | undefined, name: string | undefined): BenefitCategory {
    const text = `${field ?? ""} ${name ?? ""}`;
    const has = (...n: string[]) => n.some((x) => text.includes(x));
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
  function mapCategoryMirrorYouth(raw: YouthRawPolicy): BenefitCategory {
    const text = `${raw.lclsfNm ?? ""} ${raw.mclsfNm ?? ""} ${raw.plcyNm}`;
    const has = (...n: string[]) => n.some((x) => text.includes(x));
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

  const assetBuildingAudit = assetBuildingKeywordBreakdown();

  // Item 8: interests/category/benefitType semantics mismatch.
  const categoryNeverProduced = (["deposit", "savings", "loan"] as BenefitCategory[]).map((c) => ({
    category: c,
    moisCount: moisCategoryFreq.find(([cat]) => cat === c)?.[1] ?? 0,
    youthCount: youthCategoryFreq.find(([cat]) => cat === c)?.[1] ?? 0,
  }));
  const benefitTypeCoverage = (["cash", "savings", "deposit", "loan", "housing", "discount", "service", "other"] as const).map(
    (t) => ({
      benefitType: t,
      moisCount: moisBenefitTypeFreq.find(([bt]) => bt === t)?.[1] ?? 0,
      youthCount: youthBenefitTypeFreq.find(([bt]) => bt === t)?.[1] ?? 0,
    })
  );

  // =========================================================================
  // Section G: UserProfile field/operator utilization across the whole
  // catalog's structured rules (Item 9)
  // =========================================================================
  function fieldUtilization(benefits: Benefit[]) {
    const counts = new Map<string, number>();
    const walk = (node: EligibilityRule | EligibilityRuleGroup) => {
      if (isGroup(node)) {
        for (const c of node.rules) walk(c);
        return;
      }
      const key = node.operator === "target_scope_in" || node.operator === "median_income_threshold" ? node.operator : node.field;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (const b of benefits) {
      if (b.eligibility) walk(b.eligibility);
    }
    return sortedFreq(counts);
  }
  const moisFieldUtilization = fieldUtilization(moisBenefits);
  const youthFieldUtilization = fieldUtilization(youthBenefits);

  // Item 10: employmentStatus vs educationStatus co-occurrence — do any
  // benefits actually gate on BOTH simultaneously (evidence for/against
  // keeping them as independent UI inputs vs. one merged "currentStatus")?
  function employmentEducationCooccurrence(benefits: Benefit[]) {
    let employmentOnly = 0;
    let educationOnly = 0;
    let both = 0;
    for (const b of benefits) {
      if (!b.eligibility) continue;
      const fields = new Set<string>();
      const walk = (node: EligibilityRule | EligibilityRuleGroup) => {
        if (isGroup(node)) {
          for (const c of node.rules) walk(c);
          return;
        }
        fields.add(node.field);
      };
      walk(b.eligibility);
      const hasEmployment = fields.has("employmentStatus");
      const hasEducation = fields.has("educationStatus");
      if (hasEmployment && hasEducation) both++;
      else if (hasEmployment) employmentOnly++;
      else if (hasEducation) educationOnly++;
    }
    return { employmentOnly, educationOnly, both };
  }
  const moisEmpEdu = employmentEducationCooccurrence(moisBenefits);
  const youthEmpEdu = employmentEducationCooccurrence(youthBenefits);

  // =========================================================================
  // Section A/B/C: per-profile status distribution, targetScope-only
  // pollution, and Top-20 ranked feed (Items 4, 5)
  // =========================================================================
  const perProfileReports = PROFILES.map(({ key, label, profile }) => {
    const statusById = new Map<string, EligibilityStatus>();
    const hasPositiveEvidenceById = new Map<string, boolean>();
    const targetScopeOnlyById = new Map<string, boolean>();

    let likelyEligible = 0;
    let unknownWithPositiveEvidence = 0;
    let unknownNoEvidence = 0;
    let notEligible = 0;
    let targetScopeOnlyPositiveCount = 0;

    for (const b of allBenefits) {
      const diag = evaluateEligibilityDetailed(b, profile);
      statusById.set(b.id, diag.status);
      hasPositiveEvidenceById.set(b.id, diag.hasPositiveEvidence);

      if (diag.status === "likely_eligible") likelyEligible++;
      else if (diag.status === "not_eligible") notEligible++;
      else if (diag.hasPositiveEvidence) unknownWithPositiveEvidence++;
      else unknownNoEvidence++;

      let targetScopeOnly = false;
      if (diag.hasPositiveEvidence && b.eligibility) {
        const leaves: LeafTrace[] = [];
        traceLeaves(b.eligibility, profile, leaves);
        const passed = leaves.filter((l) => l.result === "pass");
        targetScopeOnly = passed.length > 0 && passed.every((l) => l.operator === "target_scope_in");
      }
      targetScopeOnlyById.set(b.id, targetScopeOnly);
      if (targetScopeOnly) targetScopeOnlyPositiveCount++;
    }

    const relevantFeed = allBenefits.filter((b) => isRelevantForFeed(statusById.get(b.id)!, hasPositiveEvidenceById.get(b.id)!));
    const relevantFeedTargetScopeOnly = relevantFeed.filter((b) => targetScopeOnlyById.get(b.id));

    const top20 = getRecommendedBenefits(relevantFeed, statusById, profile, 20);
    const top20Detail = top20.map((b) => ({
      id: b.id,
      title: b.title,
      source: b.source.type,
      category: b.category,
      benefitType: b.benefitType,
      status: statusById.get(b.id),
      hasPositiveEvidence: hasPositiveEvidenceById.get(b.id),
      targetScopeOnlyEvidence: targetScopeOnlyById.get(b.id),
      matchesUserInterest: (profile.interests ?? []).includes(b.category),
    }));
    const top20TargetScopeOnlyCount = top20Detail.filter((b) => b.targetScopeOnlyEvidence).length;
    const top20InterestMatchCount = top20Detail.filter((b) => b.matchesUserInterest).length;
    const top20CategoryFreq = sortedFreq(freq(top20Detail.map((b) => b.category)));

    return {
      key,
      label,
      totals: { likelyEligible, unknownWithPositiveEvidence, unknownNoEvidence, notEligible, totalCatalog: allBenefits.length },
      personalizedFeedSize: relevantFeed.length,
      personalizedFeedTargetScopeOnlyCount: relevantFeedTargetScopeOnly.length,
      personalizedFeedTargetScopeOnlyPct: relevantFeed.length > 0 ? Number(((relevantFeedTargetScopeOnly.length / relevantFeed.length) * 100).toFixed(1)) : null,
      top20TargetScopeOnlyCount,
      top20InterestMatchCount,
      top20CategoryFreq,
      top20: top20Detail,
    };
  });

  // =========================================================================
  // Assemble + write report
  // =========================================================================
  const report = {
    snapshot: { moisCount: moisRawList.length, youthCount: youthRaw.length, ...snapshotAge },
    section_taxonomy: {
      moisCategoryFreq,
      youthCategoryFreq,
      moisBenefitTypeFreq,
      youthBenefitTypeFreq,
    },
    section_assetBuildingPrecision: assetBuildingAudit,
    section_interestCategoryBenefitTypeMismatch: {
      categoryNeverProduced,
      benefitTypeCoverage,
    },
    section_fieldUtilization: { mois: moisFieldUtilization, youth: youthFieldUtilization },
    section_employmentEducationCooccurrence: { mois: moisEmpEdu, youth: youthEmpEdu },
    section_perProfile: perProfileReports,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${REPORT_PATH}`);

  console.log("\n=== Category frequency (MOIS) ===");
  console.table(moisCategoryFreq.map(([c, n]) => ({ category: c, count: n, pct: Number(((n / moisBenefits.length) * 100).toFixed(1)) })));
  console.log("\n=== Category frequency (Youth) ===");
  console.table(youthCategoryFreq.map(([c, n]) => ({ category: c, count: n, pct: Number(((n / youthBenefits.length) * 100).toFixed(1)) })));

  console.log("\n=== asset_building precision ===");
  console.log(assetBuildingAudit);

  console.log("\n=== interests/category mismatch (deposit/savings/loan categories) ===");
  console.table(categoryNeverProduced);
  console.log("\n=== benefitType coverage ===");
  console.table(benefitTypeCoverage);

  console.log("\n=== Field utilization (MOIS) ===");
  console.table(moisFieldUtilization.map(([f, n]) => ({ field: f, count: n })));
  console.log("\n=== Field utilization (Youth) ===");
  console.table(youthFieldUtilization.map(([f, n]) => ({ field: f, count: n })));

  console.log("\n=== employmentStatus/educationStatus co-occurrence ===");
  console.log("MOIS:", moisEmpEdu);
  console.log("Youth:", youthEmpEdu);

  console.log("\n=== Per-profile summary ===");
  console.table(
    perProfileReports.map((r) => ({
      profile: r.key,
      likely_eligible: r.totals.likelyEligible,
      unknown_pos_evidence: r.totals.unknownWithPositiveEvidence,
      unknown_no_evidence: r.totals.unknownNoEvidence,
      not_eligible: r.totals.notEligible,
      feedSize: r.personalizedFeedSize,
      feedTargetScopeOnlyPct: r.personalizedFeedTargetScopeOnlyPct,
      top20TargetScopeOnly: r.top20TargetScopeOnlyCount,
      top20InterestMatch: r.top20InterestMatchCount,
    }))
  );

  for (const r of perProfileReports) {
    console.log(`\n--- Top 20 for ${r.key} (${r.label}) ---`);
    console.table(r.top20.map((b) => ({ title: b.title.slice(0, 40), source: b.source, category: b.category, status: b.status, targetScopeOnly: b.targetScopeOnlyEvidence, interestMatch: b.matchesUserInterest })));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
