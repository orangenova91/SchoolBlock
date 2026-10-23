/**
 * v3 진단 (docs/v3-diagnosis-design.md 3절).
 *
 * 1) 배치 가능 판정: 빠른 검사 → 탐색으로 완성본 찾기(30초) → 못 찾으면 미배치 최소값 정확 계산
 * 2) 원인 찾기: 배정 불가 칸·선 수업 중 가장 적게 풀어서 미배치 0이 되는 조합
 * 3) 고정의 영향: (고정한 조건의 최선) − (고정 없는 최선)
 * 4) 데이터 한계: 항목별(점심 연강·3연강·동일 교과) 최소값 + 쉬운 세기 설명
 *
 * 모두 시간 제한 안에서 돌고, 시간이 모자라면 "범위"로 답한다(예: 미배치 1~2).
 */
import type { Weekday } from "@/lib/types";
import type { V3Input } from "@/lib/v3/input";
import { gradeSlots, type V3Instance } from "@/lib/v3/instance";
import { buildModel, encodeSolution, UNPLACED_COST } from "@/lib/v3/model";
import { quickCheck, type QuickWarning } from "@/lib/v3/quick-check";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import { solveModel } from "@/lib/v3/engines/solve";
import type { StoredResult } from "@/lib/v3/engines/types";
import type { V3Solution } from "@/lib/v3/validate";

export type DiagnoseRun = {
  input: V3Input;
  inst: V3Instance;
  budgetMs: number;
  seed?: number;
  shouldStop?: () => boolean;
  /** 진행 문구 (예: "완성본 찾는 중") */
  onProgress?: (message: string) => void;
  /** 이론상 최선 계산 중 증명된 하한이 오를 때마다 (정수로 올림). 하한은 계산 도중에도 이미 증명된 값이다 */
  onBound?: (lowerBound: number) => void;
};

/** 정수 범위: lo = 증명된 하한, hi = 찾은 값 (같으면 확정) */
export type Range = { lo: number; hi: number | null; exact: boolean };
const range = (lo: number, hi: number | null): Range => ({ lo, hi, exact: hi !== null && lo >= hi });

// ── 1) 배치 가능 판정 ──

export type FeasibilityReport = {
  status: "feasible" | "infeasible" | "unknown";
  /** 어떻게 알았나: 세기 / 예시(완성본) / 정확 계산 */
  proof: "count" | "example" | "exact" | null;
  /** 최소 미배치 시간 (feasible 이면 0) */
  minUnplaced: Range;
  quick: QuickWarning[];
  /** 완성본 (예시로 증명했을 때) 또는 가장 적게 남는 배치 */
  solution: V3Solution | null;
  /** 끝까지 남는 수업 (infeasible·unknown 일 때, 가장 좋은 배치 기준) */
  leftLessons: { teacher: string; grade: number; classNo: number; subject: string; hours: number }[];
  elapsedMs: number;
};

export const FEASIBILITY_SEARCH_MS = 30_000;

