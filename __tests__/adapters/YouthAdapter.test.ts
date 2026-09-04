import { describe, expect, it } from "vitest";
import { normalizeYouthPolicy, type YouthRawPolicy } from "@/adapters/youthCenter/YouthAdapter";

function rawPolicy(overrides: Partial<YouthRawPolicy>): YouthRawPolicy {
  return {
    plcyNo: "1",
    plcyNm: "Test Policy",
    ...overrides,
  };
}

describe("normalizeYouthPolicy eligibility", () => {
  it("builds no eligibility group when there is no age limit and no structured income condition", () => {
    const benefit = normalizeYouthPolicy(rawPolicy({ sprtTrgtAgeLmtYn: "N", earnCndSeCd: "0043001" }));
    expect(benefit.eligibility).toBeUndefined();
  });

  it("builds an age rule when sprtTrgtAgeLmtYn is Y with numeric bounds", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({ sprtTrgtAgeLmtYn: "Y", sprtTrgtMinAge: "19", sprtTrgtMaxAge: "34" })
    );
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [{ id: "youth-age", field: "age", operator: "between", value: [19, 34], required: true }],
    });
  });

  it("builds a max-only range_within income rule against individualIncomeRange when earnCndSeCd is 0043002, converting 만원 to raw KRW", () => {
    // Real live record: getPlcy?plcyNo=20260724005400113307 ("햇살론유스")
    // returns earnMaxAmt: "3500" with no earnMinAmt, i.e. 3500만원 = 35,000,000 KRW cap.
    const benefit = normalizeYouthPolicy(
      rawPolicy({ earnCndSeCd: "0043002", earnMinAmt: "0", earnMaxAmt: "3500" })
    );
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [
        {
          id: "youth-income-max",
          field: "individualIncomeRange",
          operator: "range_within",
          value: [0, 35000000],
          required: true,
        },
      ],
    });
  });

  it("builds a min+max range_within income rule when both earnMinAmt and earnMaxAmt are positive", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({ earnCndSeCd: "0043002", earnMinAmt: "1000", earnMaxAmt: "5000" })
    );
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [
        {
          id: "youth-income",
          field: "individualIncomeRange",
          operator: "range_within",
          value: [10000000, 50000000],
          required: true,
        },
      ],
    });
  });

  it("builds a min-only (unbounded max) range_within income rule when only earnMinAmt is positive", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({ earnCndSeCd: "0043002", earnMinAmt: "2000", earnMaxAmt: "0" })
    );
    expect(benefit.eligibility).toEqual({
      type: "all",
      rules: [
        {
          id: "youth-income-min",
          field: "individualIncomeRange",
          operator: "range_within",
          value: [20000000, Number.POSITIVE_INFINITY],
          required: true,
        },
      ],
    });
  });

  it("does NOT build an income rule for free-text-only income conditions (0043003)", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({ earnCndSeCd: "0043003", earnEtcCn: "소득 조건은 별도 공고 참조" })
    );
    expect(benefit.eligibility).toBeUndefined();
  });

  it("combines age and income rules into a single 'all' group when both apply", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({
        sprtTrgtAgeLmtYn: "Y",
        sprtTrgtMinAge: "19",
        sprtTrgtMaxAge: "34",
        earnCndSeCd: "0043002",
        earnMinAmt: "0",
        earnMaxAmt: "5000",
      })
    );
    expect(benefit.eligibility?.type).toBe("all");
    expect(benefit.eligibility?.rules).toHaveLength(2);
  });
});

// Checkpoint 4 cross-topic precision audit regression — see
// domain/benefit/topics.ts's hasChildcareSignal doc comment for the full
// live-catalog evidence.
describe("YouthAdapter — 보육 childcare/business-incubator homonym fix", () => {
  it("does NOT tag childcare for a business-incubation-center program", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({ plcyNm: "완주군 창업보육센터 운영", lclsfNm: "일자리", mclsfNm: "창업" })
    );
    expect(benefit.topics).not.toContain("childcare");
    expect(benefit.topics).toContain("startup");
  });

  it("DOES still tag childcare for a genuine childcare-facility program using the bare 보육 word", () => {
    const benefit = normalizeYouthPolicy(
      rawPolicy({
        plcyNm: "(광양시)아이양육하기좋은도시 광양만의 맞춤형 보육서비스제공",
        lclsfNm: "금융·복지·문화",
        mclsfNm: "문화활동 및 생활지원",
      })
    );
    expect(benefit.topics).toContain("childcare");
  });
});
