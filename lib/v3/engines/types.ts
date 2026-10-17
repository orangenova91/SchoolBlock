/**
 * v3 계산 엔진 공통 약속 (docs/v3-implementation-plan.md M2).
 *
 * 세 엔진(탐색·정수계획·혼합)은 같은 형태로 돈다:
 *   시작 해 또는 중단점 → 한 구간(budgetMs) 실행 → 진행 보고 → 상위 3개 + 중단점
 * 엔진은 계산만 한다. 저장·대기열·화면은 위층(M4·M5)이 맡는다.
 */
import type { V3Input } from "@/lib/v3/input";
import type { V3Instance } from "@/lib/v3/instance";
import type { V3Metrics } from "@/lib/v3/score";
import type { V3Solution } from "@/lib/v3/validate";

export type EngineKind = "search" | "milp" | "hybrid";

export type StoredResult = {
  metrics: V3Metrics;
  solution: V3Solution;
  /** 작업 시작부터 누적 시간 기준, 찾은 시각 */
  foundAtMs: number;
};

/** 다음 구간에서 이어 가는 데 필요한 것 (5단계: 중단점) */
export type EngineCheckpoint = {
  kind: EngineKind;
  /** 지금까지의 가장 좋은 시간표 (미배치가 있을 수도 있음) */
  best: V3Solution | null;
  results: StoredResult[];
  /** 이 작업이 지금까지 쓴 계산 시간 (모든 구간 합) */
  elapsedMs: number;
  /** 알려진 이론상 최선(하한) */
  lowerBound: number | null;
  /** 다음 구간 무작위 시작값 */
  seed: number;
};

export type EnginePhase = "start" | "repair" | "improve" | "collect";

export type EngineProgress = {
  phase: EnginePhase;
  /** 작업 누적 시간 */
  elapsedMs: number;
  /** 이번 구간 경과 */
  segmentMs: number;
  bestScore: number | null;
  /** 가장 좋은 해의 미배치 수 (완성본이 있으면 0) */
  bestUnplaced: number | null;
  lowerBound: number | null;
  results: number;
  iterations: number;
};

export type EngineRun = {
  input: V3Input;
  inst: V3Instance;
  /** 이번 구간 길이 */
  budgetMs: number;
  checkpoint?: EngineCheckpoint | null;
  /** 진단 등으로 이미 알고 있는 하한 */
  lowerBound?: number | null;
  seed?: number;
  /** 사용자 중지 요청 (자주 불리므로 가볍게) */
  shouldStop?: () => boolean;
  onProgress?: (p: EngineProgress) => void;
  progressEveryMs?: number;
  /** 첫 완성본을 찾으면 바로 끝낸다 (배치 가능 판정용: 예시 하나면 증명됨) */
  stopOnFirstComplete?: boolean;
};

export type StopReason = "budget" | "user" | "early" | "memory" | "infeasible";

export type EngineOutcome = {
  stopReason: StopReason;
  results: StoredResult[];
  /** 완성본이 없을 때 가장 미배치가 적은 해 */
  bestIncomplete: { solution: V3Solution; unplaced: number } | null;
  lowerBound: number | null;
  checkpoint: EngineCheckpoint;
  iterations: number;
  segmentMs: number;
};
