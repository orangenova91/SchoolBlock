import { NextResponse } from "next/server";
import { jobView, requireV3Term, serverError } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import { createJob, JobLimitError, JOBS, type DiagnoseKind, type V3JobDocument, type V3JobKind } from "@/lib/v3/jobs";
import { quickCheck } from "@/lib/v3/quick-check";

type RouteContext = { params: Promise<{ termId: string }> };

const KINDS: V3JobKind[] = ["search", "milp", "hybrid", "diagnose"];
const DIAGNOSES: DiagnoseKind[] = ["feasibility", "relax", "fixedLoss", "dataLimit"];

/** 이 학기의 최근 작업 목록 */
export async function GET(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const hash = v3InputHash(await loadV3Input(ctx.db, termId));
    const jobs = await ctx.db.collection<V3JobDocument>(JOBS).find({ termId }, { projection: { diagnosis: 0 } }).sort({ createdAt: -1 }).limit(20).toArray();
    return NextResponse.json({ jobs: await Promise.all(jobs.map((j) => jobView(ctx.db, j, hash))) });
  } catch (error) {
    return serverError("jobs GET", error);
  }
}

/**
 * 작업 만들기: { kind: "search"|"milp"|"hybrid"|"diagnose", diagnose?, autoContinue? }
 * 생성 작업은 빠른 검사에서 확정 불가(미배치 확정·입력 모순)가 나오면 만들지 않는다 (미배치가 있으면 시간표를 만들지 않음).
 */
export async function POST(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => null)) as { kind?: string; diagnose?: string; autoContinue?: unknown } | null;
    const kind = body?.kind as V3JobKind;
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "작업 종류가 올바르지 않습니다." }, { status: 400 });
    const diagnose = kind === "diagnose" ? (body?.diagnose as DiagnoseKind) : undefined;
    if (kind === "diagnose" && !DIAGNOSES.includes(diagnose!)) return NextResponse.json({ error: "진단 종류가 올바르지 않습니다." }, { status: 400 });
    const input = await loadV3Input(ctx.db, termId);
    if (kind !== "diagnose") {
      const quick = quickCheck(buildInstance(input));
      if (quick.blocking || quick.minUnplaced > 0) {
        return NextResponse.json(
          { error: "이 조건으로는 모든 수업을 배치할 수 없어 시간표를 만들지 않습니다. 빠른 검사의 오류를 먼저 고쳐 주세요.", quick },
          { status: 409 },
        );
      }
    }
    const inputHash = v3InputHash(input);
    const job = await createJob(ctx.db, { termId, accountId: ctx.accountId, kind, diagnose, inputHash, autoContinue: body?.autoContinue === true });
    return NextResponse.json({ job: await jobView(ctx.db, job, inputHash) }, { status: 201 });
  } catch (error) {
    if (error instanceof JobLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
    return serverError("jobs POST", error);
  }
}
