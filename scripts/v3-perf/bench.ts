/**
 * v3 엔진 측정. usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/bench.ts <K1|...|조건> <search|milp|hybrid> <초> [seed] [lowerBound|-] [구간 수]
 * 구간 수 > 1 이면 시간을 나눠, 구간마다 중단점을 JSON 으로 저장했다 다시 읽어(새 프로세스와 같은 조건) 이어 돌린다.
 * 결과 한 줄(JSON): 점수·항목·미배치·검증·멈춘 이유·반복 수·메모리
 */
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import { buildInstance } from "@/lib/v3/instance";
import { validateSolution } from "@/lib/v3/validate";
import type { EngineOutcome, EngineRun } from "@/lib/v3/engines/types";
import { loadV3Case } from "./cases";

async function main() {
  const [spec, engine, secArg, seedArg, lbArg, segArg] = process.argv.slice(2);
  const input = loadV3Case(spec);
  const inst = buildInstance(input);
  const segments = Math.max(1, Number(segArg ?? 1));
  const t0 = Date.now();
  let out!: EngineOutcome;
  const starts: (number | null)[] = [];
  let checkpoint: EngineRun["checkpoint"] = null;
  for (let i = 0; i < segments; i++) {
    const run: EngineRun = { input, inst, budgetMs: (Number(secArg) * 1000) / segments, seed: Number(seedArg ?? 1) + i * 101, lowerBound: lbArg && lbArg !== "-" ? Number(lbArg) : null, checkpoint };
    if (engine === "search") out = runSearch(run);
    else if (engine === "milp") out = await runMilp(run);
    else out = await runHybrid(run);
    starts.push(checkpoint?.results[0]?.metrics.score ?? null);
    checkpoint = JSON.parse(JSON.stringify(out.checkpoint));
    if (out.stopReason === "early") break;
  }
  const top = out.results[0];
  const v = top ? validateSolution(input, inst, top.solution) : null;
  const mu = process.memoryUsage();
  console.log(JSON.stringify({
    spec, engine, segments, segStartScores: starts, sec: (Date.now() - t0) / 1000, stop: out.stopReason, iters: out.iterations,
    results: out.results.map((r) => r.metrics.score), lb: out.lowerBound, best: top?.metrics ?? null, valid: v?.ok ?? null,
    incompleteUnplaced: out.bestIncomplete?.unplaced ?? null, rssMB: Math.round(mu.rss / 1e6),
  }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
