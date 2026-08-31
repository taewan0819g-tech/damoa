import { NextResponse } from "next/server";
import { benefitProvider } from "@/providers";
import { matchBenefits } from "@/domain/eligibility/matchBenefits";
import { parseUserProfile } from "@/lib/validation/profileSchema";
import type { UserProfile } from "@/types/profile";
import type { Benefit } from "@/types/benefit";

/**
 * Server-only personalized matching endpoint. Takes the caller's profile,
 * loads the full benefit catalog via the provider layer (fully paginated,
 * server-side cached — see MOISBenefitProvider/YouthCenterBenefitProvider),
 * and evaluates eligibility for every benefit using the same rule engine
 * the rest of the app relies on.
 *
 * IMPORTANT: this endpoint intentionally does NOT return the full catalog
 * or any not_eligible Benefit objects to the browser. It only returns the
 * `likelyEligible` and `unknown` subsets plus aggregate `counts` (including
 * `notEligible` as a number only). Sending the entire 10k+ record catalog
 * (and every not_eligible benefit's full record) to every client on every
 * profile edit is both wasteful and leaks data the user never needs to see.
 * If a full-catalog browse/search experience is needed later, it must be
 * built as a separate, server-side paginated/search endpoint — never
 * bolted onto this personalized-matching endpoint.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = parseUserProfile((body as { profile?: unknown })?.profile ?? body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const benefits = await benefitProvider.getBenefits();
    const matches = matchBenefits(benefits, parsed.data as UserProfile);
    const statusById = new Map(matches.map((m) => [m.benefitId, m.status]));

    const likelyEligible: Benefit[] = [];
    const unknown: Benefit[] = [];
    let notEligibleCount = 0;

    for (const benefit of benefits) {
      const status = statusById.get(benefit.id) ?? "unknown";
      if (status === "likely_eligible") likelyEligible.push(benefit);
      else if (status === "unknown") unknown.push(benefit);
      else notEligibleCount += 1;
    }

    return NextResponse.json({
      likelyEligible,
      unknown,
      counts: {
        likelyEligible: likelyEligible.length,
        unknown: unknown.length,
        notEligible: notEligibleCount,
        totalEvaluated: benefits.length,
      },
    });
  } catch (err) {
    console.error("[POST /api/benefits/match] Failed to compute matches:", err);
    return NextResponse.json({ error: "Failed to compute matches" }, { status: 500 });
  }
}
