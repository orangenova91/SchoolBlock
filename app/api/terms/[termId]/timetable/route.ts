import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  formatSameSetInternalTeacherConflict,
  partialSetsPlacementComplete,
  sameSetInternalTeacherConflicts,
  wholeSetsPlacementComplete,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { getAccountId } from "@/lib/session";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { findOwnedTerm } from "@/lib/term-access";
import { buildSeedTimetableCells, generateTimetable } from "@/lib/timetable";
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

export async function GET(request: Request, context: RouteContext) {
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
      doc,
      teachersDoc,
      subjectsDoc,
      scheduleDoc,
      setBlocksDoc,
      subjectBlocksDoc,
    ] = await Promise.all([
      db.collection<TimetableDocument>("timetables").findOne({ termId }),
      db.collection<TeachersDocument>("teachers").findOne({ termId }),
      db.collection<SubjectsDocument>("subjects").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
      db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
      db
        .collection<SubjectBlocksDocument>("subjectBlocks")
        .findOne({ termId }),
    ]);

    // Structural check, independent of whether a timetable has been
    // generated yet: a teacher required by two different subjects of the
    // same SET (different home rooms) at the same occurrence is physically
    // impossible. Surfaced here so it's visible as soon as the page loads,
    // even before hitting "시간표 배치".
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
    const internalConflicts = sameSetInternalTeacherConflicts(
      wholeCells,
      partialCells,
      teachers,
      catalog,
      setBlocksDoc?.teacherAssignments ?? [],
    );
    const seedCells = buildSeedTimetableCells({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
      subjectBlocks: subjectBlocksDoc?.cells ?? [],
    });

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      status: doc?.status ?? "idle",
      cells: doc?.cells ?? [],
      seedCells,
      // 선 수업(교과 블록): lets the 전체 교사 view mark fixed lessons.
      subjectBlocks: subjectBlocksDoc?.cells ?? [],
      unplaced: doc?.unplaced ?? [],
      generatedAt: doc?.generatedAt ?? null,
      message: doc?.message ?? null,
      lunchDoubleCount: doc?.lunchDoubleCount ?? 0,
      lunchDoubles: doc?.lunchDoubles ?? [],
      tripleRunCount: doc?.tripleRunCount ?? 0,
      tripleRuns: doc?.tripleRuns ?? [],
      lunchStatus: doc?.lunchStatus ?? "idle",
      lunchMessage: doc?.lunchMessage ?? null,
      lunchGeneratedAt: doc?.lunchGeneratedAt ?? null,
      lunchLockCount: doc?.lunchLockCells?.length ?? 0,
      sameDaySubjectViolationCount: doc?.sameDaySubjectViolationCount ?? 0,
      sameDaySubjectViolations: doc?.sameDaySubjectViolations ?? [],
      sameDaySubjectStatus: doc?.sameDaySubjectStatus ?? "idle",
      sameDaySubjectMessage: doc?.sameDaySubjectMessage ?? null,
      sameDaySubjectGeneratedAt: doc?.sameDaySubjectGeneratedAt ?? null,
      sameDaySubjectLockCount: doc?.sameDaySubjectLockCells?.length ?? 0,
      sameSetTeacherConflictCount: internalConflicts.length,
      sameSetTeacherConflictMessages: internalConflicts.map((c) =>
        formatSameSetInternalTeacherConflict(c),
      ),
    });
  } catch (error) {
    console.error("timetable GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
    // 작업본만 초기화: 배치 결과와 점심시간·동일 교과 우선 배치 잠금을 지운다.
    // 확정 버전(timetableVersions)은 남긴다.
    await db.collection<TimetableDocument>("timetables").deleteOne({ termId });

    return NextResponse.json({ termId, status: "idle" });
  } catch (error) {
    console.error("timetable DELETE failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
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
      existingTimetableDoc,
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
      db.collection<TimetableDocument>("timetables").findOne({ termId }),
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
    // 점심시간 우선 배치·동일 교과 우선 배치(1단계) 결과가 저장되어 있으면
    // 교과 블록과 함께 고정 셀로 취급해, "남은 시간 시간표 배치"가 그 위에서만
    // 나머지를 채우게 한다.
    const subjectBlocks = filterSubjectBlocksToAssignments(
      [
        ...(subjectBlocksDoc?.cells ?? []),
        ...(existingTimetableDoc?.sameDaySubjectLockCells ?? []),
        ...(existingTimetableDoc?.lunchLockCells ?? []),
      ],
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
        { error: "전학년 SET 블록을 모두 배치한 뒤 생성해 주세요." },
        { status: 400 },
      );
    }
    if (!partialSetsPlacementComplete(partialCells, catalog)) {
      return NextResponse.json(
        { error: "부분 SET 블록을 모두 배치한 뒤 생성해 주세요." },
        { status: 400 },
      );
    }

    const result = generateTimetable({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
      subjectBlocks,
      forbiddenSlots,
      preferences,
      timeLimitMs: 15_000,
      restarts: 24,
    });

    const now = new Date();
    const doc: TimetableDocument = {
      termId,
      status: result.status,
      cells: result.cells,
      unplaced: result.unplaced,
      generatedAt: now,
      updatedAt: now,
      message: result.message,
      lunchDoubleCount: result.lunchDoubleCount,
      lunchDoubles: result.lunchDoubles,
      tripleRunCount: result.tripleRunCount,
      tripleRuns: result.tripleRuns,
      sameDaySubjectViolationCount: result.sameDaySubjectViolationCount,
      sameDaySubjectViolations: result.sameDaySubjectViolations,
    };

    await db.collection<TimetableDocument>("timetables").updateOne(
      { termId },
      { $set: doc },
      { upsert: true },
    );

    return NextResponse.json({
      termId,
      status: doc.status,
      cells: doc.cells,
      unplaced: doc.unplaced,
      generatedAt: doc.generatedAt,
      message: doc.message,
      attemptsUsed: result.attemptsUsed,
      lunchLockUsed: (existingTimetableDoc?.lunchLockCells?.length ?? 0) > 0,
      lunchDoubleCount: doc.lunchDoubleCount,
      lunchDoubles: doc.lunchDoubles,
      tripleRunCount: doc.tripleRunCount,
      tripleRuns: doc.tripleRuns,
      sameDaySubjectLockUsed:
        (existingTimetableDoc?.sameDaySubjectLockCells?.length ?? 0) > 0,
      sameDaySubjectViolationCount: doc.sameDaySubjectViolationCount,
      sameDaySubjectViolations: doc.sameDaySubjectViolations,
    });
  } catch (error) {
    console.error("timetable POST generate failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
