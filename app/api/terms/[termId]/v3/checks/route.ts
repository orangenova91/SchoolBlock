import { NextResponse } from "next/server";
import { requireV3Term, serverError, jobView } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import { JOBS, type V3JobDocument } from "@/lib/v3/jobs";
import { quickCheck } from "@/lib/v3/quick-check";

type RouteContext = { params: Promise<{ termId: string }> };

/**
 * v3 빠른 검사 (밀리초). 입력 화면·생성 화면에서 바로 경고를 보여 준다.
 * 같은 입력으로 끝난 진단이 있으면 함께 돌려준다 (다시 계산하지 않음).
 */
export async function GET(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const input = await loadV3Input(ctx.db, termId);
    const inputHash = v3InputHash(input);
    const inst = buildInstance(input);
    const quick = quickCheck(inst);
    const diagnoses = await ctx.db
      .collection<V3JobDocument>(JOBS)
      .find({ termId, kind: "diagnose", status: "done", inputHash })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray();
    const latest = new Map<string, V3JobDocument>();
    for (const d of diagnoses) if (d.diagnose && !latest.has(d.diagnose)) latest.set(d.diagnose, d);
    return NextResponse.json({
      inputHash,
      quick,
      sets: inst.sets.map((s) => ({ grade: s.grade, set: s.set, kind: s.kind, units: s.units, fixed: s.fixed.length })),
      weights: inst.weights,
      diagnoses: Object.fromEntries(await Promise.all([...latest].map(async ([k, d]) => [k, await jobView(ctx.db, d, inputHash)]))),
    });
  } catch (error) {
    return serverError("checks", error);
  }
}
