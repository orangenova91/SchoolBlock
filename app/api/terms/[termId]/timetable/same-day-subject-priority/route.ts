import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  partialSetsPlacementComplete,
  wholeSetsPlacementComplete,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { getAccountId } from "@/lib/session";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { findOwnedTerm } from "@/lib/term-access";
import { solveSameDaySubjectPriority } from "@/lib/timetable";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type GenerationPreferencesDocument,
  type SetBlocksDocument,
  type SubjectBlocksDocument,
  type SubjectsDocument,
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
      teachersDoc,
      subjectsDoc,
      scheduleDoc,
      setBlocksDoc,
      subjectBlocksDoc,
      constraintsDoc,
      preferencesDoc,
    ] = await Promise.all([
      db.collection<TeachersDocument>("teachers").findOne({ termId }),
      db.collection<SubjectsDocument>("subjects").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
      db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
      db
        .collection<SubjectBlocksDocument>("subjectBlocks")
        .findOne({ termId }),
      db
        .collection<TeacherConstraintsDocument>("teacherConstraints")
        .findOne({ termId }),
      db
        .collection<GenerationPreferencesDocument>("generationPreferences")
        .findOne({ termId }),
    ]);

    const teachers = sanitizeTeachers(
      ensureTeachers(teachersDoc?.teachers ?? createDefaultTeachers()),
    );
    const subjects = sanitizeGradeSubjects(
      ensureGradeSubjects(subjectsDoc?.subjects ?? createDefaultGradeSubjects()),
    );
    const schedules =
      parseGradeDaySchedules(scheduleDoc?.grades) ??
      createDefaultGradeDaySchedules();
    const classCounts =
      parseClassCounts(scheduleDoc?.classCounts) ?? createDefaultClassCounts();
    const catalog = catalogGradeSets(subjects, classCounts);

    const wholeCells = filterCellsToCatalog(
      setBlocksDoc?.cells ?? [],
      schedules,
      catalog,
    );
    const partialCells = filterPartialCellsToCatalog(
      setBlocksDoc?.partialCells ?? [],
      schedules,
      catalog,
    );
    const subjectBlocks = filterSubjectBlocksToAssignments(
      subjectBlocksDoc?.cells ?? [],
      teachers,
      subjects,
      classCounts,
      schedules,
    );
    const forbiddenSlots = filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    );
    const preferences = normalizeGenerationPreferences(preferencesDoc);

    if (!wholeSetsPlacementComplete(wholeCells, catalog)) {
      return NextResponse.json(
        { error: "전학년 SET 블록을 모두 배치한 뒤 배치해 주세요." },
        { status: 400 },
      );
    }
    if (!partialSetsPlacementComplete(partialCells, catalog)) {
      return NextResponse.json(
        { error: "부분 SET 블록을 모두 배치한 뒤 배치해 주세요." },
        { status: 400 },
      );
    }

    const result = solveSameDaySubjectPriority({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
      subjectBlocks,
      forbiddenSlots,
      sameDaySubjectBans: preferences.sameDaySubjectBans,
      avoidLunchDouble: preferences.avoidLunchDouble,
      lunchAfterPeriod: preferences.lunchAfterPeriod,
      timeLimitMs: 15_000,
      restarts: 25,
    });

    const now = new Date();
    await db.collection<TimetableDocument>("timetables").updateOne(
      { termId },
      {
        $set: {
          termId,
          sameDaySubjectLockCells: result.lockCells,
          sameDaySubjectStatus: result.status,
          sameDaySubjectMessage: result.message,
          sameDaySubjectGeneratedAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      termId,
      sameDaySubjectStatus: result.status,
      sameDaySubjectMessage: result.message,
      targetCount: result.targetCount,
      filledCount: result.filledCount,
      violationCount: result.violationCount,
      cells: result.cells,
    });
  } catch (error) {
    console.error("timetable same-day-subject-priority POST failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
