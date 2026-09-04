// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { BenefitMiniRow } from "@/components/benefit/BenefitMiniRow";
import type { Benefit } from "@/types/benefit";

afterEach(cleanup);

const benefit: Benefit = {
  id: "b1",
  title: "청년 월세 지원",
  shortDescription: "desc",
  category: "housing",
  source: { type: "government", organization: "org" },
  benefitType: "other",
};

/**
 * Regression for "UNKNOWN status must remain visible on home" — the home
 * `recommended` bucket can legitimately contain STRONG/MODERATE-evidence
 * UNKNOWN benefits (see domain/benefit/recommend.ts's excludeWeakUnknown,
 * which only drops WEAK unknowns). Those must never render identically to a
 * likely_eligible row, but also must never claim a Match Score, "eligible",
 * or a rule checklist — just a small, non-alarming "확인이 필요해요" label.
 */
describe("BenefitMiniRow — unknown-status label", () => {
  it("shows the '확인이 필요해요' label when status is unknown", () => {
    render(createElement(BenefitMiniRow, { benefit, status: "unknown" }));
    expect(screen.getByText("확인이 필요해요")).toBeTruthy();
  });

  it("shows no status label for likely_eligible", () => {
    render(createElement(BenefitMiniRow, { benefit, status: "likely_eligible" }));
    expect(screen.queryByText("확인이 필요해요")).toBeNull();
  });

  it("shows no status label when status is omitted (backward-compatible default)", () => {
    render(createElement(BenefitMiniRow, { benefit }));
    expect(screen.queryByText("확인이 필요해요")).toBeNull();
  });

  it("never renders a match score, 'eligible' text, or a rule checklist", () => {
    render(createElement(BenefitMiniRow, { benefit, status: "unknown" }));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/match score|점수|eligible|자격 조건 체크/i);
  });
});
