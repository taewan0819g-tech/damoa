import { NextResponse } from "next/server";
import { benefitProvider } from "@/providers";

/**
 * Server-only boundary for the benefit catalog. `providers/index.ts` reads
 * MOIS_API_KEY / YOUTH_POLICY_API_KEY from process.env and calls the real
 * government/youth APIs here — this Route Handler always runs on the
 * server, so those keys and the outbound requests they authorize never
 * reach the browser. Client components fetch this route instead of calling
 * `benefitProvider` directly.
 */
export async function GET() {
  try {
    const benefits = await benefitProvider.getBenefits();
    return NextResponse.json({ benefits });
  } catch (err) {
    console.error("[GET /api/benefits] Failed to load benefits:", err);
    return NextResponse.json({ error: "Failed to load benefits" }, { status: 500 });
  }
}
