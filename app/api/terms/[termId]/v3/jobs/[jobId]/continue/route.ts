import { NextResponse } from "next/server";
import { findTermJob, jobNotFound, jobView, requireV3Term, serverError } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { approveContinue, JobStateError } from "@/lib/v3/jobs";

type RouteContext = { params: Promise<{ termId: string; jobId: string }> };

/** 이어 돌리기 승인 (5분). 입력이 그대로이고 중단점이 있을 때만 */
export async function POST(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    const hash = v3InputHash(await loadV3Input(ctx.db, termId));
    const fresh = await approveContinue(ctx.db, job._id, hash);
    return NextResponse.json({ job: await jobView(ctx.db, fresh, hash) });
  } catch (error) {
    if (error instanceof JobStateError) return NextResponse.json({ error: error.message }, { status: 409 });
    return serverError("job continue", error);
  }
}
