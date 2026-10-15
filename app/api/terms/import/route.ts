import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getSessionFromRequest } from "@/lib/session";
import {
  findAvailableTimetableName,
  insertTermBundle,
  type TermBundle,
} from "@/lib/term-bundle";
import { parseLogicVersion, type Semester } from "@/lib/types";

function isSemester(value: unknown): value is Semester {
  return value === 1 || value === 2;
}

function normalizeTimetableName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 다운로드 파일(TermBundle)의 최소 구조만 검증한다 — 필드별 세부 검증은 각 화면에서 이미 하고 있다. */
function pickBundleFields(
  raw: Record<string, unknown>,
): Pick<
  TermBundle,
  | "teachers"
  | "subjects"
  | "daySchedule"
  | "preferences"
  | "setBlocks"
  | "subjectBlocks"
  | "teacherConstraints"
> {
  return {
    teachers: Array.isArray(raw.teachers)
      ? (raw.teachers as TermBundle["teachers"])
      : undefined,
    subjects: isPlainObject(raw.subjects)
      ? (raw.subjects as TermBundle["subjects"])
      : undefined,
    daySchedule: isPlainObject(raw.daySchedule)
      ? (raw.daySchedule as TermBundle["daySchedule"])
      : undefined,
    preferences: isPlainObject(raw.preferences)
      ? (raw.preferences as TermBundle["preferences"])
      : undefined,
    setBlocks: isPlainObject(raw.setBlocks)
      ? (raw.setBlocks as TermBundle["setBlocks"])
      : undefined,
    subjectBlocks: isPlainObject(raw.subjectBlocks)
      ? (raw.subjectBlocks as TermBundle["subjectBlocks"])
      : undefined,
    teacherConstraints: isPlainObject(raw.teacherConstraints)
      ? (raw.teacherConstraints as TermBundle["teacherConstraints"])
      : undefined,
  };
}

/**
 * 다운로드된 학기(term) 번들 JSON을 업로드해 새 학기를 만든다.
 * ownerId/school은 업로드된 값을 신뢰하지 않고 세션 값으로 고정한다.
 * 시간표명이 겹치면 자동으로 "(2)", "(3)" ... 접미사를 붙인다.
 */
export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "파일 내용을 읽을 수 없습니다. 올바른 JSON 파일인지 확인해 주세요." },
      { status: 400 },
    );
  }

  if (!isPlainObject(body)) {
    return NextResponse.json(
      { error: "파일 내용이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  if (
    typeof body.timetableName !== "string" ||
    normalizeTimetableName(body.timetableName).length === 0
  ) {
    return NextResponse.json(
      { error: "파일에 시간표명이 없습니다." },
      { status: 400 },
    );
  }

  const academicYear =
    typeof body.academicYear === "number"
      ? body.academicYear
      : Number(body.academicYear);

  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) {
    return NextResponse.json(
      { error: "파일의 학년도 값이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  if (!isSemester(body.semester)) {
    return NextResponse.json(
      { error: "파일의 학기 값이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const baseName = normalizeTimetableName(body.timetableName);

    const timetableName = await findAvailableTimetableName(
      db,
      session.accountId,
      (attempt) => (attempt === 0 ? baseName : `${baseName} (${attempt + 1})`),
    );

    const created = await insertTermBundle(db, pickBundleFields(body), {
      ownerId: session.accountId,
      school: session.username,
      timetableName,
      academicYear,
      semester: body.semester,
      logicVersion: parseLogicVersion(body.logicVersion),
    });

    return NextResponse.json(
      {
        id: created._id.toString(),
        timetableName: created.timetableName,
        school: created.school,
        academicYear: created.academicYear,
        semester: created.semester,
        createdAt: created.createdAt,
        logicVersion: created.logicVersion ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("term import failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
