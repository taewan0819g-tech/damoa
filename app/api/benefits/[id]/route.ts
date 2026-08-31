import { NextResponse } from "next/server";
import { benefitProvider } from "@/providers";

export async function GET(_request: Request, ctx: RouteContext<"/api/benefits/[id]">) {
  const { id } = await ctx.params;
  try {
    const benefit = await benefitProvider.getBenefit(id);
    if (!benefit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ benefit });
  } catch (err) {
    console.error(`[GET /api/benefits/${id}] Failed to load benefit:`, err);
    return NextResponse.json({ error: "Failed to load benefit" }, { status: 500 });
  }
}