export async function diagnoseFeasibility(run: DiagnoseRun): Promise<FeasibilityReport> {
  const t0 = Date.now();
  const left = () => run.budgetMs - (Date.now() - t0);
  const quick = quickCheck(run.inst);
  if (quick.blocking || quick.minUnplaced > 0) {
    return { status: "infeasible", proof: "count", minUnplaced: range(Math.max(1, quick.minUnplaced), null), quick: quick.warnings, solution: null, leftLessons: [], elapsedMs: Date.now() - t0 };
  }

  run.onProgress?.("완성본 찾는 중 (탐색)");
  const s = runSearch({ input: run.input, inst: run.inst, budgetMs: Math.min(FEASIBILITY_SEARCH_MS, Math.max(1000, left() * 0.3)), seed: run.seed, shouldStop: run.shouldStop, stopOnFirstComplete: true });
  if (s.results.length) {
    return { status: "feasible", proof: "example", minUnplaced: range(0, 0), quick: quick.warnings, solution: s.results[0].solution, leftLessons: [], elapsedMs: Date.now() - t0 };
  }

  run.onProgress?.("미배치 최소값 정확 계산 중");
  const m = buildModel(run.inst, { slack: true, weights: { lunch: 0, triple: 0, sameDay: 0 } });
  const warm = s.checkpoint.best ? encodeSolution(run.inst, m, s.checkpoint.best) : null;
  const r = await solveModel(m, { budgetMs: Math.max(1000, left()), warm, shouldStop: run.shouldStop, onTick: (lb, pb) => run.onProgress?.(`미배치 최소값 계산 중: ${lb === null ? "?" : Math.ceil(lb / UNPLACED_COST - 1e-6)} ~ ${pb === null ? "?" : Math.round(pb / UNPLACED_COST)}`) });
  const toHours = (v: number | null) => (v === null ? null : Math.round(v / UNPLACED_COST));
  const best = toHours(r.objective);
  const lb = r.status === "optimal" ? best! : r.lowerBound === null ? 0 : Math.ceil(r.lowerBound / UNPLACED_COST - 1e-6);
  const leftLessons: FeasibilityReport["leftLessons"] = [];
  if (r.x) {
    for (let c = 0; c < m.numCols; c++) {
      if (m.kind[c] !== "u" || r.x[c] < 0.5) continue;
      const g = run.inst.groups[m.ref[c]];
      leftLessons.push({ teacher: g.teacher, grade: g.grade, classNo: g.classNo, subject: g.subject, hours: Math.round(r.x[c]) });
    }
  }
  const status = best === 0 ? "feasible" : r.status === "optimal" ? "infeasible" : lb > 0 ? "infeasible" : "unknown";
  return {
    status,
    proof: status === "unknown" ? null : "exact",
    minUnplaced: range(lb, best),
    quick: quick.warnings,
    solution: null,
    leftLessons,
    elapsedMs: Date.now() - t0,
  };
}

// ── 2) 원인 찾기 (최소 완화) ──

export type RelaxItem =
  | { kind: "forbidden"; teacher: string; day: Weekday; period: number }
  | { kind: "pin"; teacher: string; grade: number; classNo: number; subject: string; day: Weekday; period: number };

export type RelaxReport = {
  /** found: 이것만 풀면 됨 (minimal = 가장 적은 개수 증명) / none: 배정 불가·선 수업을 모두 풀어도 불가 / unknown: 시간 안에 못 찾음 */
  status: "found" | "none" | "unknown";
  minimal: boolean;
  items: RelaxItem[];
  /** 전체 후보 수 (안내용) */
  candidates: { forbidden: number; pins: number };
  /** 풀어도 안 될 때의 원인 후보 (빠른 검사의 교사·반 부족) */
  structural: QuickWarning[];
  elapsedMs: number;
};

export async function diagnoseRelax(run: DiagnoseRun): Promise<RelaxReport> {
  const t0 = Date.now();
  const candidates = { forbidden: run.inst.forbidden.size, pins: run.inst.pins.length };
  const structural = quickCheck(run.inst).warnings.filter((w) => w.severity === "error" && (w.rule === "teacherGrade" || w.rule === "teacher" || w.rule === "class"));
  // 반 시간 부족·교사의 학년 수업 > SET 밖 칸은 수업 시간 수의 문제라, 배정 불가·선 수업을 풀어도(선 수업도 옮길 뿐 시간은 그대로) 고칠 수 없다
  if (structural.some((w) => w.rule === "teacherGrade" || w.rule === "class")) {
    return { status: "none", minimal: true, items: [], candidates, structural, elapsedMs: Date.now() - t0 };
  }
  run.onProgress?.("풀어야 할 조건 찾는 중");
  const m = buildModel(run.inst, { relax: true });
  const r = await solveModel(m, { budgetMs: run.budgetMs, shouldStop: run.shouldStop });
  if (r.status === "infeasible") return { status: "none", minimal: true, items: [], candidates, structural, elapsedMs: Date.now() - t0 };
  if (!r.x) return { status: "unknown", minimal: false, items: [], candidates, structural, elapsedMs: Date.now() - t0 };
  const items: RelaxItem[] = [];
  for (let c = 0; c < m.numCols; c++) {
    if (m.kind[c] !== "R" || r.x[c] < 0.5) continue;
    const parts = m.relaxLabels[m.ref[c]].split("|");
    if (parts[0] === "배정 불가") items.push({ kind: "forbidden", teacher: parts[1], day: parts[2] as Weekday, period: Number(parts[3]) });
    else {
      const [g, cl] = parts[2].split("-").map(Number);
      items.push({ kind: "pin", teacher: parts[1], grade: g, classNo: cl, subject: parts[3], day: parts[4] as Weekday, period: Number(parts[5]) });
    }
  }
  return { status: "found", minimal: r.status === "optimal", items, candidates, structural, elapsedMs: Date.now() - t0 };
}

