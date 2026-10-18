/**
 * 혼합 엔진 (docs/v3-algorithm-comparison.md 의 D 방식).
 *
 * 1) 시작 해: 중단점, 없으면 탐색(구간의 25%, 10초 이상)
 * 2) 한 구역(하루 / 한 학년의 이틀, 오래 못 좋아지면 이틀 전체 / 한 학년 전체)만 비우고
 *    나머지는 현재 해에 묶은 채 정수계획으로 그 구역을 다시 최적으로 채운다. 이를 반복한다.
 *    - 현재 해를 계산기 시작점으로 넣고(setSolution), 모델은 다시 만들지 않고 범위만 바꾼다(changeColsBounds).
 *    - 미배치를 허용하는 모델(1시간 = 1000점)이라 불완전한 시작 해도 받아 고칠 수 있다.
 *    - 시작 해가 필수 조건을 어기면(교사 겹침 등), 어긴 곳의 요일을 비우고 먼저 고친다.
 *    - 미배치가 남아 있으면 "보수 구역"을 자주 쓴다: 남은 수업의 반 전체 + 그 교사의 모든 수업 + 그 학년 SET.
 *      (무작위 구역만으로는 남은 수업이 들어갈 자리를 포함하지 못해 오래 못 고칠 수 있음: M2 측정)
 */
import { buildModel, decodeSolution, encodeSolution, type V3Model } from "@/lib/v3/model";
import type { Weekday } from "@/lib/types";
import { Collector } from "@/lib/v3/engines/collector";
import { createHighsModel, getHighs, hasSolution, overMemory, type HighsModel } from "@/lib/v3/engines/highs";
import { completeVector } from "@/lib/v3/engines/milp";
import { solveModel } from "@/lib/v3/engines/solve";
import { rng, runSearch } from "@/lib/v3/engines/search";
import { maxLowerBound, StopRules } from "@/lib/v3/engines/stop-rules";
import type { EngineOutcome, EngineRun, StopReason } from "@/lib/v3/engines/types";

const SUB_SECONDS = 15;
const STALE_ITERATIONS = 20;

/** 결정 변수만 neighborhood 밖에서 x 에 묶는다 */
function bounds(m: V3Model, x: Float64Array, free: (c: number) => boolean) {
  const lo = Float64Array.from(m.lower), hi = Float64Array.from(m.upper);
  for (let c = 0; c < m.numCols; c++) {
    const k = m.kind[c];
    if ((k === "x" || k === "y" || k === "z") && !free(c)) { const v = Math.round(x[c]); lo[c] = v; hi[c] = v; }
  }
  return { lo, hi };
}

function solveWith(model: HighsModel, m: V3Model, x: Float64Array, free: (c: number) => boolean, seconds: number): { x: Float64Array; cost: number } | null {
  const { lo, hi } = bounds(m, x, free);
  model.changeColsBounds({ kind: "range", from: 0, to: m.numCols - 1 }, lo, hi);
  model.clearSolver();
  model.setSolution({ colValue: x } as never);
  model.zeroAllClocks();
  model.options.set("time_limit", Math.max(1, seconds));
  model.run();
  if (!hasSolution(model)) return null;
  return { x: Float64Array.from(model.getSolution().colValue), cost: model.getObjectiveValue() };
}

/**
 * 묶은 결정 변수로 필수 조건을 어기는 행에 걸린 요일과 학년.
 * SET 회차(y·z)가 걸린 행을 어기면 그 학년 전체를 비워야 고칠 수 있다
 * (예: 같은 SET이 하루 2회 → 한 회차를 다른 요일로 옮겨야 하는데, 그 요일이 묶여 있으면 못 옮김).
 */
function violatedArea(m: V3Model, x: Float64Array): { days: Set<Weekday>; grades: Set<number> } {
  const days = new Set<Weekday>();
  const grades = new Set<number>();
  for (let r = 0; r < m.numRows; r++) {
    let s = 0;
    for (let k = m.starts[r]; k < m.starts[r + 1]; k++) {
      const kind = m.kind[m.indices[k]];
      if (kind === "x" || kind === "y" || kind === "z" || kind === "u") s += m.values[k] * x[m.indices[k]];
    }
    // 점수 변수(L·T·S)는 0으로 두고 본 값이라 상한 쪽만 의미가 있다: 상한을 넘거나 하한에 못 미치는 행
    let hasSoft = false;
    for (let k = m.starts[r]; k < m.starts[r + 1]; k++) { const kind = m.kind[m.indices[k]]; if (kind === "L" || kind === "T" || kind === "S") hasSoft = true; }
    if (hasSoft) continue;
    if (s > m.rowUpper[r] + 1e-6 || s < m.rowLower[r] - 1e-6) {
      for (let k = m.starts[r]; k < m.starts[r + 1]; k++) {
        const c = m.indices[k];
        const d = m.day[c];
        if (d) days.add(d);
        const g = m.grade[c];
        if ((m.kind[c] === "y" || m.kind[c] === "z") && g !== null) grades.add(g);
      }
    }
  }
  return { days, grades };
}

