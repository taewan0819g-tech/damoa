import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_STATE,
  buildListSearchParams,
  buildListUrl,
  parseListState,
  type BenefitListState,
} from "@/lib/benefits/listState";

/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * Pure round-trip proof for the URL <-> list-state contract that makes the
 * benefits list URL the durable source of truth (see
 * app/(app)/benefits/BenefitsPageClient.tsx). Deep-link/refresh determinism
 * depends entirely on `parseListState` being total (never throws, never
 * produces an out-of-enum value) and `buildListSearchParams`/`buildListUrl`
 * agreeing on which values are "default" and therefore omittable.
 */
describe("parseListState — defaults and malformed-value fallback", () => {
  it("returns all defaults for an empty URL", () => {
    expect(parseListState(new URLSearchParams(""))).toEqual(DEFAULT_LIST_STATE);
  });

  it("initializes search/group/category/sort/page from valid params", () => {
    const params = new URLSearchParams("q=청년&group=youth&category=housing&sort=deadline&page=3");
    expect(parseListState(params)).toEqual({
      query: "청년",
      group: "youth",
      category: "housing",
      sort: "deadline",
      page: 3,
    });
  });

  it("falls back to default group for an unknown value", () => {
    expect(parseListState(new URLSearchParams("group=not-a-real-group")).group).toBe("all");
  });

  it("falls back to default category for an unknown value", () => {
    expect(parseListState(new URLSearchParams("category=nonsense")).category).toBe("all");
  });

  it("falls back to default sort for an unknown value", () => {
    expect(parseListState(new URLSearchParams("sort=alphabetical")).sort).toBe("recommended");
  });

  it.each([["0"], ["-1"], ["1.5"], ["abc"], [""], ["  2  "], ["2e3"]])(
    "falls back to page 1 for invalid page value %s",
    (raw) => {
      expect(parseListState(new URLSearchParams({ page: raw })).page).toBe(1);
    }
  );

  it("accepts a valid positive-integer page", () => {
    expect(parseListState(new URLSearchParams("page=42")).page).toBe(42);
  });

  it("treats an empty query string as the empty-string default, not a fallback", () => {
    expect(parseListState(new URLSearchParams("q=")).query).toBe("");
  });
});

describe("buildListSearchParams / buildListUrl — omit defaults, round-trip non-defaults", () => {
  it("omits every param at its default value", () => {
    expect(buildListSearchParams(DEFAULT_LIST_STATE).toString()).toBe("");
    expect(buildListUrl(DEFAULT_LIST_STATE)).toBe("/benefits");
  });

  it("includes only the non-default params", () => {
    const state: BenefitListState = { ...DEFAULT_LIST_STATE, category: "housing", page: 3 };
    const qs = buildListSearchParams(state);
    expect(qs.get("category")).toBe("housing");
    expect(qs.get("page")).toBe("3");
    expect(qs.has("q")).toBe(false);
    expect(qs.has("group")).toBe(false);
    expect(qs.has("sort")).toBe(false);
  });

  it("round-trips parseListState(buildListSearchParams(state)) back to the same state", () => {
    const state: BenefitListState = { query: "청년", group: "youth", category: "housing", sort: "deadline", page: 3 };
    expect(parseListState(buildListSearchParams(state))).toEqual(state);
  });

  it("builds the exact example URL shape", () => {
    const state: BenefitListState = { query: "청년", group: "youth", category: "housing", sort: "deadline", page: 3 };
    const url = buildListUrl(state);
    expect(url.startsWith("/benefits?")).toBe(true);
    expect(new URL(url, "http://x").searchParams.get("q")).toBe("청년");
  });
});
