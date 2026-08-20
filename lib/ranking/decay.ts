import { RECENCY_HALF_LIFE_DAYS } from "@/config/ranking";

/** Reusable exponential recency decay: exp(-daysSince / halfLifeDays), clamped to [0,1]. */
export function recencyScore(dateIso: string, halfLifeDays: number = RECENCY_HALF_LIFE_DAYS): number {
  const daysSince = (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 0) return 1;
  return Math.min(1, Math.max(0, Math.exp(-daysSince / halfLifeDays)));
}

export function mostRecent(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((latest, d) => (new Date(d) > new Date(latest) ? d : latest));
}

export function daysBetween(a: string, b: string = new Date().toISOString()): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);
}
