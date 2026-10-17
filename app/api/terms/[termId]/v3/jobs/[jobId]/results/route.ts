import { NextResponse } from "next/server";
import { findTermJob, jobNotFound, requireV3Term, serverError } from "@/lib/v3/api";
import { JOB_RESULTS, type V3JobResultDocument } from "@/lib/v3/jobs";
import { cellSignature, diffCells } from "@/lib/v3/results";
import { judge } from "@/lib/v3/score";

type RouteContext = { params: Promise<{ termId: string; jobId: string }> };

/** 작업의 결과 3개 (시간표 칸 포함). 1위와 다른 칸 수, 목표 판정을 함께 준다 */
export async function GET(request: Request, context: RouteContext) {
  const { termId, jobId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    const docs = await ctx.db.collection<V3JobResultDocument>(JOB_RESULTS).find({ jobId: String(job._id) }).sort({ rank: 1 }).toArray();
    const top = docs[0] ? cellSignature(docs[0].solution.cells) : null;
    return NextResponse.json({
      results: docs.map((d) => ({
        rank: d.rank,
        metrics: d.metrics,
        foundAtMs: d.foundAtMs,
        judgement: judge(d.metrics, { lower: job.lowerBound, proven: false }),
        diffFromTop: top ? diffCells(top, cellSignature(d.solution.cells)) : 0,
        cells: d.solution.cells,
        occurrences: d.solution.occurrences,
      })),
    });
  } catch (error) {
    return serverError("results GET", error);
  }
}
