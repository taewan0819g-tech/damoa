import type { Benefit } from "@/types/benefit";

/** Shape of a single raw record from the MOIS public service (혜택) API. Fill in once the real schema is known. */
export interface MOISRawBenefit {
  servId: string;
  servNm: string;
  servDgst: string;
  jurMnofNm: string;
  svcFrstRegTs?: string;
  aplyBgngYmd?: string;
  aplyEndYmd?: string;
  servDtlLink?: string;
  [key: string]: unknown;
}

/**
 * Normalizes a raw MOIS API record into the app's common Benefit schema.
 * The UI never touches MOISRawBenefit directly — only this function's output.
 */
export function normalizeMOISBenefit(raw: MOISRawBenefit): Benefit {
  return {
    id: `mois-${raw.servId}`,
    title: raw.servNm,
    shortDescription: raw.servDgst,
    category: "other",
    source: { type: "government", organization: raw.jurMnofNm, providerId: raw.servId },
    benefitType: "other",
    application: {
      startDate: raw.aplyBgngYmd,
      endDate: raw.aplyEndYmd,
      officialUrl: raw.servDtlLink,
      sourceUrl: raw.servDtlLink,
    },
    institution: { name: raw.jurMnofNm, type: "government" },
    updatedAt: raw.svcFrstRegTs,
    isDemo: false,
  };
}
