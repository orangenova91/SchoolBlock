import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  partialSetsPlacementComplete,
  wholeSetsPlacementComplete,
} from "@/lib/set-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { generateTimetable } from "@/lib/timetable";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type SetBlocksDocument,
  type SubjectsDocument,
  type TeacherConstraintsDocument,
  type TeachersDocument,
  type TermDocument,
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

async function findTerm(termId: string) {
  if (!ObjectId.isValid(termId)) return null;
  const db = await getDb();
  return db.collection<TermDocument>("terms").findOne({
    _id: new ObjectId(termId),
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const { termId } = await context.params;

  try {
    const term = await findTerm(termId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const doc = await db
      .collection<TimetableDocument>("timetables")
      .findOne({ termId });

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
      unplaced: doc?.unplaced ?? [],
      generatedAt: doc?.generatedAt ?? null,
      message: doc?.message ?? null,
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

export async function POST(_request: Request, context: RouteContext) {
  const { termId } = await context.params;

  try {
    const term = await findTerm(termId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const [teachersDoc, subjectsDoc, scheduleDoc, setBlocksDoc, constraintsDoc] =
      await Promise.all([
        db.collection<TeachersDocument>("teachers").findOne({ termId }),
        db.collection<SubjectsDocument>("subjects").findOne({ termId }),
        db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
        db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
        db
          .collection<TeacherConstraintsDocument>("teacherConstraints")
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
    const forbiddenSlots = filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    );

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
      forbiddenSlots,
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
