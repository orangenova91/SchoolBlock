/**
 * 계산 시간 안내용 측정 (2026-10-19). 사례 하나 × 방법 하나를 돌려 JSON 한 줄을 출력한다.
 *   방법: bound(이론상 최선) | search | milp | hybrid
 *   사례: cases.ts 의 이름·조건 문자열, 또는 term:<학기ID> (DB의 시간표)
 * usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/timing.ts <이름> <사례> <방법> <예산ms> [하한]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { MongoClient } from "mongodb";
import { diagnoseBound } from "@/lib/v3/diagnose";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import type { EngineOutcome, EngineProgress, EngineRun } from "@/lib/v3/engines/types";
import { loadV3Input, type V3Input } from "@/lib/v3/input";
import { buildInstance, gradeSlots } from "@/lib/v3/instance";
import { nearThreshold, strictThreshold } from "@/lib/v3/score";
import { loadV3Case } from "./cases";

async function loadInput(spec: string): Promise<V3Input> {
  if (!spec.startsWith("term:")) return loadV3Case(spec);
  const c = await new MongoClient(process.env.MONGODB_URI!).connect();
  try {
    return await loadV3Input(c.db(), spec.slice(5));
  } finally {
    await c.close();
  }
}

async function main() {
  const [name, spec, method, budgetText, lbText] = process.argv.slice(2);
  const budgetMs = Number(budgetText);
  const input = await loadInput(spec);
  const inst = buildInstance(input);
  const classes = inst.classCounts[1] + inst.classCounts[2] + inst.classCounts[3];
  const lessons = inst.groups.reduce((a, g) => a + g.hours, 0) + inst.pins.length + inst.sets.reduce((a, s) => a + s.units * s.rooms.length, 0);
  const size = {
    classes,
    teachers: input.teachers.length,
    lessons,
    slots: ([1, 2, 3] as const).map((g) => gradeSlots(inst, g).length),
    sets: inst.sets.length,
    forbidden: inst.forbidden.size,
    pins: inst.pins.length,
    fixedSet: inst.sets.reduce((a, s) => a + s.fixed.length, 0),
  };
  const t0 = Date.now();
  if (method === "bound") {
    const timeline: [number, number][] = [];
    const r = await diagnoseBound({ input, inst, budgetMs, seed: 1, onBound: (lb) => timeline.push([Date.now() - t0, lb]) });
    console.log(JSON.stringify({ name, method, size, lowerBound: r.lowerBound, proven: r.proven, best: r.best, items: r.items, timeline, ms: Date.now() - t0 }));
    return;
  }
  const lb = lbText ? Number(lbText) : null;
  const strict = lb === null ? null : strictThreshold(lb);
  const near = lb === null ? null : nearThreshold(lb);
  let tFirst: number | null = null, tNear: number | null = null, tStrict: number | null = null, tBest: number | null = null, best: number | null = null;
  const onProgress = (p: EngineProgress) => {
    const t = Date.now() - t0;
    if (p.bestScore === null) return;
    if (tFirst === null) tFirst = t;
    if (best === null || p.bestScore < best) { best = p.bestScore; tBest = t; }
    if (near !== null && tNear === null && p.bestScore <= near) tNear = t;
    if (strict !== null && tStrict === null && p.bestScore <= strict) tStrict = t;
  };
  const run: EngineRun = { input, inst, budgetMs, seed: 1, lowerBound: lb, assumeZeroBound: true, goal: "strict", onProgress, progressEveryMs: 1000 };
  const out: EngineOutcome = method === "search" ? runSearch(run) : method === "milp" ? await runMilp(run) : await runHybrid(run);
  const final = out.results[0]?.metrics.score ?? null;
  // 진행 보고 사이에 끝난 경우를 결과로 보정
  if (final !== null && (best === null || final < best)) { best = final; tBest = Date.now() - t0; }
  if (final !== null && tFirst === null) tFirst = Date.now() - t0;
  if (final !== null && near !== null && tNear === null && final <= near) tNear = Date.now() - t0;
  if (final !== null && strict !== null && tStrict === null && final <= strict) tStrict = Date.now() - t0;
  console.log(JSON.stringify({
    name, method, size, lb, near, strict,
    tFirst, tNear, tStrict, tBest, best,
    results: out.results.map((r) => r.metrics.score),
    unplaced: out.results.length ? 0 : out.bestIncomplete?.unplaced ?? null,
    stop: out.stopReason, ms: Date.now() - t0,
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ name: process.argv[2], method: process.argv[4], error: String(e) }));
  process.exit(1);
});
