import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { collectTermBundle } from "@/lib/term-bundle";
import type { TermDocument } from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

/** 학기(term)의 설정값을 JSON 파일로 다운로드한다. 시간표 생성 결과는 제외된다. */
export async function GET(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { termId } = await context.params;

  if (!ObjectId.isValid(termId)) {
    return NextResponse.json(
      { error: "올바르지 않은 학기 ID입니다." },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const term = await db
      .collection<TermDocument>("terms")
      .findOne({ _id: new ObjectId(termId), ownerId: accountId });

    if (!term) {
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const bundle = await collectTermBundle(
      db,
      term as TermDocument & { _id: ObjectId },
    );
    const json = JSON.stringify(bundle, null, 2);
    const fileName = `${(term.timetableName || "timetable").replace(/[\\/:*?"<>|]/g, "_")}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="timetable.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error("term export failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
