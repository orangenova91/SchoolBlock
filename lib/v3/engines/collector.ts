/**
 * 결과 모으기: 엔진이 찾은 시간표를 검증기로 확인한 뒤 상위 3개에 넣는다.
 * 검증기를 통과한(미배치 0, 필수 조건 모두 지킴) 시간표만 결과가 된다.
 */
import type { V3Input } from "@/lib/v3/input";
import type { V3Instance } from "@/lib/v3/instance";
import { cellSignature, TopResults } from "@/lib/v3/results";
import { validateSolution, type V3Solution } from "@/lib/v3/validate";
import type { StoredResult } from "@/lib/v3/engines/types";

export class Collector {
  readonly top: TopResults<StoredResult>;
  bestIncomplete: { solution: V3Solution; unplaced: number } | null = null;
  /** 상위 목록이 마지막으로 바뀐 시각 (엔진 시계 기준) */
  lastChangeMs = 0;
  /** 검증기 거절 횟수 (엔진 버그 감시용) */
  rejected = 0;

  constructor(private input: V3Input, private inst: V3Instance, initial: StoredResult[] = []) {
    this.top = new TopResults(initial.map((r) => ({ score: r.metrics.score, signature: cellSignature(r.solution.cells), foundAtMs: r.foundAtMs, payload: r })));
  }

  get results(): StoredResult[] {
    return this.top.list.map((r) => r.payload);
  }

  bestScore(): number | null {
    return this.top.best()?.score ?? null;
  }

  /** 상위 3개의 가장 나쁜 점수 (3개가 안 찼으면 Infinity) — 이보다 좋아야 넣어 볼 가치가 있음 */
  admissionScore(): number {
    const l = this.top.list;
    return l.length < 3 ? Infinity : l[l.length - 1].score;
  }

  /**
   * 시간표 하나를 검증해 넣는다. 미배치가 있으면 결과 대신 "가장 덜 미배치된 해"로 기억한다.
   * 반환: 검증 통과 여부와 점수
   */
  offer(solution: V3Solution, atMs: number): { ok: boolean; score: number; unplaced: number; changed: boolean } {
    const v = validateSolution(this.input, this.inst, solution);
    const hardViolations = v.violations.length;
    if (hardViolations > 0) {
      this.rejected++;
      return { ok: false, score: v.metrics.score, unplaced: v.unplaced, changed: false };
    }
    if (v.unplaced > 0) {
      if (!this.bestIncomplete || v.unplaced < this.bestIncomplete.unplaced) this.bestIncomplete = { solution, unplaced: v.unplaced };
      return { ok: false, score: v.metrics.score, unplaced: v.unplaced, changed: false };
    }
    const changed = this.top.offer({ score: v.metrics.score, signature: cellSignature(solution.cells), foundAtMs: atMs, payload: { metrics: v.metrics, solution, foundAtMs: atMs } });
    if (changed) this.lastChangeMs = atMs;
    return { ok: true, score: v.metrics.score, unplaced: 0, changed };
  }
}
