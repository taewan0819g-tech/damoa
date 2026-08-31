import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { getNow } from "@/lib/dates/now";

export type DDayInfo =
  | { kind: "upcoming"; days: number; label: `D-${number}` }
  | { kind: "today"; label: "오늘 마감" }
  | { kind: "closed"; label: "마감됨" };

/**
 * Computes a D-Day label from an application end date. Returns null when the
 * date is missing or malformed so callers can hide deadline UI instead of
 * showing a broken value.
 */
export function getDDayInfo(endDate: string | undefined, referenceDate: Date = getNow()): DDayInfo | null {
  if (!endDate) return null;
  const parsed = parseISO(endDate);
  if (!isValid(parsed)) return null;

  const days = differenceInCalendarDays(parsed, referenceDate);
  if (days < 0) return { kind: "closed", label: "마감됨" };
  if (days === 0) return { kind: "today", label: "오늘 마감" };
  return { kind: "upcoming", days, label: `D-${days}` };
}

export function formatDateRange(startDate?: string, endDate?: string): string | null {
  const format = (iso: string) => {
    const d = parseISO(iso);
    if (!isValid(d)) return null;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  const start = startDate ? format(startDate) : null;
  const end = endDate ? format(endDate) : null;

  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  if (end) return `~ ${end}`;
  return null;
}
