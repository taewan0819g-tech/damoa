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

  annualIndividualIncome?: number;
  annualHouseholdIncome?: number;

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
