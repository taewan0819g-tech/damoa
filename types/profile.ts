import type { BenefitCategory } from "./benefit";

export type MaritalStatus = "single" | "married" | "divorced" | "widowed";

export type EmploymentStatus =
  | "employed"
  | "unemployed"
  | "self_employed"
  | "freelancer"
  | "student"
  | "other";

export type EducationStatus =
  | "high_school"
  | "university"
  | "graduate_school"
  | "graduated"
  | "not_applicable";

export type HousingType =
  | "own"
  | "jeonse"
  | "monthly_rent"
  | "living_with_family"
  | "other";

/**
 * UI-selectable annual income bands (세전, 만원 단위 구간). Chosen instead of a
 * free-text number because most users don't know their exact annual income
 * off the top of their head, and a band is enough for range-vs-range
 * eligibility matching. "unknown" means the user explicitly said they don't
 * know — never silently defaulted to. Converted to a `{min, max}` KRW range
 * via `incomeBandToRange()` in lib/constants/incomeBands.ts.
 */
export type IncomeBand =
  | "none"
  | "under_1000"
  | "1000_2000"
  | "2000_3000"
  | "3000_4000"
  | "4000_5000"
  | "5000_7000"
  | "over_7000"
  | "unknown";

export interface UserProfile {
  birthDate?: string;

  residence?: {
    province?: string;
    city?: string;
  };

  maritalStatus?: MaritalStatus;
  childrenCount?: number;
  householdSize?: number;

  employmentStatus?: EmploymentStatus;
  educationStatus?: EducationStatus;

  /**
   * Exact-income fields, kept for backward compatibility (e.g. any existing
   * persisted profile, or callers that already know a precise figure).
   * Prefer `individualIncomeBand`/`householdIncomeBand` for new UI input.
   */
  annualIndividualIncome?: number;
  annualHouseholdIncome?: number;

  individualIncomeBand?: IncomeBand;
  householdIncomeBand?: IncomeBand;

  housingType?: HousingType;
  homeowner?: boolean;
  housingDeposit?: number;
  monthlyRent?: number;

  financialAssets?: number;
  totalAssets?: number;

  smeEmployee?: boolean;
  businessOwner?: boolean;

  interests?: BenefitCategory[];
}
