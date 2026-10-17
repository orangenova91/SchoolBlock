import { NextResponse } from "next/server";
import { listLunchTeacherDoubles, listSameDaySubjectViolations, listTeacherTripleRuns } from "@/lib/timetable";
import { MAX_TIMETABLE_VERSIONS, type TimetableDocument, type TimetableVersionDocument } from "@/lib/types";
import { findTermJob, jobNotFound, requireV3Term, serverError } from "@/lib/v3/api";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import { JOB_RESULTS, knownLowerBound, type V3JobResultDocument } from "@/lib/v3/jobs";
import { judge } from "@/lib/v3/score";
import { validateSolution } from "@/lib/v3/validate";

type RouteContext = { params: Promise<{ termId: string; jobId: string; rank: string }> };

const KIND_LABEL: Record<string, string> = { search: "탐색", milp: "정수계획", hybrid: "혼합" };

/**
 * 결과 적용: 검증기로 다시 확인한 뒤 현재 시간표(timetables)로 쓰고, 확정 버전(timetableVersions)으로 저장한다.
 * 저장 형식은 v1·v2와 같아서 시간표 보기·내보내기를 그대로 쓴다. 메모는 자동 기록한다.
 */
export async function POST(request: Request, context: RouteContext) {
  const { termId, jobId, rank } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const job = await findTermJob(ctx.db, termId, jobId);
    if (!job) return jobNotFound();
    const result = await ctx.db.collection<V3JobResultDocument>(JOB_RESULTS).findOne({ jobId: String(job._id), rank: Number(rank) });
    if (!result) return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });

    const input = await loadV3Input(ctx.db, termId);
    if (v3InputHash(input) !== job.inputHash) {
      return NextResponse.json({ error: "작업 뒤에 입력이 바뀌어 이 결과를 적용할 수 없습니다. 새로 생성해 주세요." }, { status: 409 });
    }
    const inst = buildInstance(input);
    const v = validateSolution(input, inst, result.solution);
    if (!v.ok) {
      return NextResponse.json({ error: "검증에 실패한 결과라 적용하지 않았습니다.", violations: v.violations.slice(0, 10), unplaced: v.unplaced }, { status: 409 });
    }

    const cells = result.solution.cells;
    const now = new Date();
    const lap = input.preferences.lunchAfterPeriod;
    const known = await knownLowerBound(ctx.db, termId, job.inputHash);
    const lower = job.lowerBound === null ? known : known === null ? job.lowerBound : Math.max(job.lowerBound, known);
    const lb = lower === null ? null : Math.max(0, Math.ceil(lower - 1e-6));
    const j = judge(v.metrics, { lower, proven: false });
    const note = `v3 · ${KIND_LABEL[job.kind] ?? job.kind} · ${v.metrics.score}점 (${lb === null ? "최선 미계산" : `최선 ${lb}, ${j.near ? "달성" : "미달"}`})`;
    const working: Partial<TimetableDocument> = {
      termId,
      status: "ready",
      cells,
      unplaced: [],
      generatedAt: now,
      updatedAt: now,
      message: note,
      // 점수는 v3 기준(+α 과목 교사 포함), 목록은 앱 공통 진단 함수 결과
      lunchDoubleCount: v.metrics.lunch,
      lunchDoubles: listLunchTeacherDoubles(cells, lap),
      tripleRunCount: v.metrics.triple,
      tripleRuns: listTeacherTripleRuns(cells, lap),
      sameDaySubjectViolationCount: v.metrics.sameDay,
      sameDaySubjectViolations: listSameDaySubjectViolations(cells, input.preferences.sameDaySubjectBans),
    };
    await ctx.db.collection<TimetableDocument>("timetables").updateOne({ termId }, { $set: working }, { upsert: true });

    const versions = ctx.db.collection<TimetableVersionDocument>("timetableVersions");
    const count = await versions.countDocuments({ termId });
    if (count >= MAX_TIMETABLE_VERSIONS) {
      return NextResponse.json({
        applied: true,
        version: null,
        warning: `현재 시간표로 적용했지만, 확정 버전은 학기당 ${MAX_TIMETABLE_VERSIONS}개까지라 버전으로는 저장하지 않았습니다. 이전 버전을 삭제한 뒤 다시 적용해 주세요.`,
        note,
      });
    }
    const last = await versions.find({ termId }).sort({ versionNumber: -1 }).limit(1).next();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    await versions.insertOne({
      termId,
      versionNumber,
      createdAt: now,
      cells,
      lunchDoubleCount: v.metrics.lunch,
      tripleRunCount: v.metrics.triple,
      sameDaySubjectViolationCount: v.metrics.sameDay,
      note,
    });
    return NextResponse.json({ applied: true, version: versionNumber, note });
  } catch (error) {
    return serverError("result apply", error);
  }
}
