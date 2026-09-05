/**
 * Checkpoint: Benefits Navigation + List-State Persistence.
 *
 * Centralizes the benefits-list URL <-> UI-state contract so the URL can be
 * the single durable source of truth for search/filter/sort/page (see
 * app/(app)/benefits/BenefitsPageClient.tsx). Deliberately NOT a generic
 * query-string library: every accepted param is validated against an
 * explicit, hand-written allow-list, and any malformed/unknown value falls
 * back to the documented default rather than propagating garbage into
 * `usePaginatedBenefits`.
 */
import { CATEGORY_LABELS } from "@/lib/labels";
import type { BenefitSourceGroup } from "@/domain/benefit/sourceGroup";
import type { BenefitSort } from "@/domain/benefit/sort";
import type { BenefitCategory } from "@/types/benefit";

export interface BenefitListState {
  query: string;
  group: BenefitSourceGroup | "all";
  category: BenefitCategory | "all";
  sort: BenefitSort;
  page: number;
}

export const DEFAULT_LIST_STATE: BenefitListState = {
  query: "",
  group: "all",
  category: "all",
  sort: "recommended",
  page: 1,
};

const VALID_GROUPS = new Set<string>(["all", "government", "youth", "financial"]);
const VALID_CATEGORIES = new Set<string>(["all", ...(Object.keys(CATEGORY_LABELS) as BenefitCategory[])]);
const VALID_SORTS = new Set<string>(["recommended", "deadline", "latest", "rate"]);

/** A positive-integer page string ("0", "-1", "3.5", "abc", "" all fall back to the default). */
function parsePage(raw: string | null): number {
  if (raw === null) return DEFAULT_LIST_STATE.page;
  if (!/^[1-9][0-9]*$/.test(raw)) return DEFAULT_LIST_STATE.page;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : DEFAULT_LIST_STATE.page;
}

/**
 * Parses a benefits-list URL's search params into UI state. Every field
 * independently falls back to its default when absent, empty (for the
 * enum-like fields), or not a recognized value — this function can never
 * throw and can never produce a value outside the known enums.
 */
export function parseListState(searchParams: URLSearchParams): BenefitListState {
  const query = searchParams.get("q") ?? DEFAULT_LIST_STATE.query;

  const groupRaw = searchParams.get("group");
  const group = (groupRaw && VALID_GROUPS.has(groupRaw) ? groupRaw : DEFAULT_LIST_STATE.group) as
    | BenefitSourceGroup
    | "all";

  const categoryRaw = searchParams.get("category");
  const category = (categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : DEFAULT_LIST_STATE.category) as
    | BenefitCategory
    | "all";

  const sortRaw = searchParams.get("sort");
  const sort = (sortRaw && VALID_SORTS.has(sortRaw) ? sortRaw : DEFAULT_LIST_STATE.sort) as BenefitSort;

  const page = parsePage(searchParams.get("page"));

  return { query, group, category, sort, page };
}

/** Serializes list state back to search params, omitting anything at its default value. */
export function buildListSearchParams(state: BenefitListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== DEFAULT_LIST_STATE.query) params.set("q", state.query);
  if (state.group !== DEFAULT_LIST_STATE.group) params.set("group", state.group);
  if (state.category !== DEFAULT_LIST_STATE.category) params.set("category", state.category);
  if (state.sort !== DEFAULT_LIST_STATE.sort) params.set("sort", state.sort);
  if (state.page !== DEFAULT_LIST_STATE.page) params.set("page", String(state.page));
  return params;
}

/** Builds the canonical `/benefits[?...]` URL for a given list state — the return destination detail pages navigate back to. */
export function buildListUrl(state: BenefitListState): string {
  const qs = buildListSearchParams(state).toString();
  return qs ? `/benefits?${qs}` : "/benefits";
}
