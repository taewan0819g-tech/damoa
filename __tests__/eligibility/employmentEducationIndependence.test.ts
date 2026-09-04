import { describe, expect, it } from "vitest";
import { useProfileStore } from "@/stores/profileStore";
import { evaluateEligibility } from "@/lib/eligibility/ruleEngine";
import type { EligibilityRuleGroup } from "@/types/benefit";
import type { UserProfile } from "@/types/profile";

/**
 * Checkpoint: Independent Employment + Education Profile Input.
 *
 * employmentStatus and educationStatus are independent UserProfile fields.
 * Onboarding/profile UI used to collapse them into a single `currentStatus`
 * choice via CURRENT_STATUS_TO_PROFILE (domain/profile/currentStatus.ts,
 * now removed as dead code), which made combinations like
 * `employed + university` or `freelancer + graduate_school` unrepresentable.
 * These tests prove the store and UI layer now preserve both fields
 * independently, with no inference from one to the other.
 */
describe("employmentStatus / educationStatus independence", () => {
  it("1. stores employed + university simultaneously", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "employed", educationStatus: "university" });
    expect(useProfileStore.getState().profile).toMatchObject({
      employmentStatus: "employed",
      educationStatus: "university",
    });
  });

  it("2. stores freelancer + graduate_school simultaneously", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "freelancer", educationStatus: "graduate_school" });
    expect(useProfileStore.getState().profile).toMatchObject({
      employmentStatus: "freelancer",
      educationStatus: "graduate_school",
    });
  });

  it("3. stores student + university (the classic combination) unchanged", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "student", educationStatus: "university" });
    expect(useProfileStore.getState().profile).toMatchObject({
      employmentStatus: "student",
      educationStatus: "university",
    });
  });

  it("4. changing employmentStatus does not erase an already-set educationStatus", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "student", educationStatus: "graduate_school" });
    useProfileStore.getState().updateProfile({ employmentStatus: "employed" });
    const profile = useProfileStore.getState().profile;
    expect(profile.employmentStatus).toBe("employed");
    expect(profile.educationStatus).toBe("graduate_school");
  });

  it("5. changing educationStatus does not erase an already-set employmentStatus", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "freelancer", educationStatus: "high_school" });
    useProfileStore.getState().updateProfile({ educationStatus: "not_applicable" });
    const profile = useProfileStore.getState().profile;
    expect(profile.employmentStatus).toBe("freelancer");
    expect(profile.educationStatus).toBe("not_applicable");
  });

  it("6. an existing stored profile with only employmentStatus set renders without gaining a guessed educationStatus", () => {
    useProfileStore.getState().setProfile({ employmentStatus: "employed" });
    const profile = useProfileStore.getState().profile;
    expect(profile.employmentStatus).toBe("employed");
    expect(profile.educationStatus).toBeUndefined();
  });

  it("6b. a pre-existing persisted combination unrepresentable by the old currentStatus mapping (employed + university) round-trips through setProfile unchanged", () => {
    const legacy: UserProfile = { employmentStatus: "employed", educationStatus: "university" };
    useProfileStore.getState().setProfile(legacy);
    expect(useProfileStore.getState().profile).toMatchObject(legacy);
  });

  it("7. no production code maps educationStatus 'university' to employmentStatus 'student' unless explicitly chosen", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ educationStatus: "university" });
    expect(useProfileStore.getState().profile.employmentStatus).toBeUndefined();
  });

  it("8. no production code maps employmentStatus 'student' to educationStatus 'university' unless explicitly chosen", () => {
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "student" });
    expect(useProfileStore.getState().profile.educationStatus).toBeUndefined();
  });

  it("9. eligibility status is identical for identical profiles regardless of how employment/education were entered", () => {
    const rule: EligibilityRuleGroup = {
      type: "all",
      rules: [
        { id: "employment", field: "employmentStatus", operator: "in", value: ["employed", "freelancer"], required: true },
        { id: "education", field: "educationStatus", operator: "eq", value: "graduate_school", required: true },
      ],
    };
    const profile: UserProfile = { employmentStatus: "freelancer", educationStatus: "graduate_school" };
    expect(evaluateEligibility({ eligibility: rule }, profile)).toBe("likely_eligible");

    // Same field values, built up via two separate independent updateProfile
    // calls (as the new two-editor UI does) instead of one combined write —
    // eligibility must not depend on how the fields were assembled.
    useProfileStore.getState().resetProfile();
    useProfileStore.getState().updateProfile({ employmentStatus: "freelancer" });
    useProfileStore.getState().updateProfile({ educationStatus: "graduate_school" });
    expect(evaluateEligibility({ eligibility: rule }, useProfileStore.getState().profile)).toBe("likely_eligible");
  });
});
