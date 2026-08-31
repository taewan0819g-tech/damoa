import { z } from "zod";
import { getNow } from "@/lib/dates/now";

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "유효하지 않은 날짜입니다." });

export const birthDateSchema = isoDateString.refine(
  (value) => new Date(value) <= getNow(),
  { message: "생년월일은 미래일 수 없습니다." }
);

export const userProfileSchema = z.object({
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
  employmentStatus: z
    .enum(["employed", "unemployed", "self_employed", "freelancer", "student", "other"])
    .optional(),
  educationStatus: z
    .enum(["high_school", "university", "graduate_school", "graduated", "not_applicable"])
    .optional(),
  annualIndividualIncome: z.number().min(0, "소득은 0 이상이어야 합니다.").optional(),
  annualHouseholdIncome: z.number().min(0, "소득은 0 이상이어야 합니다.").optional(),
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

export type UserProfileInput = z.infer<typeof userProfileSchema>;

export function parseUserProfile(value: unknown) {
  return userProfileSchema.safeParse(value);
}
