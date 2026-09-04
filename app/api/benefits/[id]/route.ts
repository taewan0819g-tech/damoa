import { NextResponse } from "next/server";
import { benefitProvider } from "@/providers";
import { logger } from "@/lib/log/logger";

/** Cheap defensive cap (Phase 5 §18) -- real ids are short (e.g. "mois-XXXXXXXX"); nothing legitimate is anywhere near this long. */
const MAX_ID_LENGTH = 200;

export async function GET(_request: Request, ctx: RouteContext<"/api/benefits/[id]">) {
  const { id } = await ctx.params;
  if (id.length > MAX_ID_LENGTH) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const startedAt = performance.now();
  try {
    const benefit = await benefitProvider.getBenefit(id);
    const durationMs = performance.now() - startedAt;
    if (!benefit) {
      logger.info("request_complete", { route: "benefits/[id]", found: false, durationMs: Math.round(durationMs) });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.info("request_complete", { route: "benefits/[id]", found: true, durationMs: Math.round(durationMs) });
    const res = NextResponse.json({ benefit });
    res.headers.set("Server-Timing", `total;dur=${durationMs.toFixed(1)}`);
    return res;
  } catch (err) {
    // Provider layer already applies its own resilience (cached-catalog
    // fallback, stale-if-error) internally -- reaching here means even the
    // fallback path failed, which is a genuine unexpected error worth a 500.
    logger.error("request_error", {
      route: "benefits/[id]",
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to load benefit" }, { status: 500 });
  }
}
