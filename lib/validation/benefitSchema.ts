import { z } from "zod";

const ruleOperatorSchema = z.enum(["eq", "neq", "in", "not_in", "gte", "lte", "between", "exists"]);

const eligibilityRuleSchema = z.object({
  id: z.string(),
  field: z.string(),
  operator: ruleOperatorSchema,
  value: z.unknown().optional(),
  required: z.boolean(),
});

type RuleGroupInput = z.infer<typeof eligibilityRuleSchema> | { type: "all" | "any"; rules: unknown[] };

const eligibilityRuleGroupSchema: z.ZodType<RuleGroupInput> = z.lazy(() =>
  z.object({
    type: z.enum(["all", "any"]),
    rules: z.array(z.union([eligibilityRuleSchema, eligibilityRuleGroupSchema])),
  })
);

const optionalUrl = z.string().url().optional().or(z.literal("").transform(() => undefined));

export const benefitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  shortDescription: z.string(),
  category: z.enum([
    "asset_building",
    "deposit",
    "savings",
    "loan",
    "housing",
    "employment",
    "education",
    "startup",
    "family",
    "childcare",
    "transport",
    "welfare",
    "other",
  ]),
  source: z.object({
    type: z.enum([
      "government",
      "local_government",
      "youth_policy",
      "bank",
      "savings_bank",
      "financial_institution",
      "card",
      "insurance",
      "securities",
      "telecom",
      "university",
      "company",
      "private",
      "other",
    ]),
    organization: z.string().min(1),
    providerId: z.string().optional(),
  }),
  benefitType: z.enum(["cash", "savings", "deposit", "loan", "housing", "discount", "service", "other"]),
  financial: z
    .object({
      interestRate: z.number().optional(),
      maxInterestRate: z.number().optional(),
      loanInterestRate: z.number().optional(),
      maxAmount: z.number().optional(),
      minAmount: z.number().optional(),
      periodMonths: z.number().optional(),
      amountDescription: z.string().optional(),
    })
    .optional(),
  eligibility: eligibilityRuleGroupSchema.optional(),
  application: z
    .object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      officialUrl: optionalUrl,
      applicationUrl: optionalUrl,
      sourceUrl: optionalUrl,
    })
    .optional(),
  institution: z
    .object({
      name: z.string(),
      type: z.enum(["government", "local_government", "bank", "savings_bank", "financial_institution", "other"]),
    })
    .optional(),
  requiredDocuments: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
  isDemo: z.boolean().optional(),
  eligibilityUnrestricted: z.boolean().optional(),
});

export function parseBenefit(value: unknown) {
  return benefitSchema.safeParse(value);
}

/** Filters out malformed entries instead of throwing, so one bad record can't break the list. */
export function parseBenefitList(values: unknown[]) {
  return values.filter((value): value is z.infer<typeof benefitSchema> => benefitSchema.safeParse(value).success);
}
