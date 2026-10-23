/**
 * v1·v2·v3 비교 (2026-10-19). 같은 학교·같은 점수 기준(v3 검증기, +α 교사 포함)으로 잰다.
 *   v1: 기존 생성 (15초, SET 위치는 앱 자동 배치 그대로)
 *   v2: 개선 생성 30초 (같은 SET 위치, 정확 판정 배치안에서 시작 — 앱 v2 생성과 같음)
 *   v3fixed: 같은 SET 위치를 모두 고정하고 혼합 5분 (계산 방식만 비교)
 *   v3free: SET 위치도 v3가 정함, 혼합 5분 (v3 본래 방식)
 * usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/compare-versions.ts <이름> <사례(demo:… / school:…)> <seed>
 */
import { runPlacementCheck } from "@/lib/timetable-exact-check";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import { generateTimetable } from "@/lib/timetable";
import type { TimetableCell } from "@/lib/types";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { buildInstance } from "@/lib/v3/instance";
import { occurrencesFromCells, validateSolution } from "@/lib/v3/validate";
import type { V3Input } from "@/lib/v3/input";
import { buildDemoCase, parseCase } from "../v2-perf/explore-demo";
import { buildSchool, type SetProfile } from "../v2-perf/school";
import { loadV3Case } from "./cases";

function appInput(text: string) {
  if (text.startsWith("school:")) {
    const kv = Object.fromEntries(text.slice(7).split(",").map((p) => p.split("=")));
    const n = Number(kv.cls ?? 8);
    const b = buildSchool({
      id: text, label: text, axis: "v3", seed: Number(kv.seed ?? 1), classesPerGrade: [n, n, n], avgLoad: Number(kv.load ?? 18),
      setProfile: (kv.set ?? "base") as SetProfile, partialSet: kv.partial === "1", setPlacement: "spread",
      forbidden: Number(kv.forbid ?? 0) > 0 ? [{ kind: "random", rate: Number(kv.forbid) }] : [], pinRate: Number(kv.pin ?? 0), bans: "all",
    });
    return { f: b.input, preferences: b.preferences };
  }
  const d = buildDemoCase(parseCase(text.replace(/^demo:/, "")));
  return { f: d.input, preferences: d.preferences };
}

function score(input: V3Input, cells: TimetableCell[]) {
  const inst = buildInstance(input);
  const v = validateSolution(input, inst, { cells, occurrences: occurrencesFromCells(input, cells, { fillAlpha: true }) });
  return { score: v.metrics.score, lunch: v.metrics.lunch, triple: v.metrics.triple, sameDay: v.metrics.sameDay, unplaced: v.unplaced, violations: v.violations.length };
}

async function v3(input: V3Input, seed: number) {
  const inst = buildInstance(input);
  const timeline: [number, number][] = [];
  const t0 = Date.now();
  let best = Infinity;
  const out = await runHybrid({ input, inst, budgetMs: 300_000, seed, exact: true, progressEveryMs: 1000,
    onProgress: (p) => { if (p.bestScore !== null && p.bestScore < best) { best = p.bestScore; timeline.push([Date.now() - t0, best]); } } });
  const r = out.results[0];
  return { best: r?.metrics.score ?? null, unplaced: r ? 0 : out.bestIncomplete?.unplaced ?? null, timeline };
}

async function main() {
  const [name, spec, seedText] = process.argv.slice(2);
  const seed = Number(seedText);
  const { f, preferences } = appInput(spec);
  const fixedInput = loadV3Case(`${spec}|all`);
  const freeInput = loadV3Case(`${spec}|none`);
  let t = Date.now();
  const r1 = generateTimetable({ ...f, subjectBlocks: f.subjectBlocks ?? [], forbiddenSlots: f.forbiddenSlots ?? [], preferences, timeLimitMs: 15_000, restarts: 24 });
  const v1 = { ...score(fixedInput, r1.cells), sec: (Date.now() - t) / 1000 };
  t = Date.now();
  const check = await runPlacementCheck(f);
  const r2 = generateTimetableV2({
    ...f, subjectBlocks: f.subjectBlocks ?? [], pinnedSubjectBlocks: f.subjectBlocks ?? [], forbiddenSlots: f.forbiddenSlots ?? [], preferences, timeLimitMs: 30_000,
    v2: { initialCommonCells: check.report.exact.status === "feasible" ? check.solutionCells : undefined },
  });
  const v2 = { ...score(fixedInput, r2.cells), sec: (Date.now() - t) / 1000, exact: check.report.exact.status };
  const v3fixed = await v3(fixedInput, seed);
  const v3free = await v3(freeInput, seed);
  const fixedSets = fixedInput.fixedWholeCells.length + fixedInput.fixedPartialCells.length;
  console.log(JSON.stringify({ name, seed, classes: f.classCounts[1] + f.classCounts[2] + f.classCounts[3], fixedSets, v1, v2, v3fixed, v3free }));
}

main().catch((e) => { console.log(JSON.stringify({ name: process.argv[2], error: String(e).slice(0, 300) })); process.exit(1); });
