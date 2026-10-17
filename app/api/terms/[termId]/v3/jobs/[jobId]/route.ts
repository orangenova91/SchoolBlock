import { NextResponse } from "next/server";
import { findTermJob, jobNotFound, jobView, requireV3Term, serverError } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { setAutoContinue } from "@/lib/v3/jobs";

type RouteContext = { params: Promise<{ termId: string; jobId: string }> };

/** 작업 상태 (화면이 2~3초마다 확인). 시간표 칸은 빼고 가볍게 */
export async function GET(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    const hash = ["awaiting", "stopped", "done"].includes(job.status) ? v3InputHash(await loadV3Input(ctx.db, termId)) : undefined;
    return NextResponse.json({ job: await jobView(ctx.db, job, hash) });
  } catch (error) {
    return serverError("job GET", error);
  }
}

/** 사전 승인 토글: { autoContinue: boolean } */
export async function PATCH(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    const body = (await request.json().catch(() => null)) as { autoContinue?: unknown } | null;
    if (typeof body?.autoContinue !== "boolean") return NextResponse.json({ error: "autoContinue 값이 필요합니다." }, { status: 400 });
    await setAutoContinue(ctx.db, job._id, body.autoContinue);
    const fresh = (await findTermJob(ctx.db, termId, jobId))!;
    return NextResponse.json({ job: await jobView(ctx.db, fresh) });
  } catch (error) {
    return serverError("job PATCH", error);
  }
}
