import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId, getSessionFromRequest } from "@/lib/session";
import { FLOW_CHAPTER } from "@/lib/term-flow-lock";
import type { Semester, TermDocument, TimetableDocument } from "@/lib/types";

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

export async function GET(request: Request) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const db = await getDb();
    const terms = await db
      .collection<TermDocument>("terms")
      .find({ ownerId: accountId })
      .sort({ createdAt: -1 })
      .toArray();

    // 단계 기록이 없는 예전 학기는 시간표가 있으면 시간표 생성 단계까지 간 것으로 본다 (학기 화면 layout과 같은 규칙)
    const legacyIds = terms
      .filter(
        (term) =>
          typeof term.maxReachedChapter !== "number" &&
          typeof term.reachedTimetable !== "boolean",
      )
      .map((term) => term._id.toString());
    const withTimetable = new Set(
      legacyIds.length > 0
        ? (
            await db
              .collection<TimetableDocument>("timetables")
              .find({ termId: { $in: legacyIds } }, { projection: { termId: 1 } })
              .toArray()
          ).map((doc) => doc.termId)
        : [],
    );
    const reachedChapter = (term: (typeof terms)[number]): number => {
      if (
        typeof term.maxReachedChapter === "number" &&
        Number.isInteger(term.maxReachedChapter)
      ) {
        return term.maxReachedChapter;
      }
      if (typeof term.reachedTimetable === "boolean") {
        return term.reachedTimetable ? FLOW_CHAPTER.timetable : 0;
      }
      return withTimetable.has(term._id.toString()) ? FLOW_CHAPTER.timetable : 0;
    };

    return NextResponse.json({
      terms: terms.map((term) => ({
        id: term._id.toString(),
        timetableName: term.timetableName ?? null,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
        createdAt: term.createdAt,
        logicVersion: term.logicVersion ?? null,
        maxReachedChapter: reachedChapter(term),
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
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const accountId = session.accountId;
  // 학교명은 계정 아이디로 고정한다 — 클라이언트가 보낸 값은 신뢰하지 않는다.
  const school = session.username;

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

  const { timetableName, academicYear, semester } =
    body as Record<string, unknown>;

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

  const doc: TermDocument = {
    timetableName: normalizedName,
    school,
    academicYear: year,
    semester: semesterValue,
    ownerId: accountId,
    createdAt: new Date(),
    // 새 시간표는 v3만 만든다 (요청의 logicVersion은 보지 않는다). 예전 v1·v2 시간표는 그대로 열 수 있다.
    logicVersion: "v3",
  };

  try {
    const db = await getDb();
    const terms = db.collection<TermDocument>("terms");

    await terms.createIndex(
      { ownerId: 1, timetableName: 1 },
      { unique: true, sparse: true },
    );

    const existing = await terms.findOne({
      ownerId: accountId,
      timetableName: normalizedName,
    });
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
