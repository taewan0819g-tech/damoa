import { z } from "zod";
import { getNow } from "@/lib/dates/now";
import { isValidCalendarDateString, isTodayOrPastPolicyDateString } from "@/lib/dates/policyDate";
import { normalizeHomeownerConsistency } from "@/domain/profile/homeownerConsistency";

/**
 * Strict `YYYY-MM-DD` calendar-date string: rejects malformed input AND
 * impossible calendar dates (e.g. "2026-02-30", "2025-02-29" — not a leap
 * year) rather than letting JS `Date`'s auto-normalizing constructor
 * silently turn them into a different, valid date. See lib/dates/policyDate.ts.
 */
const dateOnlyString = z
  .string()
  .refine((value) => isValidCalendarDateString(value), { message: "유효하지 않은 날짜입니다." });

export const birthDateSchema = dateOnlyString.refine(
  (value) => isTodayOrPastPolicyDateString(value, getNow()),
  { message: "생년월일은 미래일 수 없습니다." }
);

const userProfileObjectSchema = z.object({
  birthDate: birthDateSchema.optional(),
  residence: z
    .object({
      province: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).optional(),
  childrenCount: z.number().int().min(0, "자녀 수는 0 이상이어야 합니다.").optional(),
  householdSize: z.number().int().min(1).optional(),
  marriageDate: dateOnlyString
    .refine((value) => isTodayOrPastPolicyDateString(value, getNow()), { message: "혼인신고일은 미래일 수 없습니다." })
    .optional(),
  singleParentFamily: z.boolean().optional(),
  multiculturalFamily: z.boolean().optional(),
  employmentStatus: z
    .enum(["employed", "unemployed", "self_employed", "freelancer", "student", "other"])
    .optional(),
  educationStatus: z
    .enum(["high_school", "university", "graduate_school", "graduated", "not_applicable"])
    .optional(),
  annualIndividualIncome: z.number().min(0, "소득은 0 이상이어야 합니다.").optional(),
  annualHouseholdIncome: z.number().min(0, "소득은 0 이상이어야 합니다.").optional(),
  individualIncomeBand: z
    .enum(["none", "under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_7000", "over_7000", "unknown"])
    .optional(),
  householdIncomeBand: z
    .enum(["none", "under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_7000", "over_7000", "unknown"])
    .optional(),
  housingType: z.enum(["own", "jeonse", "monthly_rent", "living_with_family", "other"]).optional(),
  homeowner: z.boolean().optional(),
  housingDeposit: z.number().min(0).optional(),
  monthlyRent: z.number().min(0).optional(),
  financialAssets: z.number().min(0).optional(),
  totalAssets: z.number().min(0).optional(),
  smeEmployee: z.boolean().optional(),
  businessOwner: z.boolean().optional(),
  interests: z.array(z.string()).optional(),
});

/**
 * Normalizes `{ housingType: "own", homeowner: false }` (and the
 * `homeowner: undefined` variant) to `homeowner: true` for ANY externally
 * supplied profile that reaches this schema (e.g. `app/api/benefits/match`'s
 * request body) — see `domain/profile/homeownerConsistency.ts`. The
 * client-side write paths (onboarding, the profile-edit page, and
 * `profileStore`) apply the identical normalization at their own write
 * points so the contradiction can't be created OR persisted in the first
 * place; this transform is the last-resort backstop for data this app
 * didn't itself produce.
 */
export const userProfileSchema = userProfileObjectSchema.transform(normalizeHomeownerConsistency);

export type UserProfileInput = z.infer<typeof userProfileSchema>;

export function parseUserProfile(value: unknown) {
  return userProfileSchema.safeParse(value);
}
