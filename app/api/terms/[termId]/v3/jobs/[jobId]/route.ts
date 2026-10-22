import { NextResponse } from "next/server";
import { findTermJob, jobNotFound, jobView, requireV3Term, serverError } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { hideJob, JobStateError, setAutoContinue } from "@/lib/v3/jobs";

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

/** 작업 삭제: 끝난 작업만 목록에서 숨긴다 (적용한 시간표·확정 버전은 그대로) */
export async function DELETE(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job || job.hidden) return jobNotFound();
    await hideJob(ctx.db, job._id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof JobStateError) return NextResponse.json({ error: error.message }, { status: 409 });
    return serverError("job DELETE", error);
  }
}
