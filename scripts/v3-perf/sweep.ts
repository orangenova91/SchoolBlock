/**
 * 계산 방법 비교 측정 (2026-10-19, docs/v3-timing-guide.md 2차).
 * 서비스처럼 5분 구간마다 새 프로세스에서 중단점을 이어 계산한다 (계산기 메모리도 구간마다 새로).
 * 일찍 끝내기 없이(exact) 정해진 시간을 다 쓰며, 시간에 따른 최고 점수를 기록한다.
 *
 *   부모: sweep.ts <이름> <사례> <방법> <총ms> <구간ms> <하한|-> <seed>   → JSON 한 줄
 *   방법 hybmilp: 첫 구간은 혼합, 이후 구간은 정수계획이 혼합의 중단점(최고 결과)에서 이어 계산 (B안 검토용)
 *   자식: sweep.ts --one <사례> <방법> <구간ms> <하한|-> <seed> <중단점 파일> <시작ms>
 *   하한만: sweep.ts <이름> <사례> bound <ms>
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import { diagnoseBound } from "@/lib/v3/diagnose";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import type { EngineCheckpoint, EngineOutcome, EngineRun } from "@/lib/v3/engines/types";
import { loadV3Input, type V3Input } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import { quickCheck } from "@/lib/v3/quick-check";
import { estimateMethods, summarizeSize } from "@/lib/v3/estimate";
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

/** 자식: 구간 하나 */
async function one(spec: string, method: string, segMs: number, lbText: string, seed: number, ckFile: string, startMs: number) {
  const input = await loadInput(spec);
  const inst = buildInstance(input);
  const checkpoint: EngineCheckpoint | null = existsSync(ckFile) ? JSON.parse(readFileSync(ckFile, "utf8")) : null;
  const timeline: [number, number][] = [];
  let best = Infinity;
  const t0 = Date.now();
  const run: EngineRun = {
    input, inst, budgetMs: segMs, seed, checkpoint,
    lowerBound: lbText === "-" ? null : Number(lbText),
    exact: true,
    progressEveryMs: 1000,
    onProgress: (p) => { if (p.bestScore !== null && p.bestScore < best) { best = p.bestScore; timeline.push([startMs + Date.now() - t0, best]); } },
  };
  const out: EngineOutcome = method === "search" ? runSearch(run) : method === "milp" ? await runMilp(run) : await runHybrid(run);
  const final = out.results[0]?.metrics.score;
  if (final !== undefined && final < best) timeline.push([startMs + Date.now() - t0, final]);
  writeFileSync(ckFile, JSON.stringify(out.checkpoint));
  console.log(JSON.stringify({ timeline, stop: out.stopReason, unplaced: out.results.length ? 0 : out.bestIncomplete?.unplaced ?? null, ms: Date.now() - t0 }));
}

async function main() {
  const a = process.argv.slice(2);
  if (a[0] === "--one") return one(a[1], a[2], Number(a[3]), a[4], Number(a[5]), a[6], Number(a[7]));
  const [name, spec, method, totalText, segText, lbText, seedText] = a;
  const input = await loadInput(spec);
  const inst = buildInstance(input);
  const size = summarizeSize(input, inst);
  const q = quickCheck(inst);
  const base = { name, method, size, tier: estimateMethods(size).tier, blocked: q.blocking || q.minUnplaced > 0 };
  if (method === "bound") {
    const t0 = Date.now();
    const r = await diagnoseBound({ input, inst, budgetMs: Number(totalText), seed: 1 });
    console.log(JSON.stringify({ ...base, lowerBound: r.lowerBound, proven: r.proven, best: r.best, items: r.items, ms: Date.now() - t0 }));
    return;
  }
  if (base.blocked) { console.log(JSON.stringify({ ...base, skipped: "빠른 검사 확정 불가" })); return; }
  const total = Number(totalText), seg = Number(segText), seed = Number(seedText);
  const ckFile = path.join(tmpdir(), `sweep-${name}-${method}-${seed}-${process.pid}.json`);
  const timeline: [number, number][] = [];
  const stops: string[] = [];
  let unplaced: number | null = null;
  let elapsed = 0;
  try {
    for (let i = 0; elapsed < total - 1000; i++) {
      const segMs = Math.min(seg, total - elapsed);
      const engine = method === "hybmilp" ? (i === 0 ? "hybrid" : "milp") : method;
      const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--one", spec, engine, String(segMs), lbText, String(seed * 1000 + i), ckFile, String(elapsed)], {
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env,
      });
      const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
      let o: { timeline: [number, number][]; stop: string; unplaced: number | null; ms: number };
      try { o = JSON.parse(line); } catch { stops.push(`error:${(r.stderr ?? "").slice(-200)}`); break; }
      for (const p of o.timeline) if (!timeline.length || p[1] < timeline[timeline.length - 1][1]) timeline.push(p);
      stops.push(o.stop);
      unplaced = o.unplaced;
      elapsed += segMs;
      if (o.stop === "optimal" || o.stop === "infeasible" || o.stop === "user") break;
    }
  } finally {
    if (existsSync(ckFile)) unlinkSync(ckFile);
  }
  console.log(JSON.stringify({ ...base, seed, lb: lbText === "-" ? null : Number(lbText), timeline, stops, unplaced, best: timeline.length ? timeline[timeline.length - 1][1] : null, ms: elapsed }));
}

main().catch((e) => {
  console.log(JSON.stringify({ name: process.argv[2], method: process.argv[4], error: String(e) }));
  process.exit(1);
});