// ── 3) 고정의 영향 ──

export type FixedLossReport = {
  withFixed: Range;
  withoutFixed: Range;
  /** 손실 범위: (고정 최선의 하한 − 자유 최선) ~ (고정 최선 − 자유 하한) */
  loss: Range;
  /** 고정한 SET 회차가 하나도 없음 */
  nothingFixed: boolean;
  elapsedMs: number;
};

function scoreRange(results: StoredResult[], lowerBound: number | null): Range {
  const best = results[0]?.metrics.score ?? null;
  const lb = lowerBound === null ? 0 : Math.max(0, Math.ceil(lowerBound - 1e-6));
  return range(Math.min(lb, best ?? lb), best);
}

export async function diagnoseFixedLoss(run: DiagnoseRun): Promise<FixedLossReport> {
  const t0 = Date.now();
  const nothingFixed = run.inst.sets.every((s) => s.fixed.length === 0);
  const half = run.budgetMs / 2;
  run.onProgress?.("고정한 조건의 최선 계산 중");
  const a = await runMilp({ input: run.input, inst: run.inst, budgetMs: half, seed: run.seed, shouldStop: run.shouldStop, exact: true });
  let withoutFixed: Range;
  const withFixed = scoreRange(a.results, a.lowerBound);
  if (nothingFixed) withoutFixed = withFixed;
  else {
    run.onProgress?.("고정을 풀었을 때의 최선 계산 중");
    const free = { ...run.inst, sets: run.inst.sets.map((s) => ({ ...s, fixed: [] })) };
    const freeInput = { ...run.input, fixedWholeCells: [], fixedPartialCells: [] };
    const b = await runMilp({ input: freeInput, inst: free, budgetMs: Math.max(1000, run.budgetMs - (Date.now() - t0)), seed: run.seed, shouldStop: run.shouldStop, exact: true });
    withoutFixed = scoreRange(b.results, b.lowerBound);
  }
  const lossLo = withoutFixed.hi === null ? 0 : Math.max(0, withFixed.lo - withoutFixed.hi);
  const lossHi = withFixed.hi === null ? null : Math.max(0, withFixed.hi - withoutFixed.lo);
  return { withFixed, withoutFixed, loss: range(lossLo, lossHi), nothingFixed, elapsedMs: Date.now() - t0 };
}

// ── 이론상 최선 (하한) ──

export type BoundReport = {
  /** 증명된 하한 (점수, 정수로 올림) */
  lowerBound: number | null;
  /** 계산 중 찾은 가장 좋은 점수 */
  best: number | null;
  /** 하한 = 최선 (최적 증명) */
  proven: boolean;
  /**
   * 항목별 최소 건수 (점심 연강·3연강·같은 날 교과를 하나씩 최소화한 하한). 꺼진 항목은 없음.
   * 점수 = Σ 건수 × 중요도이고 각 건수는 자기 최소 이상이므로 Σ 최소 × 중요도 도 맞는 하한이다.
   */
  items?: Partial<Record<"lunch" | "triple" | "sameDay", { min: number; exact: boolean }>>;
  /** Σ 항목 최소 × 중요도 */
  itemSum?: number;
  elapsedMs: number;
};

/** 항목별 최소에 쓰는 시간 비율 (나머지는 전체 정수계획) */
const ITEM_PHASE = 0.75;

