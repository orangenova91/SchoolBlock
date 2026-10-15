import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import {
  findCachedPlacementCheck,
  runPlacementCheckCached,
  type CachedPlacementCheck,
} from "@/lib/timetable-check-cache";
import { checkPlacementFeasibility } from "@/lib/timetable-feasibility";
import { loadFeasibilityInput } from "@/lib/timetable-feasibility-data";

/** 정확 판정(MILP)은 최대 20초. */
export const maxDuration = 40;

function withMeta({ report, checkedAt, cached }: CachedPlacementCheck) {
  return { ...report, checkedAt: checkedAt.toISOString(), cached };
}

type RouteContext = {
  params: Promise<{ termId: string }>;
};

/**
 * v2 전용 미배치 사전 검사.
 * - `?mode=cached`: 조건이 바뀌지 않았으면 저장된 결과만 돌려준다 (자동 검사용).
 * - `?mode=quick`: 반·교사별 매칭 검사만 (수 ms). 진행 상황을 먼저 보여준다.
 * - 기본: 매칭 검사 + 정확 판정(MILP, 최대 20초)을 새로 하고 결과를 저장한다.
 */
export async function POST(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { termId } = await context.params;

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
        { error: "사전 검사는 v2 시간표에서만 사용할 수 있습니다." },
        { status: 400 },
      );
    }

    const db = await getDb();
    const input = await loadFeasibilityInput(db, termId);
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "cached") {
      const hit = await findCachedPlacementCheck(db, termId, input);
      return NextResponse.json({ feasibility: hit ? withMeta(hit) : null });
    }
    if (mode === "quick") {
      return NextResponse.json({ quick: checkPlacementFeasibility(input) });
    }
    const result = await runPlacementCheckCached(db, termId, input, {
      force: true,
    });
    return NextResponse.json({ feasibility: withMeta(result) });
  } catch (error) {
    console.error("timetable feasibility failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
