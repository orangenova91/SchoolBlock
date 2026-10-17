/**
 * 정수계획 한 번 풀기 (진단용 공통). 시작 해 넣기, 시간 제한, 중지 신호, 하한 읽기를 한곳에서 처리한다.
 */
import type { V3Model } from "@/lib/v3/model";
import { createHighsModel, dualBound, getHighs, hasSolution, overMemory, HIGHS_STATUS } from "@/lib/v3/engines/highs";
import { completeVector } from "@/lib/v3/engines/milp";

export type SolveOutcome = {
  /** optimal: 최적 증명 / infeasible: 해가 없음을 증명 / limit: 시간·중지·메모리로 멈춤 */
  status: "optimal" | "infeasible" | "limit";
  x: Float64Array | null;
  /** 찾은 해의 목적값 (없으면 null) */
  objective: number | null;
  /** 증명된 하한 (없으면 null) */
  lowerBound: number | null;
  stoppedBy: "time" | "user" | "memory" | null;
};

export async function solveModel(
  m: V3Model,
  opts: { budgetMs: number; warm?: Float64Array | null; shouldStop?: () => boolean; onTick?: (lb: number | null, primal: number | null) => void },
): Promise<SolveOutcome> {
  const highs = await getHighs();
  const model = createHighsModel(highs, m);
  let stoppedBy: SolveOutcome["stoppedBy"] = null;
  try {
    model.options.set({ output_flag: false, mip_rel_gap: 0 });
    if (opts.warm) {
      const full = completeVector(model, m, opts.warm);
      if (full) model.setSolution({ colValue: full } as never);
    }
    model.zeroAllClocks();
    model.options.set("time_limit", Math.max(1, opts.budgetMs / 1000));
    const cb = highs.constants.callbackType;
    let last = 0;
    model.run({
      [cb.mipInterrupt]: (e: { data: { mip_dual_bound?: number; mip_primal_bound?: number }; interrupt: () => void }) => {
        if (opts.shouldStop?.()) { stoppedBy = "user"; e.interrupt(); }
        else if (overMemory()) { stoppedBy = "memory"; e.interrupt(); }
        const t = Date.now();
        if (opts.onTick && t - last > 1000) {
          last = t;
          const db = e.data.mip_dual_bound, pb = e.data.mip_primal_bound;
          opts.onTick(typeof db === "number" && Number.isFinite(db) ? db : null, typeof pb === "number" && Number.isFinite(pb) ? pb : null);
        }
        return undefined;
      },
    } as never);
    const st = model.getModelStatus();
    const has = hasSolution(model);
    const x = has ? Float64Array.from(model.getSolution().colValue) : null;
    const objective = has ? model.getObjectiveValue() : null;
    if (st === HIGHS_STATUS.optimal && has) return { status: "optimal", x, objective, lowerBound: objective, stoppedBy: null };
    if (st === HIGHS_STATUS.infeasible) return { status: "infeasible", x: null, objective: null, lowerBound: null, stoppedBy: null };
    return { status: "limit", x, objective, lowerBound: dualBound(model), stoppedBy: stoppedBy ?? "time" };
  } finally {
    model.dispose();
  }
}
