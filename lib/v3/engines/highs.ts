/**
 * HiGHS(WebAssembly) 준비. 계산기 하나는 작업 구간마다 새로 만들고 끝나면 해제한다
 * (정수계획은 오래 돌수록 메모리가 늘고, 한번 늘린 메모리를 돌려주지 않음: docs/v3-deployment-review.md 2절).
 */
import loadHighs, { type Highs } from "highs";
import type { V3Model } from "@/lib/v3/model";

let highsPromise: Promise<Highs> | null = null;
let loaded: Highs | null = null;

export function getHighs(): Promise<Highs> {
  if (!highsPromise) {
    highsPromise = loadHighs().then((h) => (loaded = h)).catch((error) => {
      highsPromise = null;
      throw error;
    });
  }
  return highsPromise;
}

export type HighsModel = ReturnType<Highs["createModel"]>;

export const HIGHS_STATUS = { optimal: 7, infeasible: 8, timeLimit: 13, interrupted: 17 } as const;

export function createHighsModel(highs: Highs, m: V3Model): HighsModel {
  const inf = highs.infinity;
  const clip = (a: Float64Array) => Float64Array.from(a, (x) => (x === Infinity ? inf : x === -Infinity ? -inf : x));
  return highs.createModel({
    numCols: m.numCols,
    numRows: m.numRows,
    colCost: m.cost,
    colLower: clip(m.lower),
    colUpper: clip(m.upper),
    rowLower: clip(m.rowLower),
    rowUpper: clip(m.rowUpper),
    integrality: m.integrality,
    matrix: { format: "csr", numRows: m.numRows, numCols: m.numCols, starts: m.starts, indices: m.indices, values: m.values },
  } as never);
}

/** 해가 있는 종료 상태인가 (최적·시간 초과·중단 중 해를 가진 경우) */
export function hasSolution(model: HighsModel): boolean {
  const st = model.getModelStatus();
  if (st !== HIGHS_STATUS.optimal && st !== HIGHS_STATUS.timeLimit && st !== HIGHS_STATUS.interrupted) return false;
  try {
    return Number(model.info.get("primal_solution_status")) >= 2;
  } catch {
    return false;
  }
}

export function dualBound(model: HighsModel): number | null {
  try {
    const v = Number(model.info.get("mip_dual_bound"));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 계산기(WebAssembly) 메모리가 이 값을 넘으면 정수계획 구간을 끝내고 중단점을 저장한다.
 * 프로세스 전체 메모리(rss)가 아니라 계산기 자신의 메모리를 본다: 개발 서버 안에서 돌면 서버 자체가 이미 수백 MB를 쓰기 때문.
 * (따로 돌린 측정에서 rss 1,056MB일 때 계산기 메모리는 약 0.9GB)
 */
export const MEMORY_LIMIT_BYTES = 1_000_000_000;

export function overMemory(): boolean {
  return (loaded?.memoryBytes ?? 0) > MEMORY_LIMIT_BYTES;
}
