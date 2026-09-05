// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BenefitsPageClient } from "@/app/(app)/benefits/BenefitsPageClient";
import { useProfileStore } from "@/stores/profileStore";
import { CATEGORY_LABELS, SOURCE_GROUP_LABELS } from "@/lib/labels";
import type { Benefit } from "@/types/benefit";

// Mirrors BenefitsPageClient's internal `SEARCH_DEBOUNCE_MS` (not exported —
// this is only used to size a "wait long enough that a debounce would have
// fired" delay in tests, not to assert on the exact value).
const SEARCH_DEBOUNCE_MS = 350;

let currentSearch = new URLSearchParams("");
const replaceMock = vi.fn((url: string) => {
  const qIndex = url.indexOf("?");
  currentSearch = new URLSearchParams(qIndex === -1 ? "" : url.slice(qIndex + 1));
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => currentSearch,
}));

const sampleBenefit: Benefit = {
  id: "b1",
  title: "청년 월세 지원",
  shortDescription: "desc",
  category: "housing",
  source: { type: "government", organization: "org" },
  benefitType: "other",
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function mockFetchOnce(overrides: Partial<{ total: number; totalPages: number; benefits: Benefit[] }> = {}) {
  return jsonResponse({
    benefits: overrides.benefits ?? [sampleBenefit],
    statuses: { b1: "unknown" },
    page: 1,
    pageSize: 20,
    total: overrides.total ?? 1,
    totalPages: overrides.totalPages ?? 1,
    counts: { likely_eligible: 0, unknown: 1, not_eligible: 0 },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  currentSearch = new URLSearchParams("");
  replaceMock.mockClear();
  useProfileStore.getState().resetProfile();
  fetchMock = vi.fn(async () => mockFetchOnce());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lastRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse(call?.[1]?.body as string);
}

/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * The URL is now the durable source of truth for the benefits list's
 * search/filter/sort/page controls (see lib/benefits/listState.ts). These
 * tests prove deep-link/refresh determinism end-to-end through the real
 * component, and that the `usePaginatedBenefits` request shape sent to
 * POST /api/benefits/match is unchanged by this refactor.
 */
describe("BenefitsPageClient — URL is the source of truth", () => {
  it("1. initializes search/group/category/sort/page from the URL", async () => {
    currentSearch = new URLSearchParams("q=청년&group=youth&category=housing&sort=deadline&page=3");
    render(createElement(BenefitsPageClient));

    expect((screen.getByLabelText("혜택 검색") as HTMLInputElement).value).toBe("청년");
    expect(screen.getByRole("button", { name: SOURCE_GROUP_LABELS.youth }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: CATEGORY_LABELS.housing }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("정렬") as HTMLSelectElement).value).toBe("deadline");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody()).toMatchObject({
      page: 3,
      pageSize: 20,
      search: "청년",
      group: "youth",
      category: "housing",
      sort: "deadline",
    });
  });

  it("3. malformed group/category/sort/page in the URL safely fall back to defaults", async () => {
    currentSearch = new URLSearchParams("group=bogus&category=bogus&sort=bogus&page=-5");
    render(createElement(BenefitsPageClient));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody()).toMatchObject({
      page: 1,
      search: "",
      group: "all",
      category: "all",
      sort: "recommended",
    });
    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("4. changing search resets page to 1 (after the debounce commits it to the URL)", async () => {
    currentSearch = new URLSearchParams("page=3");
    const { rerender } = render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("혜택 검색"), { target: { value: "새검색어" } });
    await waitFor(
      () =>
        expect(replaceMock).toHaveBeenCalledWith(
          expect.stringContaining("q=%EC%83%88%EA%B2%80%EC%83%89%EC%96%B4"),
          expect.anything()
        ),
      { timeout: 2000 }
    );
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
    rerender(createElement(BenefitsPageClient));

    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 1, search: "새검색어" }));
  });

  it("5. changing group/category/sort resets page to 1", async () => {
    currentSearch = new URLSearchParams("page=3");
    const { rerender } = render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: SOURCE_GROUP_LABELS.youth }));
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 1, group: "youth" }));

    currentSearch = new URLSearchParams("group=youth&page=3");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: CATEGORY_LABELS.housing }));
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 1, category: "housing" }));

    currentSearch = new URLSearchParams("category=housing&page=3");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("정렬"), { target: { value: "latest" } });
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 1, sort: "latest" }));
  });

  it("6. next/previous pagination updates the URL page param", async () => {
    fetchMock.mockImplementation(async () => mockFetchOnce({ total: 100, totalPages: 5 }));
    currentSearch = new URLSearchParams("");
    const { rerender } = render(createElement(BenefitsPageClient));
    await waitFor(() => expect(screen.getByText("1 / 5")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.anything());
    rerender(createElement(BenefitsPageClient));

    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(lastRequestBody()).toMatchObject({ page: 1 }));
  });

  it("7. benefits-list detail link carries the exact current canonical list URL as returnTo", async () => {
    currentSearch = new URLSearchParams("category=housing&page=3");
    render(createElement(BenefitsPageClient));
    await waitFor(() => screen.getByText(sampleBenefit.title));

    const link = screen.getByRole("link", { name: new RegExp(sampleBenefit.title) });
    expect(link.getAttribute("href")).toBe(
      `/benefits/b1?returnTo=${encodeURIComponent("/benefits?category=housing&page=3")}`
    );
  });

  it("13. sends the same usePaginatedBenefits request shape (page/pageSize/search/group/category/sort) the API already expects", async () => {
    currentSearch = new URLSearchParams("q=abc&group=government&category=welfare&sort=latest&page=2");
    render(createElement(BenefitsPageClient));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/benefits/match");
    expect(init.method).toBe("POST");
    expect(lastRequestBody()).toMatchObject({
      page: 2,
      pageSize: 20,
      search: "abc",
      group: "government",
      category: "welfare",
      sort: "latest",
    });
  });
});

