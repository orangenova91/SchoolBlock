/**
 * 체험용 시간표(실제 학교 기반 SET 예시, lib/demo-seed-set-example.json)의
 * 교사·교과·시수를 그대로 두고 SET 배치·선 수업·배정 불가·동일 교과 금지를
 * 바꿔 가며 v2 결과를 만든다.
 *
 *   # 조건 하나 → JSON (samples.ts와 같은 형식)
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/explore-demo.ts case <조건 문자열> <out.json> [초=30]
 *   # 탐색 격자 한 칸 → JSON 한 줄 (판정 + v2 결과)
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/explore-demo.ts grid <조건 문자열> [초=20]
 *
 * 조건 문자열: "set=<배치>,forbid=<0~1>,pin=<0~1>,bans=<orig|core|all>,seed=<n>"
 *   배치: original(체험용 원래 배치) | auto | avoidLunch | lunch | random | spread | concentrated | diagonal
 */
import { writeFileSync } from "node:fs";
import demo from "@/lib/demo-seed-set-example.json";
import { autoPlacePartialSets, autoPlaceWholeSets } from "@/lib/set-blocks-auto";
import {
  catalogGradeSets,
  homeRoomsForPartialSet,
  recommendSubjectRotations,
  setTeacherShares,
  subjectsNeedingRotation,
  teachersBusyForGradeSetAtSlot,
} from "@/lib/set-blocks";
import { runPlacementCheck } from "@/lib/timetable-exact-check";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import { buildSeedTimetableCells, expandCommonLessons } from "@/lib/timetable";
import type { FeasibilityInput } from "@/lib/timetable-feasibility";
import {
  GRADES,
  WEEKDAYS,
  type GenerationPreferences,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type SetTeacherAssignment,
  type SubjectBlockCell,
  type Teacher,
  type TeacherForbiddenSlot,
  type Weekday,
} from "@/lib/types";
import { DEFAULT_V2_WEIGHTS } from "@/lib/v2-weights";
import type { SampleResult } from "./samples";
import { placeSetsByStrategy, type SetPlacement } from "./school";

const DAYS = WEEKDAYS.map((d) => d.key) as Weekday[];

export type DemoCase = {
  set: "original" | SetPlacement;
  forbid: number;
  pin: number;
  bans: "orig" | "core" | "all";
  seed: number;
};

export function parseCase(text: string): DemoCase {
  const kv = Object.fromEntries(text.split(",").map((p) => p.split("=")));
  return {
    set: (kv.set ?? "original") as DemoCase["set"],
    forbid: Number(kv.forbid ?? 0),
    pin: Number(kv.pin ?? 0),
    bans: (kv.bans ?? "all") as DemoCase["bans"],
    seed: Number(kv.seed ?? 1),
  };
}

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SET 위치가 정해진 뒤 순환 과목의 교시별 담당 교사를 앱 추천 1순위로 정한다. */
export function assignRotations(
  teachers: Teacher[],
  catalog: ReturnType<typeof catalogGradeSets>,
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
): SetTeacherAssignment[] {
  const assignments: SetTeacherAssignment[] = [];
  for (const info of catalog) {
    const slots = [...wholeCells, ...partialCells]
      .filter((c) => c.grade === info.grade && c.set === info.set)
      .map((c) => ({ day: c.day, period: c.period }));
    for (const { subjectName, shares } of subjectsNeedingRotation(teachers, info)) {
      const best = recommendSubjectRotations({ teachers, catalog, wholeCells, partialCells, assignments, grade: info.grade, set: info.set, shares, slots, limit: 1 })[0];
      if (!best) continue;
      slots.forEach((slot, i) => assignments.push({ grade: info.grade, set: info.set, day: slot.day, period: slot.period, subjectName, teacherName: best.teacherNames[i] }));
    }
  }
  void setTeacherShares;
  return assignments;
}

