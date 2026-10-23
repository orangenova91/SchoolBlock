/**
 * 측정 결과(jsonl)를 축별 표로 정리해 report.md를 만든다.
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/summarize.ts <결과폴더>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "./scenarios";

type Meta = { id: string; axis: string; label: string; classes: number; teachers: number; loadMin: number; loadAvg: number; loadMax: number; commonLessons: number; setShare: number[]; forbidden: number; pins: number; bans: number };
type Check = { id: string; skipped?: string; quickMs: number; quickMin: number; exactStatus: string; exactMin: number | null; exactMs: number; log10Estimate: number | null };
type Run = { id: string; sec: number; unplaced: number; lunch: number; triple: number; sameDay: number; stop: string };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isNaN(x) ? "-" : (Math.round(x * 10) / 10).toString());
const range = (xs: number[]) => (xs.length ? `${f1(avg(xs))} (${Math.min(...xs)}~${Math.max(...xs)})` : "-");

export function writeReport(dir: string): string {
  const metas = new Map<string, Meta>();
  const checks = new Map<string, Check>();
  const runs = new Map<string, Run[]>();
  const errors: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.startsWith("{")) {
        if (/Error/.test(line)) errors.push(`${file}: ${line.trim()}`);
        continue;
      }
      const o = JSON.parse(line);
      if (o.kind === "meta") metas.set(o.id, o);
      else if (o.kind === "check") checks.set(o.id, o);
      else if (o.kind === "run") (runs.get(o.id) ?? runs.set(o.id, []).get(o.id)!).push(o);
    }
  }

  const lines: string[] = [];
  lines.push("# v2 성능 측정 결과", "");
  lines.push(`측정 폴더: \`${dir}\` · 시나리오 ${metas.size}개`, "");
  lines.push("표기: 생성 결과는 반복 평균 (최소~최대). 정확 판정 `feasible`=미배치 없이 배치 가능(증명), `infeasible`=배치 불가(증명, 배치 차단).", "");

  const axes = [...new Set(SCENARIOS.map((s) => s.axis))];
  for (const axis of axes) {
    lines.push(`## ${axis}`, "");
    lines.push("| 시나리오 | 반 / 교사 / 교사 시수(최소·평균·최대) | 빠른 검사 | 정확 판정 | 생성 시간(초) | 종료 | 미배치 | 점심 연강 | 3연강 | 동일 교과 |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const spec of SCENARIOS.filter((s) => s.axis === axis)) {
      const m = metas.get(spec.id);
      const c = checks.get(spec.id);
      const rs = runs.get(spec.id) ?? [];
      if (!m) {
        lines.push(`| ${spec.id} | (결과 없음) | | | | | | | | |`);
        continue;
      }
      const stops = Object.entries(rs.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.stop]: (acc[r.stop] ?? 0) + 1 }), {}))
        .map(([k, v]) => `${({ stall: "정체", zero: "위반0", timeout: "30초", other: "기타" } as Record<string, string>)[k] ?? k} ${v}`)
        .join(", ");
      const exact = !c ? "-" : c.skipped ? c.skipped : `${c.exactStatus === "feasible" ? "가능" : c.exactStatus === "infeasible" ? `**불가 ${c.exactMin}**` : "미정"} · ${c.exactMs}ms`;
      lines.push(
        `| ${spec.id}<br><sub>${spec.label}</sub> | ${m.classes} / ${m.teachers} / ${m.loadMin}·${m.loadAvg}·${m.loadMax} | ${c && !c.skipped ? `${c.quickMin} · ${c.quickMs}ms` : "-"} | ${exact} | ${rs.length ? range(rs.map((r) => r.sec)) : "차단"} | ${stops || "-"} | ${rs.length ? range(rs.map((r) => r.unplaced)) : "-"} | ${rs.length ? range(rs.map((r) => r.lunch)) : "-"} | ${rs.length ? range(rs.map((r) => r.triple)) : "-"} | ${rs.length ? range(rs.map((r) => r.sameDay)) : "-"} |`,
      );
    }
    lines.push("");
  }

  // 요약
  const allRuns = [...runs.values()].flat();
  const feasible = [...checks.values()].filter((c) => c.exactStatus === "feasible");
  const infeasible = [...checks.values()].filter((c) => c.exactStatus === "infeasible");
  lines.push("## 요약", "");
  lines.push(`- 배치 가능(증명) ${feasible.length}개 · 배치 불가(증명, 차단) ${infeasible.length}개 · 판정 미정 ${[...checks.values()].filter((c) => c.exactStatus === "unknown").length}개`);
  lines.push(`- 생성 ${allRuns.length}회 중 미배치 0: ${allRuns.filter((r) => r.unplaced === 0).length}회`);
  lines.push(`- 정확 판정 시간: 최대 ${Math.max(...[...checks.values()].map((c) => c.exactMs ?? 0))}ms`);
  lines.push(`- 생성 시간: 평균 ${f1(avg(allRuns.map((r) => r.sec)))}초, 최대 ${Math.max(...allRuns.map((r) => r.sec))}초, 30초 도달 ${allRuns.filter((r) => r.stop === "timeout").length}회`);
  if (errors.length) lines.push("", "### 오류", ...errors.map((e) => `- ${e}`));
  lines.push("");

  const path = join(dir, "report.md");
  writeFileSync(path, lines.join("\n"));
  return path;
}

if (process.argv[1]?.endsWith("summarize.ts") && process.argv[2]) {
  console.log(writeReport(process.argv[2]));
}
