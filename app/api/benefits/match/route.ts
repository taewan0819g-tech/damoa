import { NextResponse } from "next/server";
import { benefitProvider } from "@/providers";
import { matchBenefits } from "@/domain/eligibility/matchBenefits";
import { parseUserProfile } from "@/lib/validation/profileSchema";
import type { UserProfile } from "@/types/profile";

/**
 * Server-only personalized matching endpoint. Takes the caller's profile,
 * loads the full benefit catalog via the provider layer (fully paginated,
 * server-side cached — see MOISBenefitProvider/YouthCenterBenefitProvider),
 * and evaluates eligibility for every benefit using the same rule engine
 * the rest of the app relies on. This keeps matching logic in one place
 * (no separate copy re-implemented for server vs. client) and means a
 * client never has to fetch the entire catalog just to compute status
 * locally.
 *
 * The response is intentionally NOT capped/truncated: the benefits list
 * page needs to search/filter/sort across the whole catalog (including
 * not_eligible results, which are still shown with a status badge), so
 * trimming the result here would silently make some benefits unsearchable.
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
    return NextResponse.json({ benefits, matches });
  } catch (err) {
    console.error("[POST /api/benefits/match] Failed to compute matches:", err);
    return NextResponse.json({ error: "Failed to compute matches" }, { status: 500 });
  }
}
