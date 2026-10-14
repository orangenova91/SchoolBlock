import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import {
  MAX_TIMETABLE_VERSIONS,
  type TimetableDocument,
  type TimetableUnplaced,
  type TimetableVersionDocument,
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

function unplacedCount(items: TimetableUnplaced[] | undefined): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + (item.remaining ?? 0), 0);
}

function toSummary(doc: TimetableVersionDocument & { _id: ObjectId }) {
  return {
    id: doc._id.toString(),
    versionNumber: doc.versionNumber,
    createdAt: doc.createdAt,
    lunchDoubleCount: doc.lunchDoubleCount,
    tripleRunCount: doc.tripleRunCount,
    sameDaySubjectViolationCount: doc.sameDaySubjectViolationCount,
  };
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
    const docs = await db
      .collection<TimetableVersionDocument>("timetableVersions")
      .find({ termId })
      .project<TimetableVersionDocument & { _id: ObjectId }>({ cells: 0 })
      .sort({ versionNumber: -1 })
      .toArray();

    return NextResponse.json({
      versions: docs.map(toSummary),
    });
  } catch (error) {
    console.error("timetable versions GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
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
    const versions = db.collection<TimetableVersionDocument>(
      "timetableVersions",
    );
    const working = await db
      .collection<TimetableDocument>("timetables")
      .findOne({ termId });

    if (
      !working ||
      working.status !== "ready" ||
      !Array.isArray(working.cells) ||
      working.cells.length === 0 ||
      unplacedCount(working.unplaced) > 0
    ) {
      return NextResponse.json(
        { error: "완성된 전체 배치 결과만 확정할 수 있습니다." },
        { status: 400 },
      );
    }

    // 전체 배치 이후에 우선 배치 잠금이 다시 만들어졌다면, 작업본은 예전
    // 잠금 기준이라 현재 상태와 맞지 않는다.
    const generatedAt = working.generatedAt?.getTime() ?? 0;
    const lockedAt = Math.max(
      working.lunchGeneratedAt?.getTime() ?? 0,
      working.sameDaySubjectGeneratedAt?.getTime() ?? 0,
    );
    if (lockedAt > generatedAt) {
      return NextResponse.json(
        {
          error:
            "우선 배치를 다시 실행한 뒤 시간표를 배치하지 않았습니다. 시간표 배치를 다시 실행한 뒤 확정해 주세요.",
        },
        { status: 400 },
      );
    }

    const count = await versions.countDocuments({ termId });
    if (count >= MAX_TIMETABLE_VERSIONS) {
      return NextResponse.json(
        {
          error: `확정 버전은 학기당 ${MAX_TIMETABLE_VERSIONS}개까지입니다. 이전 버전을 삭제한 뒤 다시 시도해 주세요.`,
        },
        { status: 400 },
      );
    }

    const last = await versions
      .find({ termId })
      .sort({ versionNumber: -1 })
      .limit(1)
      .next();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const createdAt = new Date();
    const doc: TimetableVersionDocument = {
      termId,
      versionNumber,
      createdAt,
      cells: working.cells,
      lunchDoubleCount: working.lunchDoubleCount ?? 0,
      tripleRunCount: working.tripleRunCount ?? 0,
      sameDaySubjectViolationCount: working.sameDaySubjectViolationCount ?? 0,
    };

    const inserted = await versions.insertOne(doc);

    return NextResponse.json({
      version: {
        id: inserted.insertedId.toString(),
        versionNumber,
        createdAt,
        lunchDoubleCount: doc.lunchDoubleCount,
        tripleRunCount: doc.tripleRunCount,
        sameDaySubjectViolationCount: doc.sameDaySubjectViolationCount,
      },
    });
  } catch (error) {
    console.error("timetable versions POST failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