export function buildDemoCase(c: DemoCase): { input: FeasibilityInput; preferences: GenerationPreferences; setOk: boolean } {
  const rand = rng(c.seed * 7919 + Math.round(c.forbid * 1000) * 31 + Math.round(c.pin * 1000));
  const teachers = demo.teachers as unknown as Teacher[];
  const subjects = demo.subjects as unknown as GradeSubjects;
  const classCounts = demo.daySchedule.classCounts as unknown as GradeClassCounts;
  const schedules = demo.daySchedule.grades as unknown as GradeDaySchedules;
  const catalog = catalogGradeSets(subjects, classCounts);
  const lap = demo.preferences.lunchAfterPeriod;

  // ── SET 배치 ──
  let wholeCells = demo.setBlocks.cells as unknown as SetBlockCell[];
  let partialCells = demo.setBlocks.partialCells as unknown as SetBlockCell[];
  let teacherAssignments = demo.setBlocks.teacherAssignments as unknown as SetTeacherAssignment[];
  let setOk = true;
  if (c.set === "auto") {
    const whole = autoPlaceWholeSets({ cells: [], partialCells: [], catalog, teachers, schedules, classCounts, lunchAfterPeriod: lap });
    const partial = autoPlacePartialSets({ wholeCells: whole.cells, partialCells: [], catalog, teachers, schedules, classCounts, assignments: whole.assignments, lunchAfterPeriod: lap });
    wholeCells = whole.cells;
    partialCells = partial.cells;
    teacherAssignments = [...whole.assignments, ...partial.assignments];
    setOk = whole.unplaced.length === 0 && partial.unplaced.length === 0;
  } else if (c.set !== "original") {
    const placed = placeSetsByStrategy(c.set, catalog, teachers, schedules, classCounts, rng(c.seed));
    wholeCells = placed.whole;
    partialCells = placed.partial;
    setOk = placed.ok;
    teacherAssignments = assignRotations(teachers, catalog, wholeCells, partialCells);
  }

  // ── 고정 점유 ──
  const classBusy = new Set<string>();
  const teacherBusy = new Set<string>();
  for (const cell of [...wholeCells, ...partialCells]) {
    const info = catalog.find((x) => x.grade === cell.grade && x.set === cell.set)!;
    for (const name of teachersBusyForGradeSetAtSlot(teachers, info, cell.day, cell.period, teacherAssignments)) teacherBusy.add(`${name}|${cell.day}|${cell.period}`);
    const rooms = info.kind === "partial" ? homeRoomsForPartialSet(info, classCounts[cell.grade]) : Array.from({ length: classCounts[cell.grade] }, (_, i) => i + 1);
    for (const r of rooms) classBusy.add(`${cell.grade}|${r}|${cell.day}|${cell.period}`);
  }
  const maxP = (day: Weekday) => Math.max(...GRADES.map((g) => schedules[g][day]));
  const times: { day: Weekday; period: number }[] = [];
  for (const day of DAYS) for (let p = 1; p <= maxP(day); p++) times.push({ day, period: p });
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ── 동일 교과 금지 ──
  const commonNames = (g: Grade) => subjects[g].filter((s) => s.set === "공통").map((s) => s.name);
  const lessons = expandCommonLessons(teachers, subjects, classCounts);
  const hoursOf = (g: Grade, name: string) => Math.max(0, ...lessons.filter((l) => l.grade === g && l.subjectName === name).map(() => 1)) && lessons.filter((l) => l.grade === g && l.subjectName === name && l.classNo === lessons.find((x) => x.grade === g && x.subjectName === name)!.classNo).length;
  const bans =
    c.bans === "orig"
      ? (demo.preferences.sameDaySubjectBans as { grade: Grade; subjectName: string }[])
      : GRADES.flatMap((g) =>
          commonNames(g)
            .filter((name) => (c.bans === "all" ? hoursOf(g, name) >= 2 : /국어|수학|영어|미적분|독서/.test(name)))
            .map((subjectName) => ({ grade: g, subjectName })),
        );
  const banSet = new Set(bans.map((b) => `${b.grade}|${b.subjectName}`));

  // ── 배정 불가: 교사별 빈 시간의 비율 (시수+4칸 여유는 남김) ──
  const loadOf = new Map<string, number>();
  for (const l of lessons) loadOf.set(l.teacherName, (loadOf.get(l.teacherName) ?? 0) + 1);
  const forbiddenSlots: TeacherForbiddenSlot[] = [];
  if (c.forbid > 0) {
    for (const t of teachers) {
      const free = times.filter((s) => !teacherBusy.has(`${t.name}|${s.day}|${s.period}`));
      const keep = (loadOf.get(t.name) ?? 0) + 4;
      let budget = Math.min(Math.round(free.length * c.forbid), free.length - keep);
      for (const s of shuffle(free)) {
        if (budget-- <= 0) break;
        forbiddenSlots.push({ teacherName: t.name, day: s.day, period: s.period });
        teacherBusy.add(`${t.name}|${s.day}|${s.period}`);
      }
    }
  }

  // ── 선 수업: 공통 수업의 비율을 무작위 칸에 고정 (같은 반 같은 금지 교과 같은 날, 교사 점심 연강은 피함) ──
  const subjectBlocks: SubjectBlockCell[] = [];
  if (c.pin > 0) {
    const usedDay = new Set<string>();
    for (const l of shuffle(lessons)) {
      if (rand() >= c.pin) continue;
      const options = times.filter((s) => {
        if (s.period > schedules[l.grade][s.day]) return false;
        if (classBusy.has(`${l.grade}|${l.classNo}|${s.day}|${s.period}`)) return false;
        if (teacherBusy.has(`${l.teacherName}|${s.day}|${s.period}`)) return false;
        if (banSet.has(`${l.grade}|${l.subjectName}`) && usedDay.has(`${l.grade}|${l.classNo}|${l.subjectName}|${s.day}`)) return false;
        const partner = s.period === lap ? lap + 1 : s.period === lap + 1 ? lap : 0;
        if (partner && teacherBusy.has(`${l.teacherName}|${s.day}|${partner}`)) return false;
        return true;
      });
      if (options.length === 0) continue;
      const s = options[Math.floor(rand() * options.length)];
      subjectBlocks.push({ grade: l.grade, classNo: l.classNo, subjectName: l.subjectName, teacherName: l.teacherName, day: s.day, period: s.period });
      classBusy.add(`${l.grade}|${l.classNo}|${s.day}|${s.period}`);
      teacherBusy.add(`${l.teacherName}|${s.day}|${s.period}`);
      usedDay.add(`${l.grade}|${l.classNo}|${l.subjectName}|${s.day}`);
    }
  }

  return {
    input: { teachers, subjects, classCounts, schedules, wholeCells, partialCells, teacherAssignments, subjectBlocks, forbiddenSlots },
    preferences: {
      avoidLunchDouble: true,
      lunchAfterPeriod: lap,
      avoidTriplePeriod: true,
      avoidSameDaySubject: bans.length > 0,
      sameDaySubjectBans: bans,
    },
    setOk,
  };
}

