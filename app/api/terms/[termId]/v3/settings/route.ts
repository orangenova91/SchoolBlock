import { NextResponse } from "next/server";
import { requireV3Term, serverError } from "@/lib/v3/api";
import { parseV3Weights, V3_WEIGHT_CHOICES } from "@/lib/v3/input";

type RouteContext = { params: Promise<{ termId: string }> };

/** v3 선호 중요도 (generationPreferences.v3Weights, v2의 v2Weights와 같은 방식) */
export async function GET(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const doc = await ctx.db.collection<{ termId: string; v3Weights?: unknown }>("generationPreferences").findOne({ termId });
    return NextResponse.json({ weights: parseV3Weights(doc?.v3Weights), choices: V3_WEIGHT_CHOICES });
  } catch (error) {
    return serverError("settings GET", error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => null)) as { weights?: Record<string, unknown> } | null;
    const raw = body?.weights ?? {};
    const valid = (v: unknown) => typeof v === "number" && (V3_WEIGHT_CHOICES as readonly number[]).includes(v);
    if (!valid(raw.lunch) || !valid(raw.triple) || !valid(raw.sameDay)) {
      return NextResponse.json({ error: `중요도는 ${V3_WEIGHT_CHOICES.join("·")} 중에서 골라 주세요.` }, { status: 400 });
    }
    const weights = parseV3Weights(raw);
    await ctx.db.collection("generationPreferences").updateOne({ termId }, { $set: { termId, v3Weights: weights, updatedAt: new Date() } }, { upsert: true });
    return NextResponse.json({ weights });
  } catch (error) {
    return serverError("settings PUT", error);
  }
}
