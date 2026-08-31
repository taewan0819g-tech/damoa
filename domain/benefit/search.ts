import type { Benefit } from "@/types/benefit";

export function searchBenefits(benefits: Benefit[], query: string): Benefit[] {
  const q = query.trim().toLowerCase();
  if (!q) return benefits;
  return benefits.filter(
    (b) =>
      b.title.toLowerCase().includes(q) ||
      b.source.organization.toLowerCase().includes(q) ||
      (b.institution?.name.toLowerCase().includes(q) ?? false)
  );
}
