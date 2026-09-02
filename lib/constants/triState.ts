/**
 * Shared UI helper for optional-boolean profile fields (singleParentFamily,
 * multiculturalFamily) that must offer a genuine three-way choice —
 * 해당해요(yes) / 해당하지 않아요(no) / 잘 모르겠어요(explicitly unknown) —
 * rather than a plain checkbox. A checkbox can only represent two states, so
 * an unanswered checkbox is indistinguishable from an answered "no", which
 * would silently default missing data to `false`. These fields must never do
 * that (see types/profile.ts's own doc comments on singleParentFamily /
 * multiculturalFamily): `undefined` means "not yet answered" and is treated
 * identically to an explicit "잘 모르겠어요" — both map back to `undefined`
 * on write, so this control can never itself introduce a false negative.
 */
export type TriStateChoice = "yes" | "no" | "unknown";

export const TRI_STATE_OPTIONS: { value: TriStateChoice; label: string }[] = [
  { value: "yes", label: "해당해요" },
  { value: "no", label: "해당하지 않아요" },
  { value: "unknown", label: "잘 모르겠어요" },
];

/**
 * Same three-way choice/semantics as `TRI_STATE_OPTIONS`, with wording for
 * the `homeowner` field specifically ("주택을 소유하고 있나요?" — housing
 * ownership is a factual yes/no/unknown, not a "해당해요"-style category
 * match). Backed by the exact same `TriStateChoice` type and
 * `triStateFromBoolean`/`booleanFromTriState` conversion functions — reused,
 * not reimplemented — so `homeowner` gets the identical "never default
 * missing to false" guarantee as singleParentFamily/multiculturalFamily.
 */
export const HOMEOWNER_TRI_STATE_OPTIONS: { value: TriStateChoice; label: string }[] = [
  { value: "yes", label: "소유하고 있어요" },
  { value: "no", label: "소유하고 있지 않아요" },
  { value: "unknown", label: "잘 모르겠어요" },
];

/** `undefined` (not yet answered) has no selected option — never pre-selects "unknown". */
export function triStateFromBoolean(value: boolean | undefined): TriStateChoice | undefined {
  if (value === true) return "yes";
  if (value === false) return "no";
  return undefined;
}

/**
 * "unknown", "not yet answered" (`undefined`), and any other value all
 * resolve to `undefined`, never `false` — accepts `undefined` directly so
 * callers can pass a draft field straight through without an extra ternary.
 */
export function booleanFromTriState(choice: TriStateChoice | undefined): boolean | undefined {
  if (choice === "yes") return true;
  if (choice === "no") return false;
  return undefined;
}
