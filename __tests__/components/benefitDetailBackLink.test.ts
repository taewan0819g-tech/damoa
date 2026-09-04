// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BenefitDetailClient } from "@/app/(app)/benefits/[id]/BenefitDetailClient";
import { useProfileStore } from "@/stores/profileStore";
import type { Benefit } from "@/types/benefit";

let currentSearch = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearch,
}));

const benefit: Benefit = {
  id: "b1",
  title: "청년 월세 지원",
  shortDescription: "desc",
  category: "housing",
  source: { type: "government", organization: "org" },
  benefitType: "other",
};

beforeEach(() => {
  currentSearch = new URLSearchParams("");
  useProfileStore.getState().resetProfile();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ benefit }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * The detail page's visible back button must restore the exact origin the
 * user came from (the parameterized benefits-list URL, /home, or /saved),
 * validated through the same `resolveReturnTo` allow-list used everywhere
 * else — never a raw pass-through of the query param.
 */
describe("BenefitDetailClient — BackLink restores the validated returnTo destination", () => {
  it("restores an exact parameterized benefits-list URL", async () => {
    currentSearch = new URLSearchParams({ returnTo: "/benefits?category=housing&page=3" });
    render(createElement(BenefitDetailClient, { id: "b1" }));
    await waitFor(() => screen.getByText(benefit.title));
    expect(screen.getByLabelText("목록으로 돌아가기").getAttribute("href")).toBe(
      "/benefits?category=housing&page=3"
    );
  });

  it("falls back to /benefits when returnTo is missing", async () => {
    render(createElement(BenefitDetailClient, { id: "b1" }));
    await waitFor(() => screen.getByText(benefit.title));
    expect(screen.getByLabelText("목록으로 돌아가기").getAttribute("href")).toBe("/benefits");
  });

  it("rejects a malicious/external returnTo and falls back to /benefits", async () => {
    currentSearch = new URLSearchParams({ returnTo: "https://evil.com" });
    render(createElement(BenefitDetailClient, { id: "b1" }));
    await waitFor(() => screen.getByText(benefit.title));
    expect(screen.getByLabelText("목록으로 돌아가기").getAttribute("href")).toBe("/benefits");
  });

  it("restores /home when opened from Home", async () => {
    currentSearch = new URLSearchParams({ returnTo: "/home" });
    render(createElement(BenefitDetailClient, { id: "b1" }));
    await waitFor(() => screen.getByText(benefit.title));
    expect(screen.getByLabelText("목록으로 돌아가기").getAttribute("href")).toBe("/home");
  });

  it("restores /saved when opened from Saved", async () => {
    currentSearch = new URLSearchParams({ returnTo: "/saved" });
    render(createElement(BenefitDetailClient, { id: "b1" }));
    await waitFor(() => screen.getByText(benefit.title));
    expect(screen.getByLabelText("목록으로 돌아가기").getAttribute("href")).toBe("/saved");
  });
});
