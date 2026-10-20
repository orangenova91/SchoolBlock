import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { findOwnedTerm } from "@/lib/term-access";
import {
  describeMovedFixedLessons,
  parseCellRef,
  parseSlotRef,
  swapSameClassCommonCells,
  swapWholeSlots,
} from "@/lib/timetable-swap";
import {
  listLunchTeacherDoubles,
  listSameDaySubjectViolations,
  listTeacherTripleRuns,
} from "@/lib/timetable";
import {
  createDefaultGradeDaySchedules,
  createDefaultTeachers,
  type DayScheduleDocument,
  type GenerationPreferencesDocument,
  type SubjectBlocksDocument,
  type TeacherConstraintsDocument,
  type TeachersDocument,
  type TimetableDocument,
} from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export async function POST(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  // mode "slot": swap every lesson of one weekday+period column with another.
  // Otherwise: swap two common lessons of the same class.
  const raw = body as Record<string, unknown>;
  const slotMode = raw.mode === "slot";
  const fromCell = slotMode ? null : parseCellRef(raw.from);
  const toCell = slotMode ? null : parseCellRef(raw.to);
  const fromSlot = slotMode ? parseSlotRef(raw.from) : null;
  const toSlot = slotMode ? parseSlotRef(raw.to) : null;
  if (slotMode ? !fromSlot || !toSlot : !fromCell || !toCell) {
    return NextResponse.json(
      {
        error: slotMode
          ? "바꿀 교시 정보가 올바르지 않습니다."
          : "바꿀 수업 정보가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const [
      working,
      scheduleDoc,
      constraintsDoc,
      teachersDoc,
      preferencesDoc,
      subjectBlocksDoc,
    ] = await Promise.all([
      db.collection<TimetableDocument>("timetables").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
      db
        .collection<TeacherConstraintsDocument>("teacherConstraints")
        .findOne({ termId }),
      db.collection<TeachersDocument>("teachers").findOne({ termId }),
      db
        .collection<GenerationPreferencesDocument>("generationPreferences")
        .findOne({ termId }),
      db.collection<SubjectBlocksDocument>("subjectBlocks").findOne({ termId }),
    ]);

    if (!working || !Array.isArray(working.cells) || working.cells.length === 0) {
      return NextResponse.json(
        { error: "작업 중인 전체 배치 결과가 없습니다." },
        { status: 400 },
      );
    }

    const schedules =
      parseGradeDaySchedules(scheduleDoc?.grades) ??
      createDefaultGradeDaySchedules();
    const teachers = sanitizeTeachers(
      ensureTeachers(teachersDoc?.teachers ?? createDefaultTeachers()),
    );
    const forbiddenSlots = filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    );
    const preferences = normalizeGenerationPreferences(preferencesDoc);

    const swapOptions = { forbiddenSlots, schedules };
    const swapped =
      fromSlot && toSlot
        ? swapWholeSlots(working.cells, fromSlot, toSlot, swapOptions)
        : swapSameClassCommonCells(working.cells, fromCell!, toCell!, swapOptions);
    if ("error" in swapped) {
      return NextResponse.json({ error: swapped.error }, { status: 400 });
    }

    const lunchDoubles = listLunchTeacherDoubles(
      swapped.cells,
      preferences.lunchAfterPeriod,
    );
    const tripleRuns = listTeacherTripleRuns(
      swapped.cells,
      preferences.lunchAfterPeriod,
    );
    const sameDaySubjectViolations = listSameDaySubjectViolations(
      swapped.cells,
      preferences.sameDaySubjectBans,
    );
    const now = new Date();

    await db.collection<TimetableDocument>("timetables").updateOne(
      { termId },
      {
        $set: {
          cells: swapped.cells,
          updatedAt: now,
          lunchDoubleCount: lunchDoubles.length,
          lunchDoubles,
          tripleRunCount: tripleRuns.length,
          tripleRuns,
          sameDaySubjectViolationCount: sameDaySubjectViolations.length,
          sameDaySubjectViolations,
        },
      },
    );

    const notice = describeMovedFixedLessons(
      working.cells,
      swapped.cells,
      subjectBlocksDoc?.cells ?? [],
    );

    return NextResponse.json({
      notice,
      cells: swapped.cells,
      lunchDoubleCount: lunchDoubles.length,
      lunchDoubles,
      tripleRunCount: tripleRuns.length,
      tripleRuns,
      sameDaySubjectViolationCount: sameDaySubjectViolations.length,
      sameDaySubjectViolations,
    });
  } catch (error) {
    console.error("timetable swap POST failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