/**
 * 이론상 최선(하한) 계산 (2026-10-18 개정).
 * 1) 점심 연강·3연강·같은 날 교과를 하나씩 최소화한다. 한 항목만 보는 계산이라 훨씬 빨리 정확해진다
 *    (테스트 시간표 6: 전체 계산은 5분에도 15점에 머물렀지만 점심 연강만은 37초에 "최소 8건" = 24점 증명).
 *    항목이 하나 끝날 때마다 지금까지의 합을 하한으로 알린다 (남은 항목은 0 이상이므로 늘 맞는 값).
 * 2) 남은 시간에 전체 정수계획으로 하한을 더 올리고 실제 시간표를 찾는다. 찾은 점수가 하한과 같으면 최선 증명.
 * 진단이므로 일찍 끝내지 않는다 (최선을 증명하면 그때 끝남).
 */
export async function diagnoseBound(run: DiagnoseRun): Promise<BoundReport> {
  const t0 = Date.now();
  const left = () => run.budgetMs - (Date.now() - t0);
  const w = run.inst.weights;
  let shown = -1;
  const publish = (lb: number) => {
    if (lb <= shown) return;
    shown = lb;
    run.onBound?.(lb);
  };

  // 1) 항목별 최소 (중요도에 비례해 시간을 나눔, 점심 연강부터)
  const keys = (["lunch", "triple", "sameDay"] as const).filter((k) => w[k] > 0);
  const items: NonNullable<BoundReport["items"]> = {};
  let itemSum = 0;
  const phaseEnd = Date.now() + run.budgetMs * ITEM_PHASE;
  for (let i = 0; i < keys.length; i++) {
    if (run.shouldStop?.()) break;
    const k = keys[i];
    const restWeight = keys.slice(i).reduce((a, x) => a + w[x], 0);
    const budget = Math.max(1000, ((phaseEnd - Date.now()) * w[k]) / restWeight);
    run.onProgress?.(`이론상 최선: ${k === "lunch" ? "점심 연강" : k === "triple" ? "3연강" : "같은 날 교과"} 최소 건수 계산 중`);
    const m = buildModel(run.inst, { weights: { lunch: 0, triple: 0, sameDay: 0, [k]: 1 } });
    const r = await solveModel(m, { budgetMs: budget, shouldStop: run.shouldStop });
    const exact = r.status === "optimal" && r.objective !== null;
    const min = exact ? Math.round(r.objective!) : r.lowerBound === null ? 0 : Math.max(0, Math.ceil(r.lowerBound - 1e-6));
    items[k] = { min, exact };
    itemSum += min * w[k];
    publish(itemSum);
  }

  // 2) 전체 정수계획 (찾은 점수가 지금까지의 하한과 같으면 최선 증명 → 끝)
  run.onProgress?.("이론상 최선 계산 중 (전체)");
  let bestSeen: number | null = null;
  const r = left() > 2000 && !run.shouldStop?.()
    ? await runMilp({
        input: run.input,
        inst: run.inst,
        budgetMs: left(),
        seed: run.seed,
        shouldStop: () => Boolean(run.shouldStop?.()) || (bestSeen !== null && bestSeen <= shown),
        exact: true,
        progressEveryMs: 3000,
        onProgress: (p) => {
          if (p.bestScore !== null) bestSeen = bestSeen === null ? p.bestScore : Math.min(bestSeen, p.bestScore);
          if (p.lowerBound !== null) publish(Math.max(0, Math.ceil(p.lowerBound - 1e-6)));
        },
      })
    : null;
  const milpLb = r?.lowerBound == null ? null : Math.max(0, Math.ceil(r.lowerBound - 1e-6));
  const lowerBound = keys.length || milpLb !== null ? Math.max(itemSum, milpLb ?? 0) : null;
  const best = r?.results[0]?.metrics.score ?? null;
  return {
    lowerBound,
    best,
    proven: lowerBound !== null && best !== null && best <= lowerBound,
    items,
    itemSum,
    elapsedMs: Date.now() - t0,
  };
}

// ── 4) 데이터 한계 ──

export type DataLimitItem = { min: Range; skipped: boolean };

