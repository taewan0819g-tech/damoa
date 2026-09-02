import { describe, expect, it } from "vitest";
import { booleanFromTriState, triStateFromBoolean } from "@/lib/constants/triState";

/**
 * Part H (UI wiring for singleParentFamily/multiculturalFamily) requires an
 * explicit three-way choice — 해당해요/해당하지 않아요/잘 모르겠어요 — that
 * never silently defaults missing data to `false`. These are the only two
 * pure conversion functions between that UI tri-state and the profile's
 * `boolean | undefined` field, so this is the single place the "never
 * default missing to false" invariant can be verified in isolation.
 */
describe("triState conversion helpers", () => {
  describe("booleanFromTriState", () => {
    it('"yes" -> true', () => {
      expect(booleanFromTriState("yes")).toBe(true);
    });

    it('"no" -> false', () => {
      expect(booleanFromTriState("no")).toBe(false);
    });

    it('"unknown" (explicitly acknowledged as unknown) -> undefined, never false', () => {
      expect(booleanFromTriState("unknown")).toBeUndefined();
    });

    it("undefined (not yet answered) -> undefined, never false", () => {
      expect(booleanFromTriState(undefined)).toBeUndefined();
    });
  });

  describe("triStateFromBoolean", () => {
    it("true -> \"yes\"", () => {
      expect(triStateFromBoolean(true)).toBe("yes");
    });

    it("false -> \"no\"", () => {
      expect(triStateFromBoolean(false)).toBe("no");
    });

    it("undefined -> undefined (no option pre-selected, distinct from an explicit \"unknown\" pick)", () => {
      expect(triStateFromBoolean(undefined)).toBeUndefined();
    });
  });

  describe("round-trip: an old persisted profile with the field simply absent behaves identically to a fresh unanswered field", () => {
    it("undefined -> triStateFromBoolean -> undefined -> booleanFromTriState -> undefined (never false)", () => {
      const persistedValue: boolean | undefined = undefined; // simulates a pre-Phase-2 persisted profile
      const uiChoice = triStateFromBoolean(persistedValue);
      expect(uiChoice).toBeUndefined();
      expect(booleanFromTriState(uiChoice)).toBeUndefined();
    });
  });
});
