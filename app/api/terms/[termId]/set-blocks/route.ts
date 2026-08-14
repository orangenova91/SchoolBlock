import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  countPlaced,
  filterCellsToCatalog,
  findGradeSet,
  parseSetBlockCells,
} from "@/lib/set-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  type DayScheduleDocument,
  type SetBlocksDocument,
  type SubjectsDocument,
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

  const parsed = parseSetBlockCells((body as { cells?: unknown }).cells);
  if (!parsed) {
    return NextResponse.json(
      { error: "SET 블록 데이터가 올바르지 않습니다." },
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
    const [subjectsDoc, scheduleDoc] = await Promise.all([
      db.collection<SubjectsDocument>("subjects").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
    ]);

    const subjects = sanitizeGradeSubjects(
      ensureGradeSubjects(subjectsDoc?.subjects ?? createDefaultGradeSubjects()),
    );
    const schedules =
      parseGradeDaySchedules(scheduleDoc?.grades) ??
      createDefaultGradeDaySchedules();
    const classCounts =
      parseClassCounts(scheduleDoc?.classCounts) ?? createDefaultClassCounts();
    const catalog = catalogGradeSets(subjects, classCounts);
    const cells = filterCellsToCatalog(parsed, schedules, catalog);

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

    const updatedAt = new Date();
    await db.collection<SetBlocksDocument>("setBlocks").updateOne(
      { termId },
      {
        $set: {
          termId,
          cells,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ termId, cells, updatedAt });
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
