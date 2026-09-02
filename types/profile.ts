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

  /**
   * ISO date the applicant's marriage was registered (혼인신고일). Added per
   * Phase 2 family/marital audit: real MOIS "신혼부부" eligibility text
   * defines its own duration threshold per policy (observed thresholds
   * include 6 months, 1/2/3/5/7 years — never a single fixed convention), so
   * a boolean "newlywed" field can't represent it. This date lets a
   * reference-date-aware rule (see lib/eligibility/marriageDuration.ts)
   * compute "혼인신고일로부터 N년 이내" per-policy instead of guessing a
   * threshold. Optional — undefined means "unknown", never treated as
   * ineligible.
   */
  marriageDate?: string;

  /**
   * Added per Phase 2 audit: "한부모(가족/가정)" is a legally defined (한부모
   * 가족지원법) applicant category distinct from maritalStatus (a single
   * parent can be divorced, widowed, or never-married) and appears in 660+
   * real MOIS records as a direct eligibility qualifier. Not inferable from
   * maritalStatus alone (a divorced/widowed person isn't necessarily raising
   * a child), so kept as its own explicit flag.
   */
  singleParent?: boolean;

  /**
   * Added per Phase 2 audit: "다문화가족" (다문화가족지원법) is a legally
   * defined family category (156+ real MOIS records) that isn't derivable
   * from maritalStatus/nationality fields this profile doesn't otherwise
   * capture.
   */
  multiculturalFamily?: boolean;

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
