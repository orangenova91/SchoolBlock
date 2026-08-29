import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId, getSessionFromRequest } from "@/lib/session";
import type { Semester, TermDocument } from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

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

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorizedResponse();
  const accountId = session.accountId;
  // 학교명은 계정 아이디로 고정한다 — 클라이언트가 보낸 값은 신뢰하지 않는다.
  const school = session.username;

  const { termId } = await context.params;

  if (!ObjectId.isValid(termId)) {
    return invalidTermIdResponse();
  }

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

  const { timetableName, academicYear, semester } = body as Record<
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

  try {
    const db = await getDb();
    const terms = db.collection<TermDocument>("terms");
    const objectId = new ObjectId(termId);

    const current = await terms.findOne({ _id: objectId, ownerId: accountId });
    if (!current) {
      return NextResponse.json(
        { error: "시간표를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const duplicate = await terms.findOne({
      ownerId: accountId,
      timetableName: normalizedName,
      _id: { $ne: objectId },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "이미 사용 중인 시간표명입니다. 다른 이름을 입력해 주세요." },
        { status: 409 },
      );
    }

    const updatedAt = new Date();
    await terms.updateOne(
      { _id: objectId, ownerId: accountId },
      {
        $set: {
          timetableName: normalizedName,
          school,
          academicYear: year,
          semester: semesterValue,
          updatedAt,
        },
      },
    );

    return NextResponse.json({
      id: termId,
      timetableName: normalizedName,
      school,
      academicYear: year,
      semester: semesterValue,
      createdAt: current.createdAt,
      updatedAt,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return NextResponse.json(
        { error: "이미 사용 중인 시간표명입니다. 다른 이름을 입력해 주세요." },
        { status: 409 },
      );
    }

    console.error("terms PATCH failed:", error);
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

  if (!ObjectId.isValid(termId)) {
    return invalidTermIdResponse();
  }

  try {
    const db = await getDb();
    const objectId = new ObjectId(termId);
    const terms = db.collection<TermDocument>("terms");

    const current = await terms.findOne({ _id: objectId, ownerId: accountId });
    if (!current) {
      return NextResponse.json(
        { error: "시간표를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    await Promise.all([
      terms.deleteOne({ _id: objectId }),
      db.collection("daySchedules").deleteMany({ termId }),
      db.collection("subjects").deleteMany({ termId }),
      db.collection("teachers").deleteMany({ termId }),
      db.collection("generationPreferences").deleteMany({ termId }),
      db.collection("setBlocks").deleteMany({ termId }),
      db.collection("subjectBlocks").deleteMany({ termId }),
      db.collection("teacherConstraints").deleteMany({ termId }),
      db.collection("timetables").deleteMany({ termId }),
      db.collection("timetableVersions").deleteMany({ termId }),
    ]);

    return NextResponse.json({ id: termId, deleted: true });
  } catch (error) {
    console.error("terms DELETE failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
