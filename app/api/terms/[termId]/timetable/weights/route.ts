import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import type { GenerationPreferencesDocument } from "@/lib/types";
import { parseV2Weights } from "@/lib/v2-weights";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

/** v2 전용: 선호 조건 가중치를 저장한다 (추가 조건 문서의 v2Weights 필드). */
export async function PUT(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

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
  const weights = parseV2Weights(body);
  if (!weights) {
    return NextResponse.json(
      { error: "가중치는 1, 2, 3, 5, 10 중에서 골라 주세요." },
      { status: 400 },
    );
  }

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) {
        return NextResponse.json(
          { error: "올바르지 않은 학기 ID입니다." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    if (term.logicVersion !== "v2") {
      return NextResponse.json(
        { error: "가중치 설정은 v2 시간표에서만 사용할 수 있습니다." },
        { status: 400 },
      );
    }

    const db = await getDb();
    // v2Weights 필드만 바꾼다. 문서가 없으면 다른 필드는 비워 두고 만든다
    // (읽을 때 normalizeGenerationPreferences가 기본값을 채운다).
    await db
      .collection<GenerationPreferencesDocument>("generationPreferences")
      .updateOne(
        { termId },
        { $set: { v2Weights: weights, updatedAt: new Date() } },
        { upsert: true },
      );
    return NextResponse.json({ weights });
  } catch (error) {
    console.error("timetable weights PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
