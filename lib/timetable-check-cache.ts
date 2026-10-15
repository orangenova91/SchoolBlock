import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  runPlacementCheck,
  type PlacementCheckReport,
} from "@/lib/timetable-exact-check";
import type { FeasibilityInput } from "@/lib/timetable-feasibility";
import type { TimetableCell } from "@/lib/types";

/**
 * v2 사전 검사 결과 재사용.
 *
 * 검사 입력(교사·교과·학반·요일·SET·선 수업·배정 불가)이 그대로면 결과도
 * 같으므로, 화면 진입 시 자동 검사와 생성 직전 검사는 저장된 결과를 다시
 * 쓴다. "사전 검사" 버튼(수동)은 항상 새로 검사해 저장값을 갱신한다.
 *
 * 저장 위치: v2PlacementChecks 컬렉션 (학기당 1건, 학기 삭제 시 함께 삭제).
 */

/** 검사 로직이 바뀌면 올려서 이전 저장값을 무효화한다. */
const CHECK_CACHE_VERSION = 1;
const COLLECTION = "v2PlacementChecks";

type CheckCacheDocument = {
  termId: string;
  inputKey: string;
  report: PlacementCheckReport;
  solutionCells: TimetableCell[];
  checkedAt: Date;
};

export type CachedPlacementCheck = {
  report: PlacementCheckReport;
  solutionCells: TimetableCell[];
  checkedAt: Date;
  /** 저장된 결과를 다시 썼으면 true. */
  cached: boolean;
};

/** 검사 결과에 영향을 주는 입력만 고정된 순서로 직렬화해 해시한다. */
export function placementInputKey(input: FeasibilityInput): string {
  const canonical = JSON.stringify([
    CHECK_CACHE_VERSION,
    input.teachers,
    input.subjects,
    input.classCounts,
    input.schedules,
    input.wholeCells,
    input.partialCells,
    input.teacherAssignments ?? [],
    input.subjectBlocks ?? [],
    input.forbiddenSlots ?? [],
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** 입력이 같을 때의 저장된 결과. 없거나 입력이 바뀌었으면 null. */
export async function findCachedPlacementCheck(
  db: Db,
  termId: string,
  input: FeasibilityInput,
): Promise<CachedPlacementCheck | null> {
  const doc = await db
    .collection<CheckCacheDocument>(COLLECTION)
    .findOne({ termId, inputKey: placementInputKey(input) });
  if (!doc) return null;
  return {
    report: doc.report,
    solutionCells: doc.solutionCells,
    checkedAt: doc.checkedAt,
    cached: true,
  };
}

/**
 * 저장된 결과가 있으면 그대로(`force`가 아니면), 없으면 검사하고 저장한다.
 * 판정을 끝내지 못한 결과(unknown)는 다음에 다시 시도하도록 저장하지 않는다.
 */
export async function runPlacementCheckCached(
  db: Db,
  termId: string,
  input: FeasibilityInput,
  options: { force?: boolean } = {},
): Promise<CachedPlacementCheck> {
  if (!options.force) {
    const hit = await findCachedPlacementCheck(db, termId, input);
    if (hit) return hit;
  }
  const { report, solutionCells } = await runPlacementCheck(input);
  const checkedAt = new Date();
  const collection = db.collection<CheckCacheDocument>(COLLECTION);
  if (report.exact.status === "unknown") {
    await collection.deleteOne({ termId });
  } else {
    await collection.updateOne(
      { termId },
      {
        $set: {
          termId,
          inputKey: placementInputKey(input),
          report,
          solutionCells,
          checkedAt,
        },
      },
      { upsert: true },
    );
  }
  return { report, solutionCells, checkedAt, cached: false };
}
