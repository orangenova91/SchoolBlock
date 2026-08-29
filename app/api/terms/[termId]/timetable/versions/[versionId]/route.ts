import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import type { TimetableVersionDocument } from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string; versionId: string }>;
};

function invalidIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 ID입니다." },
    { status: 400 },
  );
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export async function GET(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId, versionId } = await context.params;
  if (!ObjectId.isValid(versionId)) return invalidIdResponse();

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const doc = await db
      .collection<TimetableVersionDocument>("timetableVersions")
      .findOne({ _id: new ObjectId(versionId), termId });

    if (!doc) {
      return NextResponse.json(
        { error: "확정 버전을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      version: {
        id: versionId,
        versionNumber: doc.versionNumber,
        createdAt: doc.createdAt,
        cells: doc.cells,
        lunchDoubleCount: doc.lunchDoubleCount,
        tripleRunCount: doc.tripleRunCount,
        sameDaySubjectViolationCount: doc.sameDaySubjectViolationCount,
      },
    });
  } catch (error) {
    console.error("timetable version GET failed:", error);
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

  const { termId, versionId } = await context.params;
  if (!ObjectId.isValid(versionId)) return invalidIdResponse();

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const result = await db
      .collection<TimetableVersionDocument>("timetableVersions")
      .deleteOne({ _id: new ObjectId(versionId), termId });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: "확정 버전을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    return NextResponse.json({ id: versionId, deleted: true });
  } catch (error) {
    console.error("timetable version DELETE failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
