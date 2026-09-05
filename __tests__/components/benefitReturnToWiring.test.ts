// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { BenefitCard } from "@/components/benefit/BenefitCard";
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
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * A benefit detail page must know exactly where it was opened from, so
 * BenefitCard/BenefitMiniRow carry an explicit `returnTo` destination into
 * the detail link as `?returnTo=...` (see lib/benefits/returnTo.ts) instead
 * of always hardcoding `/benefits/<id>`.
 */
describe("BenefitCard / BenefitMiniRow — returnTo threading", () => {
  it("BenefitCard link carries the exact current benefits-list return URL", () => {
    render(createElement(BenefitCard, { benefit, status: "unknown", returnTo: "/benefits?category=housing&page=3" }));
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      `/benefits/b1?returnTo=${encodeURIComponent("/benefits?category=housing&page=3")}`
    );
  });

  it("BenefitCard link plain (no returnTo) stays a bare detail link, backward-compatible", () => {
    render(createElement(BenefitCard, { benefit, status: "unknown" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/benefits/b1");
  });

  it("BenefitCard used from Saved returns to /saved", () => {
    render(createElement(BenefitCard, { benefit, status: "unknown", returnTo: "/saved" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/benefits/b1?returnTo=${encodeURIComponent("/saved")}`);
  });

  it("BenefitMiniRow used from Home returns to /home", () => {
    render(createElement(BenefitMiniRow, { benefit, returnTo: "/home" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/benefits/b1?returnTo=${encodeURIComponent("/home")}`);
  });

  it("BenefitMiniRow plain (no returnTo) stays a bare detail link, backward-compatible", () => {
    render(createElement(BenefitMiniRow, { benefit }));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/benefits/b1");
  });
});
