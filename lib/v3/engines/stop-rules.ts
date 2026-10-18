/**
 * 조기 종료 (docs/v3-requirements.md 8.5, 2026-10-18 정책).
 *
 * 목표(goal)에 드는 서로 다른 결과 3개가 모이면 끝낸다. 1~2개로는 끝내지 않는다 (구간 시간을 다 쓴다).
 * - strict(기본): 엄격 기준 max(하한 × 1.05, 하한 + 3) 이하인 결과 3개
 * - optimal: 하한(이론상 최선)과 같은 점수의 결과 3개 — 엄격 기준 3개로 끝난 뒤 사용자가 추가 탐색을 승인했을 때
 * 하한을 모르면: 생성 작업(assumeZero)은 0을 하한으로 쓴다 (점수는 0보다 작을 수 없으므로 늘 맞는 값).
 *   0 기준 엄격 기준은 3점이라, 진짜 최선이 더 큰 학교는 그 점수에 닿을 수 없어 일찍 잘못 멈추지 않는다.
 * 진단(exact)은 정확한 값이 필요하므로 일찍 끝내지 않는다.
 */
import { strictThreshold } from "@/lib/v3/score";
import type { Collector } from "@/lib/v3/engines/collector";

export type StopGoal = "strict" | "optimal";

export type StopRuleOptions = {
  /** 하한을 모르면 0으로 본다 (생성 작업용) */
  assumeZero?: boolean;
  goal?: StopGoal;
  /** 일찍 끝내지 않는다 (진단용) */
  exact?: boolean;
};

export class StopRules {
  private reached = false;

  constructor(private readonly opts: StopRuleOptions = {}) {}

  /** 지금 목표 점수에 닿아 "결과 모으기" 중인가 (진행 표시용) */
  get collecting(): boolean {
    return this.reached;
  }

  /** 목표 점수: optimal 이면 하한 그 자체, 아니면 엄격 기준 */
  target(lowerBound: number): number {
    const lb = Math.max(0, Math.ceil(lowerBound - 1e-6));
    return this.opts.goal === "optimal" ? lb : strictThreshold(lb);
  }

  shouldStop(lowerBound: number | null, collector: Collector): boolean {
    if (this.opts.exact) return false;
    const best = collector.bestScore();
    const lb = lowerBound ?? (this.opts.assumeZero ? 0 : null);
    if (lb === null || best === null) return false;
    const target = this.target(lb);
    this.reached = best <= target + 1e-9;
    return this.reached && collector.top.fullAtOrBelow(target);
  }
}

/** 둘 중 큰 하한 (모르면 null). 하한은 클수록 정확하다 */
export function maxLowerBound(a: number | null | undefined, b: number | null | undefined): number | null {
  const x = a ?? null, y = b ?? null;
  return x === null ? y : y === null ? x : Math.max(x, y);
}
