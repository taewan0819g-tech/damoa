import { differenceInYears, isValid, isFuture, parseISO } from "date-fns";
import { getNow } from "@/lib/dates/now";

/**
 * Returns the person's current (Korean "만 나이") age from an ISO birth date.
 * Returns null for missing, malformed, or future birth dates rather than throwing,
 * so callers can treat age as "unknown" instead of crashing.
 */
export function calculateAge(birthDate: string | undefined, referenceDate: Date = getNow()): number | null {
  if (!birthDate) return null;
  const parsed = parseISO(birthDate);
  if (!isValid(parsed)) return null;
  if (isFuture(parsed) && parsed > referenceDate) return null;
  const age = differenceInYears(referenceDate, parsed);
  if (age < 0 || age > 130) return null;
  return age;
}