export async function runHybrid(run: EngineRun): Promise<EngineOutcome> {
  const { input, inst } = run;
  const t0 = Date.now();
  const baseMs = run.checkpoint?.elapsedMs ?? 0;
  const now = () => baseMs + (Date.now() - t0);
  const left = () => run.budgetMs - (Date.now() - t0);
  const collector = new Collector(input, inst, run.checkpoint?.results ?? []);
  const baseLowerBound = run.lowerBound ?? run.checkpoint?.lowerBound ?? null;
  // 같은 입력의 하한 계산이 동시에 돌면, 도중에 증명한 하한을 계산 중에도 바로 쓴다
  const currentLowerBound = () => maxLowerBound(baseLowerBound, run.liveLowerBound?.());
  const rand = rng((run.seed ?? run.checkpoint?.seed ?? 1) * 7919 + 13);
  const progressEvery = run.progressEveryMs ?? 2000;
  let iterations = 0;
  let reason: StopReason = "budget";

  // 1) 시작 해
  let startSol = run.checkpoint?.best ?? null;
  if (!startSol) {
    const warm = runSearch({ ...run, budgetMs: Math.max(10_000, run.budgetMs * 0.25), checkpoint: null, onProgress: run.onProgress });
    for (const r of warm.results) collector.offer(r.solution, now());
    startSol = warm.results[0]?.solution ?? warm.checkpoint.best;
    // 완성본이 없어도 "가장 적게 남는 배치"를 기록해 둔다 (화면의 미배치 안내에 쓰임)
    if (!warm.results.length && startSol) collector.offer(startSol, now());
    if (warm.stopReason === "user") reason = "user";
  }

  const m = buildModel(inst, { slack: true });
  const highs = await getHighs();
  const model = createHighsModel(highs, m);
  const stop = new StopRules({ assumeZero: run.assumeZeroBound, goal: run.goal, exact: run.exact });
  let lastProgress = 0;
  let cur: Float64Array | null = null;
  let curCost = Infinity;
  try {
    model.options.set({ output_flag: false, mip_rel_gap: 0 });
    if (reason !== "user" && startSol) {
      const x0 = encodeSolution(inst, m, startSol);
      cur = completeVector(model, m, x0, 60);
      if (!cur) {
        // 시작 해가 필수 조건을 어김 → 어긴 요일을 비우고 고친다
        const { days, grades } = violatedArea(m, x0);
        run.onProgress?.({ phase: "repair", elapsedMs: now(), segmentMs: Date.now() - t0, bestScore: null, bestUnplaced: null, lowerBound: currentLowerBound(), results: collector.results.length, iterations });
        const r = solveWith(model, m, x0, (c) => (m.day[c] !== null && days.has(m.day[c]!)) || (m.grade[c] !== null && grades.has(m.grade[c]!)), Math.min(120, left() / 1000));
        cur = r?.x ?? null;
        // 요일과 상관없는 조건(주당 시수 등)을 어기면 요일만 비워서는 못 고친다 → 전체를 다시 푼다.
        // 미배치를 허용하는 모델이라 늘 답이 있다 (배치 불가 조건에서도 "가장 적게 남는 배치"로 이어 간다)
        if (!cur && left() > 5000) {
          // 그래도 안 되면 점수는 잠시 잊고 "가장 적게 남는 배치"부터 찾는다 (배치 가능 판정과 같은 계산).
          // 그 배치는 필수 조건을 모두 지키므로 여기서부터 부분 재계산으로 점수·미배치를 줄여 간다
          run.onProgress?.({ phase: "repair", elapsedMs: now(), segmentMs: Date.now() - t0, bestScore: null, bestUnplaced: null, lowerBound: currentLowerBound(), results: collector.results.length, iterations });
          const mu = buildModel(inst, { slack: true, weights: { lunch: 0, triple: 0, sameDay: 0 } });
          const r = await solveModel(mu, { budgetMs: Math.min(150_000, left() * 0.6), warm: encodeSolution(inst, mu, startSol), shouldStop: run.shouldStop });
          if (r.x) {
            const sol = decodeSolution(inst, mu, r.x);
            collector.offer(sol, now());
            cur = completeVector(model, m, encodeSolution(inst, m, sol), 60);
          }
        }
      }
    }
    if (cur) {
      model.clearSolver();
      curCost = m.cost.reduce((a, c, i) => a + c * cur![i], 0);
      collector.offer(decodeSolution(inst, m, cur), now());
    }

    // 2) 부분 재계산 반복
    const grades = [...new Set(m.grade.filter((g) => g !== null))] as number[];
    const uCols: number[] = [];
    for (let c = 0; c < m.numCols; c++) if (m.kind[c] === "u") uCols.push(c);
    /** 미배치 수업 하나를 골라, 그 반·그 교사의 수업과 그 학년 SET 을 비우는 구역 */
    const repairArea = (x: Float64Array): ((c: number) => boolean) | null => {
      const left = uCols.filter((c) => x[c] > 0.5);
      if (!left.length) return null;
      const g = inst.groups[m.ref[left[Math.floor(rand() * left.length)]]];
      return (c) => {
        const k = m.kind[c];
        if (k === "x") { const h = inst.groups[m.ref[c]]; return (h.grade === g.grade && h.classNo === g.classNo) || h.teacher === g.teacher; }
        return (k === "y" || k === "z") && m.grade[c] === g.grade;
      };
    };
    let lastImprove = 0;
    while (cur && reason === "budget" && left() > 2000) {
      if (run.shouldStop?.()) { reason = "user"; break; }
      if (stop.shouldStop(currentLowerBound(), collector)) { reason = "early"; break; }
      // 계산기 메모리는 줄지 않으므로 상한을 넘으면 이 구간을 끝내고 중단점에서 새 계산기로 이어 간다
      if (overMemory()) { reason = "memory"; break; }
      iterations++;
      const u = rand();
      const big = iterations - lastImprove > STALE_ITERATIONS;
      const pickDays = (n: number) => { const ds = [...inst.days].sort(() => rand() - 0.5).slice(0, n); return new Set<Weekday>(ds); };
      let free: (c: number) => boolean;
      const repair = curCost >= 1000 && rand() < 0.6 ? repairArea(cur) : null;
      if (repair) free = repair;
      else if (big && u < 0.5) { const ds = pickDays(2); free = (c) => m.day[c] !== null && ds.has(m.day[c]!); }
      else if (big) { const g = grades[Math.floor(rand() * grades.length)]; free = (c) => m.grade[c] === g; }
      else if (u < 0.4) { const ds = pickDays(1); free = (c) => m.day[c] !== null && ds.has(m.day[c]!); }
      else { const g = grades[Math.floor(rand() * grades.length)]; const ds = pickDays(2); free = (c) => m.grade[c] === g && m.day[c] !== null && ds.has(m.day[c]!); }
      const r = solveWith(model, m, cur, free, Math.min(SUB_SECONDS, left() / 1000 - 1));
      if (r && r.cost < curCost - 1e-6) {
        cur = r.x; curCost = r.cost; lastImprove = iterations;
        collector.offer(decodeSolution(inst, m, cur), now());
      } else if (r && r.cost <= collector.admissionScore() + 1e-6) {
        // 같은 점수의 다른 시간표 → 서로 다른 결과 3개 모으기에 쓴다
        collector.offer(decodeSolution(inst, m, r.x), now());
      }
      const t = Date.now();
      if (t - lastProgress > progressEvery) {
        lastProgress = t;
        run.onProgress?.({ phase: stop.collecting ? "collect" : curCost >= 1000 ? "repair" : "improve", elapsedMs: now(), segmentMs: t - t0, bestScore: collector.bestScore(), bestUnplaced: collector.bestScore() !== null ? 0 : (collector.bestIncomplete?.unplaced ?? null), lowerBound: currentLowerBound(), results: collector.results.length, iterations });
      }
    }
  } finally {
    model.dispose();
  }
  const results = collector.results;
  const best = results[0]?.solution ?? (cur ? decodeSolution(inst, m, cur) : startSol);
  return {
    stopReason: reason,
    results,
    bestIncomplete: results.length ? null : collector.bestIncomplete,
    lowerBound: currentLowerBound(),
    checkpoint: { kind: "hybrid", best, results, elapsedMs: now(), lowerBound: currentLowerBound(), seed: Math.floor(rand() * 2 ** 31) },
    iterations,
    segmentMs: Date.now() - t0,
  };
}
