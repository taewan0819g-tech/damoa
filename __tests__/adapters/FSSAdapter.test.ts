import { describe, expect, it } from "vitest";
import { normalizeFSSProduct, type FSSRawFinancialProduct } from "@/adapters/fss/FSSAdapter";
import { matchesBenefitFacet } from "@/domain/benefit/topics";

function raw(overrides: Partial<FSSRawFinancialProduct>): FSSRawFinancialProduct {
  return { finPrdtCd: "P1", finPrdtNm: "Test Product", korCoNm: "Test Bank", productType: "deposit", ...overrides };
}

describe("normalizeFSSProduct — topics/financialFacets", () => {
  it("tags deposit/savings products with the asset_building topic and matching facet", () => {
    const deposit = normalizeFSSProduct(raw({ productType: "deposit" }));
    expect(deposit.topics).toEqual(["asset_building"]);
    expect(deposit.financialFacets).toEqual(["deposit"]);

    const savings = normalizeFSSProduct(raw({ productType: "savings" }));
    expect(savings.topics).toEqual(["asset_building"]);
    expect(savings.financialFacets).toEqual(["savings"]);
  });

  it("tags mortgage/jeonse loans with the housing topic (purpose), separate from the loan facet (instrument)", () => {
    const jeonse = normalizeFSSProduct(raw({ productType: "jeonseLoan" }));
    expect(jeonse.topics).toEqual(["housing"]);
    expect(jeonse.financialFacets).toEqual(["loan"]);

    const mortgage = normalizeFSSProduct(raw({ productType: "mortgageLoan" }));
    expect(mortgage.topics).toEqual(["housing"]);
    expect(mortgage.financialFacets).toEqual(["loan"]);
  });

  it("falls back to welfare topic for a generic credit loan with no genuine purpose signal", () => {
    const credit = normalizeFSSProduct(raw({ productType: "creditLoan" }));
    expect(credit.topics).toEqual(["welfare"]);
    expect(credit.financialFacets).toEqual(["loan"]);
  });

  it("stays matchable by direct category equality (legacy behavior) AND by the new facet/topic arrays", () => {
    const jeonse = normalizeFSSProduct(raw({ productType: "jeonseLoan" }));
    expect(matchesBenefitFacet(jeonse, "loan")).toBe(true);
    expect(matchesBenefitFacet(jeonse, "housing")).toBe(true);
    expect(matchesBenefitFacet(jeonse, "deposit")).toBe(false);
  });
});
