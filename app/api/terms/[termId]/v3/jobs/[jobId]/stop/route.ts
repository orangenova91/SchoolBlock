import { NextResponse } from "next/server";
import { findTermJob, jobNotFound, jobView, requireV3Term, serverError } from "@/lib/v3/api";
import { requestStop } from "@/lib/v3/jobs";

type RouteContext = { params: Promise<{ termId: string; jobId: string }> };

/** 중지: 대기·승인 대기면 바로 중지, 실행 중이면 중지 요청 (작업자가 그 시점 결과를 저장하고 멈춤) */
export async function POST(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    await requestStop(ctx.db, job._id);
    const fresh = (await findTermJob(ctx.db, termId, jobId))!;
    return NextResponse.json({ job: await jobView(ctx.db, fresh) });
  } catch (error) {
    return serverError("job stop", error);
  }
}
