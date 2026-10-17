/**
 * 정수계획 엔진 (docs/v3-algorithm-comparison.md 의 B 방식).
 *
 * 모델 전체를 HiGHS(JS)에 맡긴다. 해와 함께 "이보다 좋을 수 없다"는 하한도 준다.
 * - 시작 해: 중단점의 최선 해, 없으면 짧은 탐색(구간의 15%, 최대 20초)으로 만든 완성본을 계산기에 넣는다.
 *   (계산기 혼자서는 큰 문제의 첫 해를 오래 못 찾을 수 있음: 3단계 실험)
 * - 개선 해가 나올 때마다 검증해 상위 3개에 넣는다.
 * - 중지 요청·조기 종료·메모리 상한은 계산기의 중단 신호로 처리한다.
 * - 탐색 나무는 저장할 수 없다. 이어 돌릴 때는 최선 해를 시작점으로 다시 계산한다.
 */
import { buildModel, decodeSolution, encodeSolution, type V3Model } from "@/lib/v3/model";
import type { V3Solution } from "@/lib/v3/validate";
import { Collector } from "@/lib/v3/engines/collector";
import { createHighsModel, dualBound, getHighs, hasSolution, overMemory, type HighsModel } from "@/lib/v3/engines/highs";
import { runSearch } from "@/lib/v3/engines/search";
import { StopRules } from "@/lib/v3/engines/stop-rules";
import type { EngineOutcome, EngineRun, StopReason } from "@/lib/v3/engines/types";

/** 결정 변수(x·y·z·u)를 주어진 값에 묶고 나머지(점수 변수)만 풀어 완전한 해 벡터를 만든다 */
export function completeVector(model: HighsModel, m: V3Model, x: Float64Array, seconds = 30): Float64Array | null {
  const lo = Float64Array.from(m.lower), hi = Float64Array.from(m.upper);
  for (let c = 0; c < m.numCols; c++) {
    const k = m.kind[c];
    if (k === "x" || k === "y" || k === "z" || k === "u") { lo[c] = x[c]; hi[c] = x[c]; }
  }
  model.changeColsBounds({ kind: "range", from: 0, to: m.numCols - 1 }, lo, hi);
  model.clearSolver();
  model.zeroAllClocks();
  model.options.set("time_limit", seconds);
  model.run();
  const ok = hasSolution(model);
  const out = ok ? Float64Array.from(model.getSolution().colValue) : null;
  model.changeColsBounds({ kind: "range", from: 0, to: m.numCols - 1 }, m.lower, m.upper);
  model.clearSolver();
  return out;
}

export async function runMilp(run: EngineRun): Promise<EngineOutcome> {
  const { input, inst } = run;
  const t0 = Date.now();
  const baseMs = run.checkpoint?.elapsedMs ?? 0;
  const now = () => baseMs + (Date.now() - t0);
  const collector = new Collector(input, inst, run.checkpoint?.results ?? []);
  let lowerBound = run.lowerBound ?? run.checkpoint?.lowerBound ?? null;
  const progressEvery = run.progressEveryMs ?? 2000;

  // 시작 해
  let start: V3Solution | null = run.checkpoint?.best ?? collector.results[0]?.solution ?? null;
  let iterations = 0;
  if (!start) {
    const warm = runSearch({ ...run, budgetMs: Math.min(20_000, Math.max(3_000, run.budgetMs * 0.15)), checkpoint: null, onProgress: undefined });
    for (const r of warm.results) collector.offer(r.solution, now());
    start = warm.results[0]?.solution ?? warm.checkpoint.best;
    iterations += warm.iterations;
  }

  const m = buildModel(inst);
  const highs = await getHighs();
  const model = createHighsModel(highs, m);
  const stop = new StopRules(false);
  let reason: StopReason = "budget";
  let lastProgress = 0;
  let incumbents = 0;
  try {
    model.options.set({ output_flag: false, mip_rel_gap: 0 });
    if (start) {
      const full = completeVector(model, m, encodeSolution(inst, m, start));
      if (full) model.setSolution({ colValue: full } as never);
    }
    const left = run.budgetMs - (Date.now() - t0);
    model.zeroAllClocks();
    model.options.set("time_limit", Math.max(1, left / 1000));
    const cb = highs.constants.callbackType;
    model.run({
      [cb.mipImprovingSolution]: (e: { data: { mip_solution?: Float64Array } }) => {
        const x = e.data.mip_solution;
        if (x) { incumbents++; collector.offer(decodeSolution(inst, m, x), now()); }
        return undefined;
      },
      [cb.mipInterrupt]: (e: { data: { mip_dual_bound?: number }; interrupt: () => void }) => {
        const db = e.data.mip_dual_bound;
        if (typeof db === "number" && Number.isFinite(db)) lowerBound = Math.max(lowerBound ?? -Infinity, db);
        const t = Date.now();
        if (run.shouldStop?.()) { reason = "user"; e.interrupt(); }
        else if (stop.shouldStop(now(), lowerBound, collector, incumbents)) { reason = "early"; e.interrupt(); }
        else if (overMemory()) { reason = "memory"; e.interrupt(); }
        if (t - lastProgress > progressEvery) {
          lastProgress = t;
          run.onProgress?.({ phase: stop.collecting ? "collect" : "improve", elapsedMs: now(), segmentMs: t - t0, bestScore: collector.bestScore(), bestUnplaced: collector.bestScore() !== null ? 0 : null, lowerBound, results: collector.results.length, iterations: incumbents });
        }
        return undefined;
      },
    } as never);
    const db = dualBound(model);
    if (db !== null) lowerBound = Math.max(lowerBound ?? -Infinity, db);
    if (hasSolution(model)) collector.offer(decodeSolution(inst, m, model.getSolution().colValue), now());
    if (model.getModelStatus() === 8 && collector.results.length === 0) reason = "infeasible";
  } finally {
    model.dispose();
  }
  const results = collector.results;
  return {
    stopReason: reason,
    results,
    bestIncomplete: results.length ? null : collector.bestIncomplete,
    lowerBound,
    checkpoint: { kind: "milp", best: results[0]?.solution ?? start, results, elapsedMs: now(), lowerBound, seed: (run.seed ?? 1) + 1 },
    iterations: iterations + incumbents,
    segmentMs: Date.now() - t0,
  };
}
