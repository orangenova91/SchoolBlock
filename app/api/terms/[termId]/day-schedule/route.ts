import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { getDb } from "@/lib/mongodb";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  type DayScheduleDocument,
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
    const schedule = await db
      .collection<DayScheduleDocument>("daySchedules")
      .findOne({ termId });

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      grades: schedule?.grades ?? createDefaultGradeDaySchedules(),
      classCounts: schedule?.classCounts ?? createDefaultClassCounts(),
    });
  } catch (error) {
    console.error("day-schedule GET failed:", error);
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

  const payload = body as { grades?: unknown; classCounts?: unknown };

  const grades = parseGradeDaySchedules(payload.grades);
  if (!grades) {
    return NextResponse.json(
      { error: "학년별 요일 차시(0~10 정수)가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const classCounts = parseClassCounts(payload.classCounts);
  if (!classCounts) {
    return NextResponse.json(
      { error: "학년별 학반 수(1~20 정수)가 올바르지 않습니다." },
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
    const updatedAt = new Date();
    await db.collection<DayScheduleDocument>("daySchedules").updateOne(
      { termId },
      {
        $set: {
          termId,
          grades,
          classCounts,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ termId, grades, classCounts, updatedAt });
  } catch (error) {
    console.error("day-schedule PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
