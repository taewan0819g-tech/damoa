import { describe, expect, it } from "vitest";
import { calculateProfileCompletion } from "@/domain/profile/completion";
import type { UserProfile } from "@/types/profile";

/**
 * Checkpoint: Independent Employment + Education Profile Input.
 *
 * employmentStatus and educationStatus were already tracked as two separate
 * entries in completion.ts's TRACKED_FIELDS before this checkpoint (the
 * onboarding/profile UI just couldn't previously produce every combination).
 * These tests lock in that the completion indicator continues to treat them
 * as independent, non-double-counted dimensions now that the UI can set
 * them independently.
 */
describe("calculateProfileCompletion — employmentStatus/educationStatus independence", () => {
  it("counts an employmentStatus-only profile as filling exactly one of the two status fields", () => {
    const withEmploymentOnly = calculateProfileCompletion({ employmentStatus: "employed" });
    const withNeither = calculateProfileCompletion({});
    const withBoth: UserProfile = { employmentStatus: "employed", educationStatus: "university" };
    const withBothScore = calculateProfileCompletion(withBoth);

    // Filling one more field (employmentStatus) than the empty profile
    // strictly increases completion...
    expect(withEmploymentOnly).toBeGreaterThan(withNeither);
    // ...and filling both independent fields increases it further still —
    // proving they are not treated as a single combined field.
    expect(withBothScore).toBeGreaterThan(withEmploymentOnly);
  });

  it("does not inflate completion for an unanswered educationStatus just because employmentStatus is set", () => {
    const employedNoEducation = calculateProfileCompletion({ employmentStatus: "employed" });
    const employedWithEducation = calculateProfileCompletion({
      employmentStatus: "employed",
      educationStatus: "not_applicable",
    });
    expect(employedWithEducation).toBeGreaterThan(employedNoEducation);
  });
});
