import { describe, expect, it } from "vitest";
import { buildCandidateIndex, getCandidateBenefits, getCandidateBenefitsFullScan } from "@/lib/eligibility/candidateIndex";
import { extractEligibilityFromText } from "@/lib/eligibility/extraction/koreanEligibilityParser";
import type { Benefit } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Wires the real checkpoint-5 median-income text parser directly into a
 * synthetic catalog and sweeps the optimized candidate-index retrieval path
 * against the full-scan reference implementation.
 *
 * This is the pruning-safety regression this task explicitly asked for: now
 * that `parseMedianIncomeClause` requires POSITIVE evidence of household
 * income (checkpoint-5) and treats 임금/근로소득 (wage income) and
 * 부부합산소득 (couple-combined income) as disqualifiers, several real MOIS
 * clauses that used to wrongly resolve into a `median_income_threshold` rule
 * now correctly resolve into NO rule at all (unresolved). A benefit with no
 * income rule must never be wrongly excluded by the candidate-retrieval
 * index for ANY income profile — including a profile whose income would
 * have failed the OLD, wrongly-emitted rule. This file proves exactly that,
 * end-to-end from real clause text through extraction through indexing,
 * rather than only at the unit level (see the synthetic
 * `median_income_threshold candidate index` describe block in
 * candidateIndex.test.ts, which never emits a rule that isn't already
 * correct-by-construction and so can't exercise this specific regression).
 */
function benefitFromText(id: string, field: "지원대상" | "선정기준", text: string): Benefit {
  const { rules } = extractEligibilityFromText(field, text);
  return {
    id,
    title: id,
    shortDescription: "desc",
    category: "welfare",
    source: { type: "government", organization: "org" },
    benefitType: "other",
    eligibility: rules.length > 0 ? { type: "all", rules } : undefined,
  };
}

function catalog(): Benefit[] {
  return [
    benefitFromText("unconstrained", "지원대상", "누구나 신청 가능"),
    // Ordinary, correctly-resolved household-income rule (positive
    // "가구소득" signal) — 50% lte. Real excerpt: 135200005013 (자산형성지원사업).
    benefitFromText(
      "household-income-50-lte",
      "선정기준",
      "(가구소득) 기준 중위소득 50% 이하"
    ),
    // WAGE-income disqualifier — real excerpt: 515000000168 (청년근로자 사랑채움
    // 사업). The exact bug the external review flagged: "임금이 ... 중위소득
    // 150% 이하" is the APPLICANT'S OWN wage, not household income, so this
    // must resolve to NO median_income_threshold rule at all.
    benefitFromText(
      "wage-income-unresolved",
      "지원대상",
      "임금이 2026년 기준 중위소득 150% 이하인 자"
    ),
    // COUPLE-combined-income disqualifier — real excerpt: 402000000115 (군포시
    // 신혼부부 전월세 보증금 대출이자 지원). 부부합산 소득 is not necessarily
    // equal to full household income, so this must also stay unresolved.
    benefitFromText(
      "couple-income-unresolved",
      "지원대상",
      "부부합산 소득 기준 중위소득 180% 이하 무주택 신혼부부"
    ),
    // Compound: wage-income clause bundled with an unrelated, independently
    // necessary age rule via "지원대상" free text — proves the household
    // pruning-safety property holds even inside a mixed "all" group where
    // OTHER rules in the same group are real and enforceable.
    benefitFromText(
      "wage-income-unresolved-plus-age",
      "지원대상",
      "만 19세 이상 39세 이하이며 임금이 기준 중위소득 150% 이하인 자"
    ),
  ];
}

// 2026 4-person monthly = 6,494,738 KRW (see domain/medianIncome/table.ts)
// -> 50% annual threshold = 38,968,428.
const THRESHOLD_50PCT_4PERSON_2026 = 38968428;

const INCOME_PROFILES: UserProfile[] = [
  {},
  { householdSize: 4, annualHouseholdIncome: 0 },
  { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 },
  // Comfortably FAILS the 50% household-income rule — the exact income band
  // that would ALSO have wrongly failed "wage-income-unresolved" and
  // "couple-income-unresolved" under the pre-checkpoint-5 blacklist-only
  // classifier (which would have misread their wage/couple clauses as a
  // household-income rule and pruned high earners even though the person's
  // OWN wage or couple income, not household income, was what the text
  // actually described).
  { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 * 10 },
  { householdSize: 1, annualHouseholdIncome: 1 },
  { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 * 10, birthDate: "2000-01-01" },
];

describe("checkpoint-5 median-income parser output vs candidate index — no false-negative regression", () => {
  it("indexed retrieval matches the full-scan reference for every real parser-produced shape and profile (mismatch count === 0)", () => {
    const index = buildCandidateIndex(catalog());
    const mismatches: unknown[] = [];
    for (const profile of INCOME_PROFILES) {
      const indexed = getCandidateBenefits(index, profile).map((b) => b.id).sort();
      const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id).sort();
      if (JSON.stringify(indexed) !== JSON.stringify(fullScan)) {
        mismatches.push({ profile, indexed, fullScan });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("a high-income profile that FAILS the real household-income rule is correctly excluded by both paths", () => {
    const index = buildCandidateIndex(catalog());
    const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 * 10 };
    const indexed = getCandidateBenefits(index, profile).map((b) => b.id);
    const fullScan = getCandidateBenefitsFullScan(index, profile).map((b) => b.id);
    expect(indexed).toEqual(fullScan);
    expect(indexed).not.toContain("household-income-50-lte");
  });

  it("PRUNING-SAFETY: the same high-income profile still keeps the wage-income and couple-income benefits, because their clauses correctly emitted NO median-income rule (checkpoint-5)", () => {
    const index = buildCandidateIndex(catalog());
    const profile: UserProfile = { householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 * 10 };
    const indexedIds = new Set(getCandidateBenefits(index, profile).map((b) => b.id));
    expect(indexedIds.has("wage-income-unresolved")).toBe(true);
    expect(indexedIds.has("couple-income-unresolved")).toBe(true);
    expect(indexedIds.has("wage-income-unresolved-plus-age")).toBe(true);
  });

  it("PRUNING-SAFETY: an unknown-income profile also keeps every unresolved-clause benefit (no rule to evaluate against)", () => {
    const index = buildCandidateIndex(catalog());
    const indexedIds = new Set(getCandidateBenefits(index, {}).map((b) => b.id));
    expect(indexedIds.has("wage-income-unresolved")).toBe(true);
    expect(indexedIds.has("couple-income-unresolved")).toBe(true);
  });

  it("a young adult with a low income is excluded from wage-income-unresolved-plus-age only if the enforceable age rule fails, never by the unresolved wage clause", () => {
    const index = buildCandidateIndex(catalog());
    // Age 26 in 2026 (birthDate 2000) satisfies 19<=age<=39 (parsed range on
    // the same clause via 지원대상 free text) — kept regardless of income,
    // since the wage sub-clause never became an enforceable rule.
    const profile: UserProfile = { birthDate: "2000-01-01", householdSize: 4, annualHouseholdIncome: THRESHOLD_50PCT_4PERSON_2026 * 10 };
    const indexedIds = new Set(getCandidateBenefits(index, profile).map((b) => b.id));
    expect(indexedIds.has("wage-income-unresolved-plus-age")).toBe(true);
  });

  it("every benefit is a candidate for a fully-unknown profile (conservative default)", () => {
    const index = buildCandidateIndex(catalog());
    const indexedIds = getCandidateBenefits(index, {}).map((b) => b.id);
    expect(new Set(indexedIds)).toEqual(
      new Set([
        "unconstrained",
        "household-income-50-lte",
        "wage-income-unresolved",
        "couple-income-unresolved",
        "wage-income-unresolved-plus-age",
      ])
    );
  });
});
