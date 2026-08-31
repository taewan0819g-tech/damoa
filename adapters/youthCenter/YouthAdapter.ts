import type { Benefit } from "@/types/benefit";

/** Shape of a single raw record from the 온통청년(Youth Center) API. Fill in once the real schema is known. */
export interface YouthRawPolicy {
  plcyNo: string;
  plcyNm: string;
  plcyExplnCn: string;
  sprvsnInstCdNm: string;
  aplyYmd?: string;
  refUrlAddr1?: string;
  frstRegDt?: string;
  [key: string]: unknown;
}

/**
 * Normalizes a raw 온통청년 API record into the app's common Benefit schema.
 * The UI never touches YouthRawPolicy directly — only this function's output.
 */
export function normalizeYouthPolicy(raw: YouthRawPolicy): Benefit {
  return {
    id: `youth-${raw.plcyNo}`,
    title: raw.plcyNm,
    shortDescription: raw.plcyExplnCn,
    category: "other",
    source: { type: "youth_policy", organization: raw.sprvsnInstCdNm, providerId: raw.plcyNo },
    benefitType: "other",
    application: { officialUrl: raw.refUrlAddr1, sourceUrl: raw.refUrlAddr1 },
    institution: { name: raw.sprvsnInstCdNm, type: "local_government" },
    updatedAt: raw.frstRegDt,
    isDemo: false,
  };
}
