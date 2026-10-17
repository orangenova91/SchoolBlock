/**
 * v3 성능 측정 조건 (docs/v3-algorithm-comparison.md 의 K1~K5, 진단 F1~F9).
 *   "demo:<체험용 조건>" — scripts/v2-perf/explore-demo.ts 형식 (예: demo:bans=all,forbid=0.05,pin=0.05)
 *   "school:cls=16,load=20,set=base,partial=1,forbid=0.05,pin=0.05,seed=1" — 가상 학교
 * fix: none = SET 위치 모두 자동 / half = SET 목록의 짝수 번째를 원래 위치에 고정 (실험과 같은 규칙)
 */
import { catalogGradeSets } from "@/lib/set-blocks";
import { DEFAULT_V3_WEIGHTS, type V3Input } from "@/lib/v3/input";
import { buildDemoCase, parseCase } from "../v2-perf/explore-demo";
import { buildSchool, type SetProfile } from "../v2-perf/school";

export const NAMED: Record<string, string> = {
  K1: "demo:bans=all|none",
  K2: "demo:bans=all,forbid=0.05,pin=0.05|none",
  K3: "demo:bans=all,forbid=0.05,pin=0.05|half",
  K4: "school:cls=16,load=20,set=base,partial=1,forbid=0.05,pin=0.05,seed=1|none",
  K5: "school:cls=16,load=19,set=high,partial=1,forbid=0.05,pin=0.05,seed=1|none",
};

export function loadV3Case(spec: string): V3Input {
  const [text, fix = "none"] = (NAMED[spec] ?? spec).split("|");
  let f, preferences;
  if (text.startsWith("school:")) {
    const kv = Object.fromEntries(text.slice(7).split(",").map((p) => p.split("=")));
    const n = Number(kv.cls ?? 8);
    const b = buildSchool({
      id: text, label: text, axis: "v3", seed: Number(kv.seed ?? 1), classesPerGrade: [n, n, n], avgLoad: Number(kv.load ?? 18),
      setProfile: (kv.set ?? "base") as SetProfile, partialSet: kv.partial === "1", setPlacement: "spread",
      forbidden: Number(kv.forbid ?? 0) > 0 ? [{ kind: "random", rate: Number(kv.forbid) }] : [], pinRate: Number(kv.pin ?? 0), bans: "all",
    });
    f = b.input; preferences = b.preferences;
  } else {
    const d = buildDemoCase(parseCase(text.replace(/^demo:/, "")));
    f = d.input; preferences = d.preferences;
  }
  const catalog = catalogGradeSets(f.subjects, f.classCounts).filter((c) => c.kind !== "invalid" && c.units);
  const keep = new Set(fix === "half" ? catalog.filter((_, i) => i % 2 === 1).map((c) => `${c.grade}|${c.set}`) : []);
  const mine = (c: { grade: number; set: string }) => keep.has(`${c.grade}|${c.set}`);
  return {
    teachers: f.teachers, subjects: f.subjects, classCounts: f.classCounts, schedules: f.schedules,
    fixedWholeCells: f.wholeCells.filter(mine), fixedPartialCells: f.partialCells.filter(mine),
    teacherAssignments: (f.teacherAssignments ?? []).filter(mine),
    pins: f.subjectBlocks ?? [], forbiddenSlots: f.forbiddenSlots ?? [], preferences, weights: DEFAULT_V3_WEIGHTS,
  };
}
