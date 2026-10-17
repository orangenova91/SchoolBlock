/**
 * 조기 종료 (docs/v3-requirements.md 8.5).
 *
 * - 최선(하한)에 닿거나 엄격 기준(5%·3점)에 들면 "결과 모으기" 단계로 들어간다. 바로 끝내지 않는다.
 * - 모으기 단계에서는 기준 안의 서로 다른 결과 3개가 모이면 끝낸다.
 * - 3개가 안 모여도, 상위 목록이 30초 동안 바뀌지 않고 (혼합·정수계획은) 부분 재계산을 20회 이상 했으면 끝낸다.
 * - 하한을 모르면 조기 종료하지 않는다 (구간 시간을 다 쓴다).
 */
import { strictThreshold } from "@/lib/v3/score";
import type { Collector } from "@/lib/v3/engines/collector";

export const EXTRA_QUIET_MS = 30_000;
export const EXTRA_MIN_ITERATIONS = 20;

export class StopRules {
  private collectingSince: number | null = null;
  private itersAtCollect = 0;

  constructor(private countIterations: boolean) {}

  /** 지금 모으기 단계인가 */
  get collecting(): boolean {
    return this.collectingSince !== null;
  }

  /** 기준 점수: 최적에 닿았으면 하한 그 자체, 아니면 엄격 기준 */
  private target(lowerBound: number, best: number): number {
    const lb = Math.ceil(lowerBound - 1e-6);
    return best <= lb ? lb : strictThreshold(lb);
  }

  shouldStop(nowMs: number, lowerBound: number | null, collector: Collector, iterations: number): boolean {
    const best = collector.bestScore();
    if (lowerBound === null || best === null) return false;
    const target = this.target(lowerBound, best);
    if (best > target) return false;
    if (this.collectingSince === null) {
      this.collectingSince = nowMs;
      this.itersAtCollect = iterations;
    }
    if (collector.top.fullAtOrBelow(target)) return true;
    const quiet = nowMs - Math.max(collector.lastChangeMs, this.collectingSince) >= EXTRA_QUIET_MS;
    const enoughIters = !this.countIterations || iterations - this.itersAtCollect >= EXTRA_MIN_ITERATIONS;
    return quiet && enoughIters;
  }
}
