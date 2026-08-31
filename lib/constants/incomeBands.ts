import type { IncomeBand } from "@/types/profile";

export const INCOME_BAND_OPTIONS: { value: IncomeBand; label: string }[] = [
  { value: "none", label: "소득 없음" },
  { value: "under_1000", label: "1,000만원 미만" },
  { value: "1000_2000", label: "1,000~2,000만원" },
  { value: "2000_3000", label: "2,000~3,000만원" },
  { value: "3000_4000", label: "3,000~4,000만원" },
  { value: "4000_5000", label: "4,000~5,000만원" },
  { value: "5000_7000", label: "5,000~7,000만원" },
  { value: "over_7000", label: "7,000만원 이상" },
  { value: "unknown", label: "잘 모르겠어요" },
];

const MANWON_TO_KRW = 10000;

/**
 * Converts a UI income band into a raw-KRW `{min, max}` range for
 * range-vs-range eligibility matching. "unknown" returns undefined — it
 * must never be treated as a numeric range (that would let an "I don't
 * know" answer silently pass or fail a rule).
 */
export function incomeBandToRange(band: IncomeBand | undefined): { min: number; max: number } | undefined {
  switch (band) {
    case "none":
      return { min: 0, max: 0 };
    case "under_1000":
      return { min: 0, max: 1000 * MANWON_TO_KRW };
    case "1000_2000":
      return { min: 1000 * MANWON_TO_KRW, max: 2000 * MANWON_TO_KRW };
    case "2000_3000":
      return { min: 2000 * MANWON_TO_KRW, max: 3000 * MANWON_TO_KRW };
    case "3000_4000":
      return { min: 3000 * MANWON_TO_KRW, max: 4000 * MANWON_TO_KRW };
    case "4000_5000":
      return { min: 4000 * MANWON_TO_KRW, max: 5000 * MANWON_TO_KRW };
    case "5000_7000":
      return { min: 5000 * MANWON_TO_KRW, max: 7000 * MANWON_TO_KRW };
    case "over_7000":
      return { min: 7000 * MANWON_TO_KRW, max: Number.POSITIVE_INFINITY };
    case "unknown":
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}
