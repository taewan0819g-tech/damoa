import type {
  BenefitCategory,
  BenefitSourceType,
  BenefitType,
  EligibilityStatus,
} from "@/types/benefit";
import type { EducationStatus, EmploymentStatus, HousingType, MaritalStatus } from "@/types/profile";

export const CATEGORY_LABELS: Record<BenefitCategory, string> = {
  asset_building: "자산형성",
  deposit: "예금",
  savings: "적금",
  loan: "대출",
  housing: "주거",
  employment: "취업",
  education: "교육",
  startup: "창업",
  family: "가족",
  childcare: "육아",
  transport: "교통",
  welfare: "복지",
  other: "기타",
};

export const SOURCE_TYPE_LABELS: Record<BenefitSourceType, string> = {
  government: "정부",
  local_government: "지자체",
  youth_policy: "청년정책",
  bank: "은행",
  savings_bank: "저축은행",
  financial_institution: "금융기관",
  card: "카드",
  insurance: "보험",
  securities: "증권",
  telecom: "통신",
  university: "대학",
  company: "기업복지",
  private: "민간",
  other: "기타",
};

export const BENEFIT_TYPE_LABELS: Record<BenefitType, string> = {
  cash: "현금지원",
  savings: "적금",
  deposit: "예금",
  loan: "대출",
  housing: "주거지원",
  discount: "할인",
  service: "서비스",
  other: "기타",
};

export const ELIGIBILITY_STATUS_LABELS: Record<EligibilityStatus, string> = {
  likely_eligible: "받을 가능성이 있어요",
  unknown: "확인이 필요해요",
  not_eligible: "현재 조건과 맞지 않아요",
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: "미혼",
  married: "기혼",
  divorced: "이혼",
  widowed: "사별",
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  employed: "직장인",
  unemployed: "취업준비/미취업",
  self_employed: "자영업",
  freelancer: "프리랜서",
  student: "학생",
  other: "기타",
};

export const EDUCATION_STATUS_LABELS: Record<EducationStatus, string> = {
  high_school: "고등학생",
  university: "대학생",
  graduate_school: "대학원생",
  graduated: "졸업",
  not_applicable: "해당없음",
};

export const HOUSING_TYPE_LABELS: Record<HousingType, string> = {
  own: "자가",
  jeonse: "전세",
  monthly_rent: "월세",
  living_with_family: "가족과 거주",
  other: "기타",
};

export const SOURCE_GROUP_LABELS = {
  government: "정부·지자체",
  youth: "청년정책",
  financial: "금융상품",
} as const;
