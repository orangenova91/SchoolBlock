import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  ensureTeachers,
  hasAnyAssignment,
  hasValidAssignmentHours,
  parseTeachers,
  sanitizeTeachers,
} from "@/lib/teachers";
import {
  MIN_ASSIGNMENT_HOURS,
  MAX_ASSIGNMENT_HOURS,
  createDefaultTeachers,
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
    const doc = await db
      .collection<TeachersDocument>("teachers")
      .findOne({ termId });

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      teachers: sanitizeTeachers(
        ensureTeachers(doc?.teachers ?? createDefaultTeachers()),
      ),
    });
  } catch (error) {
    console.error("teachers GET failed:", error);
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

  const parsed = parseTeachers((body as { teachers?: unknown }).teachers);
  if (!parsed) {
    return NextResponse.json(
      { error: "교사 명단이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const teachers = sanitizeTeachers(parsed);
  if (teachers.length === 0) {
    return NextResponse.json(
      { error: "교사명을 한 명 이상 입력해 주세요." },
      { status: 400 },
    );
  }

  const missingAssignment = teachers.find((t) => !hasAnyAssignment(t));
  if (missingAssignment) {
    return NextResponse.json(
      {
        error: `"${missingAssignment.name}" 교사에게 담당 교과를 한 과목 이상 지정해 주세요.`,
      },
      { status: 400 },
    );
  }

  const badHours = teachers.find((t) => !hasValidAssignmentHours(t));
  if (badHours) {
    return NextResponse.json(
      {
        error: `"${badHours.name}" 교사의 교과 시수를 ${MIN_ASSIGNMENT_HOURS}~${MAX_ASSIGNMENT_HOURS} 사이로 입력해 주세요.`,
      },
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
    await db.collection<TeachersDocument>("teachers").updateOne(
      { termId },
      {
        $set: {
          termId,
          teachers,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ termId, teachers, updatedAt });
  } catch (error) {
    console.error("teachers PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
