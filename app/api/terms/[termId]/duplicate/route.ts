import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import {
  collectTermBundle,
  findAvailableTimetableName,
  insertTermBundle,
} from "@/lib/term-bundle";
import type { TermDocument } from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

/**
 * 학기(term)의 설정값만 복제해 새 학기를 만든다.
 * 복제 대상: 교과/교사/학반·요일/학반 세트/교과 블록/교사 제약조건/생성 선호도.
 * 생성된 시간표 결과(timetables 컬렉션)는 복제하지 않는다 — 새 학기는 새로 생성하는 게 자연스럽기 때문.
 */
export async function POST(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { termId } = await context.params;

  if (!ObjectId.isValid(termId)) return invalidTermIdResponse();

  try {
    const db = await getDb();
    const terms = db.collection<TermDocument>("terms");
    const sourceTerm = await terms.findOne({
      _id: new ObjectId(termId),
      ownerId: accountId,
    });

    if (!sourceTerm) {
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const bundle = await collectTermBundle(
      db,
      sourceTerm as TermDocument & { _id: ObjectId },
    );

    const baseName = sourceTerm.timetableName || "(이름 없음)";
    const timetableName = await findAvailableTimetableName(
      db,
      accountId,
      (attempt) =>
        attempt === 0 ? `${baseName} (복사본)` : `${baseName} (복사본 ${attempt + 1})`,
    );

    const created = await insertTermBundle(db, bundle, {
      ownerId: accountId,
      school: sourceTerm.school,
      timetableName,
      academicYear: sourceTerm.academicYear,
      semester: sourceTerm.semester,
    });

    return NextResponse.json(
      {
        id: created._id.toString(),
        timetableName: created.timetableName,
        school: created.school,
        academicYear: created.academicYear,
        semester: created.semester,
        createdAt: created.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("term duplicate failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
