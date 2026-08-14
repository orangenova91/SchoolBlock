import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
} from "@/lib/set-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import {
  filterForbiddenSlots,
  findForbiddenSetConflicts,
  formatForbiddenConflict,
  parseTeacherForbiddenSlots,
} from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
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
    const [constraintsDoc, teachersDoc, subjectsDoc, scheduleDoc, setBlocksDoc] =
      await Promise.all([
        db
          .collection<TeacherConstraintsDocument>("teacherConstraints")
          .findOne({ termId }),
        db.collection<TeachersDocument>("teachers").findOne({ termId }),
        db.collection<SubjectsDocument>("subjects").findOne({ termId }),
        db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
        db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
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

    const forbiddenSlots = filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    );

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

    const conflicts = findForbiddenSetConflicts(
      forbiddenSlots,
      wholeCells,
      partialCells,
      teachers,
      subjects,
      classCounts,
    );

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      forbiddenSlots,
      conflicts: conflicts.map(formatForbiddenConflict),
      conflictCount: conflicts.length,
    });
  } catch (error) {
    console.error("teacher-constraints GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
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

  const parsed = parseTeacherForbiddenSlots(
    (body as { forbiddenSlots?: unknown }).forbiddenSlots,
  );
  if (!parsed) {
    return NextResponse.json(
      { error: "배정 불가 교시 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

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
    const [teachersDoc, subjectsDoc, scheduleDoc, setBlocksDoc] =
      await Promise.all([
        db.collection<TeachersDocument>("teachers").findOne({ termId }),
        db.collection<SubjectsDocument>("subjects").findOne({ termId }),
        db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
        db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
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

    const forbiddenSlots = filterForbiddenSlots(parsed, teachers, schedules);
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
    const conflicts = findForbiddenSetConflicts(
      forbiddenSlots,
      wholeCells,
      partialCells,
      teachers,
      subjects,
      classCounts,
    );

    const now = new Date();
    const doc: TeacherConstraintsDocument = {
      termId,
      forbiddenSlots,
      updatedAt: now,
    };

    await db
      .collection<TeacherConstraintsDocument>("teacherConstraints")
      .updateOne({ termId }, { $set: doc }, { upsert: true });

    return NextResponse.json({
      termId,
      forbiddenSlots,
      conflicts: conflicts.map(formatForbiddenConflict),
      conflictCount: conflicts.length,
      updatedAt: now,
    });
  } catch (error) {
    console.error("teacher-constraints PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