export type DataLimitReport = {
  lunch: DataLimitItem & {
    /** 쉬운 설명용 세기: 점심 앞뒤 수업 칸 수, 교사가 하루 한 칸씩만 맡을 때 최대 칸 수 → 최소 연강 수 */
    count: { cells: number; capacity: number; bound: number; teachers: number; days: number };
  };
  triple: DataLimitItem;
  sameDay: DataLimitItem;
  elapsedMs: number;
};

/**
 * 점심 연강 세기 하한: 점심 앞뒤 교시(L, L+1)에 반드시 차는 반 칸 수 − 교사들이 연강 없이 맡을 수 있는 최대 칸 수.
 * 교사 한 명은 연강 없이 하루에 그 두 교시 중 한 칸만 맡을 수 있고, 일주일 동안 자기 수업 시수보다 많이 맡을 수 없다.
 */
export function lunchCountBound(inst: V3Instance) {
  const lap = inst.lunchAfter;
  const days = inst.days.filter((d) => ([1, 2, 3] as const).some((g) => (inst.periods[g][d] ?? 0) >= lap + 1));
  let cells = 0;
  for (const g of [1, 2, 3] as const) {
    const slots = gradeSlots(inst, g);
    const lunchSlots = slots.filter((s) => days.includes(s.day) && (s.period === lap || s.period === lap + 1)).length;
    for (let c = 1; c <= inst.classCounts[g]; c++) {
      const lessons = inst.groups.filter((x) => x.grade === g && x.classNo === c).reduce((a, x) => a + x.hours, 0)
        + inst.pins.filter((p) => p.grade === g && p.classNo === c).length
        + inst.sets.filter((s) => s.grade === g && s.rooms.includes(c)).reduce((a, s) => a + s.units, 0);
      // 비어도 되는 칸이 모두 점심 앞뒤로 몰려도 반드시 차는 칸 수
      cells += Math.max(0, lunchSlots - Math.max(0, slots.length - lessons));
    }
  }
  const load = new Map<string, number>();
  for (const x of inst.groups) load.set(x.teacher, (load.get(x.teacher) ?? 0) + x.hours);
  for (const p of inst.pins) load.set(p.teacher, (load.get(p.teacher) ?? 0) + 1);
  for (const s of inst.sets) for (const subj of s.subjects) for (const t of subj.teachers) load.set(t.name, (load.get(t.name) ?? 0) + (subj.rotated ? t.hours : s.units));
  const capacity = [...load.values()].reduce((a, n) => a + Math.min(n, days.length), 0);
  return { cells, capacity, bound: Math.max(0, cells - capacity), teachers: load.size, days: days.length };
}

export async function diagnoseDataLimit(run: DiagnoseRun): Promise<DataLimitReport> {
  const t0 = Date.now();
  const w = run.inst.weights;
  const items = (["lunch", "triple", "sameDay"] as const).filter((k) => w[k] > 0);
  const out: Partial<Record<"lunch" | "triple" | "sameDay", DataLimitItem>> = {};
  for (const k of ["lunch", "triple", "sameDay"] as const) {
    if (!items.includes(k)) { out[k] = { min: range(0, null), skipped: true }; continue; }
    const remaining = items.length - items.indexOf(k);
    const budget = Math.max(1000, (run.budgetMs - (Date.now() - t0)) / remaining);
    run.onProgress?.(`${k === "lunch" ? "점심 연강" : k === "triple" ? "3연강" : "동일 교과"} 최소값 계산 중`);
    const weights = { lunch: 0, triple: 0, sameDay: 0, [k]: 1 };
    const m = buildModel(run.inst, { weights });
    const r = await solveModel(m, { budgetMs: budget, shouldStop: run.shouldStop });
    const best = r.objective === null ? null : Math.round(r.objective);
    const lb = r.status === "optimal" ? best! : r.lowerBound === null ? 0 : Math.max(0, Math.ceil(r.lowerBound - 1e-6));
    out[k] = { min: range(lb, best), skipped: false };
  }
  return { lunch: { ...out.lunch!, count: lunchCountBound(run.inst) }, triple: out.triple!, sameDay: out.sameDay!, elapsedMs: Date.now() - t0 };
}