/**
 * Fix: Korean IME composition in the /benefits search input.
 *
 * The search input previously wrote `router.replace` synchronously on every
 * `onChange`, which interrupted native IME composition (typing "이천" would
 * render as decomposed jamo like "ㅇ ㅣ ㅊ ㅓ ㄴ") because the URL/re-render
 * happened before `compositionend`. The input now keeps a local draft value:
 * while composing, only the draft updates; on `compositionend` the composed
 * string commits to the URL immediately; normal (non-IME) typing debounces
 * the URL commit instead of firing on every keystroke.
 */
describe("BenefitsPageClient — IME-safe search input", () => {
  it("Korean composition ('ㅇ' then 'ㅇㅣ') does not call router.replace mid-composition", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();

    const input = screen.getByLabelText("혜택 검색") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅇ" } });
    fireEvent.change(input, { target: { value: "ㅇㅣ" } });

    // Give any (incorrectly) scheduled debounce timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 150));

    expect(replaceMock).not.toHaveBeenCalled();
    expect(input.value).toBe("ㅇㅣ");
  });

  it("compositionend with '이' commits q=이 and resets page to 1", async () => {
    currentSearch = new URLSearchParams("page=3");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByLabelText("혜택 검색") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅇ" } });
    fireEvent.change(input, { target: { value: "이" } });
    fireEvent.compositionEnd(input, { target: { value: "이" } });

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        expect.stringContaining(`q=${encodeURIComponent("이")}`),
        expect.anything()
      )
    );
    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("page=");
  });

  it("full '이천' commits as composed Hangul, not decomposed jamo", async () => {
    currentSearch = new URLSearchParams("");
    const { rerender } = render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByLabelText("혜택 검색") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅇ" } });
    fireEvent.change(input, { target: { value: "이" } });
    fireEvent.change(input, { target: { value: "이ㅊ" } });
    fireEvent.change(input, { target: { value: "이천" } });
    fireEvent.compositionEnd(input, { target: { value: "이천" } });

    expect(input.value).toBe("이천");
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining(`q=${encodeURIComponent("이천")}`), expect.anything())
    );
    rerender(createElement(BenefitsPageClient));
    await waitFor(() => expect(lastRequestBody()).toMatchObject({ search: "이천", page: 1 }));
  });

  it("normal English typing still updates the URL after the debounce", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByLabelText("혜택 검색") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });

    // Not committed synchronously — it's debounced.
    expect(replaceMock).not.toHaveBeenCalled();

    await waitFor(
      () => expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("q=abc"), expect.anything()),
      { timeout: 2000 }
    );
  });

  it("external URL query change syncs the input when not composing", async () => {
    currentSearch = new URLSearchParams("q=abc");
    const { rerender } = render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((screen.getByLabelText("혜택 검색") as HTMLInputElement).value).toBe("abc");

    currentSearch = new URLSearchParams("q=xyz");
    rerender(createElement(BenefitsPageClient));

    await waitFor(() => expect((screen.getByLabelText("혜택 검색") as HTMLInputElement).value).toBe("xyz"));
  });
});

/**
 * Pre-beta cleanup: hide the dead "예금" category chip and the always-empty
 * "금융상품" group tab from the CURRENT selectable filters (0/13,712 real
 * coverage for deposit; no FSS provider registered in production for
 * financial). Domain types/labels/URL parsing for both are deliberately
 * kept unchanged — only the user-visible controls are hidden.
 */
describe("BenefitsPageClient — pre-beta hidden filter cleanup", () => {
  it("1. visible category chips do not include 예금 (deposit)", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: CATEGORY_LABELS.deposit })).toBeNull();
  });

  it("2. savings (적금) remains a visible category chip", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: CATEGORY_LABELS.savings })).toBeTruthy();
  });

  it("3. loan (대출) remains a visible category chip", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: CATEGORY_LABELS.loan })).toBeTruthy();
  });

  it("4. visible source-group tabs do not include 금융상품 (financial)", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: SOURCE_GROUP_LABELS.financial })).toBeNull();
  });

  it("5. government (정부·지자체) remains a visible group tab", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: SOURCE_GROUP_LABELS.government })).toBeTruthy();
  });

  it("6. youth (청년정책) remains a visible group tab", async () => {
    currentSearch = new URLSearchParams("");
    render(createElement(BenefitsPageClient));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: SOURCE_GROUP_LABELS.youth })).toBeTruthy();
  });

  it("9. a direct ?category=deposit&group=financial URL still parses and filters safely, even with no visible chip for either", async () => {
    currentSearch = new URLSearchParams("category=deposit&group=financial");
    render(createElement(BenefitsPageClient));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequestBody()).toMatchObject({ category: "deposit", group: "financial" });
    // No visible chip renders as selected for either value, since neither is offered as a control.
    expect(screen.queryByRole("button", { name: CATEGORY_LABELS.deposit })).toBeNull();
    expect(screen.queryByRole("button", { name: SOURCE_GROUP_LABELS.financial })).toBeNull();
  });
});
