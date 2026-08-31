import type { EducationStatus, EmploymentStatus } from "@/types/profile";

/**
 * Onboarding and the profile editor both collect "current status" as a single
 * choice, then fan it out into the two underlying profile fields
 * (employmentStatus/educationStatus) that the eligibility engine reads.
 */
export type CurrentStatusOption =
  | "employed"
  | "university"
  | "graduate_school"
  | "unemployed"
  | "self_employed"
  | "freelancer"
  | "other";

export const CURRENT_STATUS_OPTIONS: { value: CurrentStatusOption; label: string }[] = [
  { value: "employed", label: "직장인" },
  { value: "university", label: "대학생" },
  { value: "graduate_school", label: "대학원생" },
  { value: "unemployed", label: "취업준비/미취업" },
  { value: "self_employed", label: "자영업" },
  { value: "freelancer", label: "프리랜서" },
  { value: "other", label: "기타" },
];

export const CURRENT_STATUS_TO_PROFILE: Record<
  CurrentStatusOption,
  { employmentStatus: EmploymentStatus; educationStatus?: EducationStatus }
> = {
  employed: { employmentStatus: "employed" },
  university: { employmentStatus: "student", educationStatus: "university" },
  graduate_school: { employmentStatus: "student", educationStatus: "graduate_school" },
  unemployed: { employmentStatus: "unemployed" },
  self_employed: { employmentStatus: "self_employed" },
  freelancer: { employmentStatus: "freelancer" },
  other: { employmentStatus: "other" },
};

const NON_STUDENT_OPTIONS: CurrentStatusOption[] = [
  "employed",
  "unemployed",
  "self_employed",
  "freelancer",
  "other",
];

/** Reverse-maps stored employment/education status back to a single onboarding-style option. */
export function deriveCurrentStatus(
  employmentStatus?: EmploymentStatus,
  educationStatus?: EducationStatus
): CurrentStatusOption | undefined {
  if (employmentStatus === "student") {
    if (educationStatus === "graduate_school") return "graduate_school";
    if (educationStatus === "university") return "university";
    return undefined;
  }
  return NON_STUDENT_OPTIONS.find((option) => option === employmentStatus);
}
