import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { Semester, TermDocument } from "@/lib/types";

function isSemester(value: unknown): value is Semester {
  return value === 1 || value === 2;
}

function normalizeTimetableName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

export async function GET() {
  try {
    const db = await getDb();
    const terms = await db
      .collection<TermDocument>("terms")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      terms: terms.map((term) => ({
        id: term._id.toString(),
        timetableName: term.timetableName ?? null,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
        createdAt: term.createdAt,
      })),
    });
  } catch (error) {
    console.error("terms GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
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

  const { timetableName, school, academicYear, semester } = body as Record<
    string,
    unknown
  >;

  if (typeof timetableName !== "string" || timetableName.trim().length === 0) {
    return NextResponse.json(
      { error: "시간표명을 입력해 주세요." },
      { status: 400 },
    );
  }

  const normalizedName = normalizeTimetableName(timetableName);
  if (normalizedName.length === 0) {
    return NextResponse.json(
      { error: "시간표명을 입력해 주세요." },
      { status: 400 },
    );
  }

  if (typeof school !== "string" || school.trim().length === 0) {
    return NextResponse.json(
      { error: "학교를 입력해 주세요." },
      { status: 400 },
    );
  }

  const year =
    typeof academicYear === "number"
      ? academicYear
      : typeof academicYear === "string"
        ? Number(academicYear)
        : NaN;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "학년도는 2000~2100 사이의 정수여야 합니다." },
      { status: 400 },
    );
  }

  const semesterValue =
    typeof semester === "string" ? Number(semester) : semester;

  if (!isSemester(semesterValue)) {
    return NextResponse.json(
      { error: "학기는 1 또는 2여야 합니다." },
      { status: 400 },
    );
  }

  const doc: TermDocument = {
    timetableName: normalizedName,
    school: school.trim(),
    academicYear: year,
    semester: semesterValue,
    createdAt: new Date(),
  };

  try {
    const db = await getDb();
    const terms = db.collection<TermDocument>("terms");

    await terms.createIndex(
      { timetableName: 1 },
      { unique: true, sparse: true },
    );

    const existing = await terms.findOne({ timetableName: normalizedName });
    if (existing) {
      return NextResponse.json(
        { error: "이미 사용 중인 시간표명입니다. 다른 이름을 입력해 주세요." },
        { status: 409 },
      );
    }

    const result = await terms.insertOne(doc);

    return NextResponse.json(
      { id: result.insertedId.toString(), ...doc },
      { status: 201 },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return NextResponse.json(
        { error: "이미 사용 중인 시간표명입니다. 다른 이름을 입력해 주세요." },
        { status: 409 },
      );
    }

    console.error("MongoDB insert failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
