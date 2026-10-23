/**
 * 시나리오 하나를 실제 v2 경로대로 측정한다.
 *   사전 검사(빠른 검사 + 정확 판정) → 배치 가능하면 v2 생성 N회
 * 결과는 JSON 한 줄씩 출력한다 (kind: meta / check / run).
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/run.ts <시나리오id> [반복=3]
 */
import { runPlacementCheck } from "@/lib/timetable-exact-check";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import { SCENARIOS } from "./scenarios";
import { buildSchool } from "./school";

function stopReason(message: string): string {
  if (message.includes("위반 0건")) return "zero";
  if (message.includes("더 나아지지 않아")) return "stall";
  if (message.includes("시간 상한")) return "timeout";
  return "other";
}

async function main() {
  const id = process.argv[2];
  const repeat = Number(process.argv[3] ?? 3);
  const spec = SCENARIOS.find((x) => x.id === id);
  if (!spec) throw new Error(`unknown scenario: ${id}`);

  const builtAt = Date.now();
  const school = buildSchool(spec);
  const emit = (o: object) => console.log(JSON.stringify({ id, ...o }));
  emit({ kind: "meta", axis: spec.axis, label: spec.label, buildMs: Date.now() - builtAt, ...school.meta });
  if (!school.meta.setPlaced) {
    emit({ kind: "check", skipped: "SET 배치 실패" });
    return;
  }

  const t0 = Date.now();
  const check = await runPlacementCheck(school.input);
  const r = check.report;
  emit({
    kind: "check",
    totalMs: Date.now() - t0,
    quickMs: r.elapsedMs - r.exact.elapsedMs,
    quickMin: r.minUnplaced,
    exactStatus: r.exact.status,
    exactMin: r.exact.minUnplaced,
    exactMs: r.exact.elapsedMs,
    lessons: r.lessonCount,
    log10Estimate: r.estimate ? Math.round(r.estimate.log10Estimate) : null,
  });
  const blocked = (r.exact.minUnplaced ?? r.minUnplaced) > 0;
  if (blocked) return;

  for (let i = 0; i < repeat; i++) {
    const g0 = Date.now();
    const result = generateTimetableV2({
      ...school.input,
      subjectBlocks: school.input.subjectBlocks ?? [],
      pinnedSubjectBlocks: school.input.subjectBlocks ?? [],
      forbiddenSlots: school.input.forbiddenSlots ?? [],
      preferences: school.preferences,
      timeLimitMs: 30_000,
      v2: {
        initialCommonCells: r.exact.status === "feasible" ? check.solutionCells : undefined,
      },
    });
    emit({
      kind: "run",
      run: i,
      sec: Math.round((Date.now() - g0) / 100) / 10,
      unplaced: result.unplaced.reduce((s, u) => s + u.remaining, 0),
      lunch: result.lunchDoubleCount,
      triple: result.tripleRunCount,
      sameDay: result.sameDaySubjectViolationCount,
      stop: stopReason(result.message),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
