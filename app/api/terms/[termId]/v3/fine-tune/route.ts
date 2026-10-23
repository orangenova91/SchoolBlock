import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseCellRef } from "@/lib/timetable-swap";
import { MAX_TIMETABLE_VERSIONS, type TimetableDocument, type TimetableVersionDocument } from "@/lib/types";
import { requireV3Term, serverError } from "@/lib/v3/api";
import {
  applyFineTuneSwap,
  fineTuneMetrics,
  MAX_FINE_TUNE_SWAPS,
  pinnedLessonKeys,
  type FineTuneContext,
  type FineTuneSwap,
} from "@/lib/v3/fine-tune";
import { loadV3Input } from "@/lib/v3/input";

type RouteContext = { params: Promise<{ termId: string }> };

/** 미세 조정 화면이 미리 계산하는 데 쓰는 입력 (서버가 저장 때 쓰는 것과 같다) */
export async function GET(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;
    const input = await loadV3Input(ctx.db, termId);
    const body: FineTuneContext = {
      schedules: input.schedules,
      forbiddenSlots: input.forbiddenSlots,
      pins: input.pins,
      lunchAfterPeriod: input.preferences.lunchAfterPeriod,
      sameDaySubjectBans: input.preferences.sameDaySubjectBans,
    };
    return NextResponse.json(body);
  } catch (error) {
    return serverError("fine-tune GET", error);
  }
}

/**
 * 미세 조정 저장: 시작한 저장본에 맞바꾸기들을 같은 규칙으로 다시 적용해 확인한 뒤,
 * 현재 시간표로 쓰고 새 저장본으로 남긴다 (그래서 "가장 최근 저장본 = 현재 시간표"가 유지된다).
 */
export async function POST(request: Request, context: RouteContext) {
  const { termId } = await context.params;
  try {
    const ctx = await requireV3Term(request, termId);
    if (ctx instanceof NextResponse) return ctx;

    const body = (await request.json().catch(() => null)) as { baseVersionId?: unknown; swaps?: unknown } | null;
    const baseVersionId = typeof body?.baseVersionId === "string" ? body.baseVersionId : "";
    const rawSwaps = Array.isArray(body?.swaps) ? body.swaps : null;
    if (!ObjectId.isValid(baseVersionId) || !rawSwaps) {
      return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
    }
    if (rawSwaps.length === 0) {
      return NextResponse.json({ error: "바꾼 수업이 없습니다." }, { status: 400 });
    }
    if (rawSwaps.length > MAX_FINE_TUNE_SWAPS) {
      return NextResponse.json({ error: `한 번에 ${MAX_FINE_TUNE_SWAPS}번까지 맞바꿀 수 있습니다.` }, { status: 400 });
    }
    const swaps: FineTuneSwap[] = [];
    for (const raw of rawSwaps) {
      const from = parseCellRef((raw as { from?: unknown } | null)?.from);
      const to = parseCellRef((raw as { to?: unknown } | null)?.to);
      if (!from || !to) return NextResponse.json({ error: "바꿀 수업 정보가 올바르지 않습니다." }, { status: 400 });
      swaps.push({ from, to });
    }

    const versions = ctx.db.collection<TimetableVersionDocument>("timetableVersions");
    const base = await versions.findOne({ _id: new ObjectId(baseVersionId), termId });
    if (!base) return NextResponse.json({ error: "시작한 저장본을 찾을 수 없습니다." }, { status: 404 });
    if ((await versions.countDocuments({ termId })) >= MAX_TIMETABLE_VERSIONS) {
      return NextResponse.json(
        { error: `저장한 최종 시간표는 학기당 ${MAX_TIMETABLE_VERSIONS}개까지입니다. 이전 것을 삭제한 뒤 다시 저장해 주세요.` },
        { status: 409 },
      );
    }

    const input = await loadV3Input(ctx.db, termId);
    const pinned = pinnedLessonKeys(input.pins);
    let cells = base.cells;
    for (const [i, swap] of swaps.entries()) {
      const next = applyFineTuneSwap(cells, swap, input, pinned);
      if ("error" in next) {
        return NextResponse.json({ error: `${i + 1}번째 맞바꾸기를 적용할 수 없습니다: ${next.error}` }, { status: 409 });
      }
      cells = next.cells;
    }

    const metrics = fineTuneMetrics(cells, input.preferences);
    const now = new Date();
    const note = `v3 · 미세 조정 · 저장 ${base.versionNumber}에서 ${swaps.length}회`;
    const working: Partial<TimetableDocument> = {
      termId,
      status: "ready",
      cells,
      unplaced: [],
      generatedAt: now,
      updatedAt: now,
      message: note,
      lunchDoubleCount: metrics.lunchDoubles.length,
      lunchDoubles: metrics.lunchDoubles,
      tripleRunCount: metrics.tripleRuns.length,
      tripleRuns: metrics.tripleRuns,
      sameDaySubjectViolationCount: metrics.sameDaySubjectViolations.length,
      sameDaySubjectViolations: metrics.sameDaySubjectViolations,
    };
    await ctx.db.collection<TimetableDocument>("timetables").updateOne({ termId }, { $set: working }, { upsert: true });

    const last = await versions.find({ termId }).sort({ versionNumber: -1 }).limit(1).next();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const inserted = await versions.insertOne({
      termId,
      versionNumber,
      createdAt: now,
      cells,
      lunchDoubleCount: metrics.lunchDoubles.length,
      tripleRunCount: metrics.tripleRuns.length,
      sameDaySubjectViolationCount: metrics.sameDaySubjectViolations.length,
      note,
    });
    return NextResponse.json({ id: String(inserted.insertedId), version: versionNumber, note });
  } catch (error) {
    return serverError("fine-tune POST", error);
  }
}