export function describeCase(c: DemoCase): string {
  const setName: Record<DemoCase["set"], string> = {
    original: "원래 SET 배치", auto: "SET 자동 배치", avoidLunch: "SET 점심 앞뒤 회피", lunch: "SET 점심 앞뒤 우선",
    random: "SET 무작위", spread: "SET 요일 분산", concentrated: "SET 요일 몰림", diagonal: "SET 대각선 순환",
  };
  const bans = { orig: "동일교과 원래 7개", core: "동일교과 국수영", all: "동일교과 전체" }[c.bans];
  return [setName[c.set], bans, c.forbid ? `배정불가 ${Math.round(c.forbid * 100)}%` : null, c.pin ? `선수업 ${Math.round(c.pin * 100)}%` : null]
    .filter(Boolean)
    .join(" · ");
}

async function run(c: DemoCase, seconds: number) {
  const { input, preferences, setOk } = buildDemoCase(c);
  if (!setOk) return { setOk, input, preferences };
  const check = await runPlacementCheck(input);
  const r = check.report;
  const blocked = (r.exact.minUnplaced ?? r.minUnplaced) > 0;
  if (blocked) return { setOk, input, preferences, check: r };
  const t0 = Date.now();
  const result = generateTimetableV2({
    ...input,
    subjectBlocks: input.subjectBlocks ?? [],
    pinnedSubjectBlocks: input.subjectBlocks ?? [],
    forbiddenSlots: input.forbiddenSlots ?? [],
    preferences,
    timeLimitMs: seconds * 1000,
    v2: { initialCommonCells: r.exact.status === "feasible" ? check.solutionCells : undefined },
  });
  return { setOk, input, preferences, check: r, result, sec: (Date.now() - t0) / 1000 };
}

async function main() {
  const [mode, text, a, b] = process.argv.slice(2);
  const c = parseCase(text);
  if (mode === "grid") {
    const out = await run(c, Number(a ?? 20));
    const r = out.check;
    console.log(JSON.stringify({
      case: text, setOk: out.setOk,
      pins: out.input.subjectBlocks?.length ?? 0, forbidden: out.input.forbiddenSlots?.length ?? 0, bans: out.preferences.sameDaySubjectBans.length,
      exact: r?.exact.status ?? null, minUnplaced: r ? (r.exact.minUnplaced ?? r.minUnplaced) : null, exactMs: r?.exact.elapsedMs ?? null,
      ...(out.result ? { unplaced: out.result.unplaced.reduce((s, u) => s + u.remaining, 0), lunch: out.result.lunchDoubleCount, triple: out.result.tripleRunCount, same: out.result.sameDaySubjectViolationCount, sec: out.sec } : {}),
    }));
  } else if (mode === "case") {
    const [id, file] = [a, b];
    const out = await run(c, Number(process.argv[6] ?? 30));
    const r = out.check;
    const sample: SampleResult = {
      id,
      note: describeCase(c),
      exact: r?.exact.status ?? "unknown",
      exactMin: r?.exact.minUnplaced ?? null,
      sec: Math.round((out.sec ?? 0) * 10) / 10,
      unplaced: out.result ? out.result.unplaced.reduce((s, u) => s + u.remaining, 0) : (r ? (r.exact.minUnplaced ?? r.minUnplaced) : -1),
      lunchDoubleCount: out.result?.lunchDoubleCount ?? 0,
      tripleRunCount: out.result?.tripleRunCount ?? 0,
      sameDaySubjectViolationCount: out.result?.sameDaySubjectViolationCount ?? 0,
      cells: out.result?.cells ?? [],
      message: out.result?.message ?? "배치 불가 (사전 검사)",
      input: out.input,
      preferences: out.preferences,
      weights: DEFAULT_V2_WEIGHTS,
    };
    writeFileSync(file, JSON.stringify(sample));
    console.log(JSON.stringify({ id, note: sample.note, exact: sample.exact, unplaced: sample.unplaced, lunch: sample.lunchDoubleCount, triple: sample.tripleRunCount, same: sample.sameDaySubjectViolationCount, sec: sample.sec }));
  } else {
    throw new Error("mode: grid | case");
  }
  void buildSeedTimetableCells;
  process.exit(0);
}

if (process.argv[1]?.endsWith("explore-demo.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
