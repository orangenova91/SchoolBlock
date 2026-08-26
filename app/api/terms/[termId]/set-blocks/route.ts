import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  countPartialPlaced,
  countPlaced,
  crossSetTeacherConflicts,
  filterAssignmentsToPlacement,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  findGradeSet,
  formatCrossSetTeacherConflict,
  formatSameSetInternalTeacherConflict,
  formatWholePartialSameSlotConflict,
  parsePartialSetBlockCells,
  parseSetBlockCells,
  parseSetTeacherAssignments,
  sameSetInternalTeacherConflicts,
  wholePartialSameSlotConflicts,
} from "@/lib/set-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { getAccountId } from "@/lib/session";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { findOwnedTerm } from "@/lib/term-access";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type SetBlocksDocument,
  type SetTeacherAssignment,
  type SubjectsDocument,
  type TeachersDocument,
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
    const doc = await db
      .collection<SetBlocksDocument>("setBlocks")
      .findOne({ termId });

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      cells: doc?.cells ?? [],
      partialCells: doc?.partialCells ?? [],
      teacherAssignments: doc?.teacherAssignments ?? [],
    });
  } catch (error) {
    console.error("set-blocks GET failed:", error);
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

  const payload = body as {
    cells?: unknown;
    partialCells?: unknown;
    teacherAssignments?: unknown;
  };
  const hasCells = Object.prototype.hasOwnProperty.call(payload, "cells");
  const hasPartial = Object.prototype.hasOwnProperty.call(
    payload,
    "partialCells",
  );
  const hasAssignments = Object.prototype.hasOwnProperty.call(
    payload,
    "teacherAssignments",
  );

  if (!hasCells && !hasPartial && !hasAssignments) {
    return NextResponse.json(
      { error: "cells 또는 partialCells가 필요합니다." },
      { status: 400 },
    );
  }

  const parsedCells = hasCells ? parseSetBlockCells(payload.cells) : null;
  if (hasCells && !parsedCells) {
    return NextResponse.json(
      { error: "SET 블록 데이터가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const parsedPartial = hasPartial
    ? parsePartialSetBlockCells(payload.partialCells)
    : null;
  if (hasPartial && !parsedPartial) {
    return NextResponse.json(
      { error: "부분 SET 블록 데이터가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const parsedAssignments = hasAssignments
    ? parseSetTeacherAssignments(payload.teacherAssignments)
    : null;
  if (hasAssignments && !parsedAssignments) {
    return NextResponse.json(
      { error: "SET 담당 교사 배정 데이터가 올바르지 않습니다." },
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
    const [teachersDoc, subjectsDoc, scheduleDoc, existing] = await Promise.all([
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

    const $set: Record<string, unknown> = {
      termId,
      updatedAt: new Date(),
    };

    let cells = existing?.cells ?? [];
    let partialCells = existing?.partialCells ?? [];

    if (hasCells && parsedCells) {
      cells = filterCellsToCatalog(parsedCells, schedules, catalog);
      for (const cell of cells) {
        const info = findGradeSet(catalog, cell.grade, cell.set);
        if (!info || info.kind !== "whole" || info.units === null) {
          return NextResponse.json(
            { error: "전학년 SET만 저장할 수 있습니다." },
            { status: 400 },
          );
        }
        if (countPlaced(cells, cell.grade, cell.set) > info.units) {
          return NextResponse.json(
            {
              error: `${cell.grade}학년 SET ${cell.set}는 ${info.units}교시를 넘을 수 없습니다.`,
            },
            { status: 400 },
          );
        }
      }
      $set.cells = cells;
    }

    if (hasPartial && parsedPartial) {
      partialCells = filterPartialCellsToCatalog(
        parsedPartial,
        schedules,
        catalog,
      );
      for (const cell of partialCells) {
        const info = findGradeSet(catalog, cell.grade, cell.set);
        if (!info || info.kind !== "partial" || info.units === null) {
          return NextResponse.json(
            { error: "부분 SET만 저장할 수 있습니다." },
            { status: 400 },
          );
        }
        if (countPartialPlaced(partialCells, cell.grade, cell.set) > info.units) {
          return NextResponse.json(
            {
              error: `${cell.grade}학년 SET ${cell.set}는 ${info.units}교시를 넘을 수 없습니다.`,
            },
            { status: 400 },
          );
        }
      }
      $set.partialCells = partialCells;
    }

    let teacherAssignments: SetTeacherAssignment[] =
      hasAssignments && parsedAssignments
        ? parsedAssignments
        : (existing?.teacherAssignments ?? []);

    if (hasCells || hasPartial) {
      const sameSlotConflicts = wholePartialSameSlotConflicts(
        cells,
        partialCells,
      );
      if (sameSlotConflicts.length > 0) {
        return NextResponse.json(
          {
            error: `같은 칸에 전학년 SET와 부분 SET가 함께 배치되어 있습니다: ${formatWholePartialSameSlotConflict(sameSlotConflicts[0])}`,
          },
          { status: 400 },
        );
      }
    }

    // Also re-checked when only teacherAssignments change, since a rotation
    // choice can resolve one ambiguity while creating another.
    if (hasCells || hasPartial || hasAssignments) {
      const crossConflicts = crossSetTeacherConflicts(
        cells,
        partialCells,
        teachers,
        catalog,
        teacherAssignments,
      );
      if (crossConflicts.length > 0) {
        return NextResponse.json(
          {
            error: `전학년 SET와 부분 SET 사이에 교사가 겹칩니다: ${formatCrossSetTeacherConflict(crossConflicts[0])}`,
          },
          { status: 400 },
        );
      }

      const internalConflicts = sameSetInternalTeacherConflicts(
        cells,
        partialCells,
        teachers,
        catalog,
        teacherAssignments,
      );
      if (internalConflicts.length > 0) {
        return NextResponse.json(
          {
            error: `같은 SET 내부에서 교사가 겹칩니다: ${formatSameSetInternalTeacherConflict(internalConflicts[0])}`,
          },
          { status: 400 },
        );
      }
    }

    // Prune assignments that no longer correspond to a placed cell or a
    // still-ambiguous (multi-teacher) subject, so stale rotation choices
    // don't linger after cells or teacher data change.
    teacherAssignments = filterAssignmentsToPlacement(
      teacherAssignments,
      cells,
      partialCells,
      catalog,
      teachers,
    );
    $set.teacherAssignments = teacherAssignments;

    const updatedAt = $set.updatedAt as Date;
    await db.collection<SetBlocksDocument>("setBlocks").updateOne(
      { termId },
      { $set },
      { upsert: true },
    );

    return NextResponse.json({
      termId,
      cells,
      partialCells,
      teacherAssignments,
      updatedAt,
    });
  } catch (error) {
    console.error("set-blocks PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
