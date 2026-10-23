/**
 * 비교용 샘플 시간표 만들기: 시간표 하나(학기)의 1단계 설정(학반·요일)을 읽어
 * 교사·교과·SET을 생성하고, 조건별로 v2 결과를 만들어 그 시간표의 확정 버전
 * (메모에 조건 이름)으로 저장한다.
 *
 *   # 1) 조건 하나 계산 → JSON
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/samples.ts compute <termId> <조건id> <out.json>
 *   # 2) 계산 결과들을 시간표에 저장 (입력 데이터 + 작업본 + 확정 버전)
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/samples.ts write <termId> <결과폴더>
 *
 * 입력 데이터(교사·교과·SET·추가 조건)와 작업본은 기준 조건(s01)으로 저장한다.
 * 다른 조건은 확정 버전(시간표 칸 + 진단 수치)으로만 남는다.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { ObjectId } from "mongodb";
import { runPlacementCheck } from "@/lib/timetable-exact-check";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import {
  listLunchTeacherDoubles,
  listSameDaySubjectViolations,
  listTeacherTripleRuns,
} from "@/lib/timetable";
import type { GradeDaySchedules, GradeClassCounts, TimetableCell } from "@/lib/types";
import { DEFAULT_V2_WEIGHTS, type V2Weights } from "@/lib/v2-weights";
import { buildSchool, type SchoolSpec } from "./school";

config({ path: ".env.local", quiet: true });

export type SampleCondition = {
  id: string;
  note: string;
  patch: Partial<SchoolSpec>;
  weights?: V2Weights;
};

export const SAMPLE_CONDITIONS: SampleCondition[] = [
  { id: "s01", note: "기준 · SET 자동 배치(현재 기능)", patch: { setPlacement: "auto" } },
  { id: "s02", note: "SET 점심 앞뒤 회피", patch: { setPlacement: "avoidLunch" } },
  { id: "s03", note: "SET 점심 앞뒤 우선", patch: { setPlacement: "lunch" } },
  { id: "s04", note: "SET 무작위 배치", patch: { setPlacement: "random" } },
  { id: "s05", note: "SET 요일 고르게 분산", patch: { setPlacement: "spread" } },
  { id: "s06", note: "SET 특정 요일 몰림", patch: { setPlacement: "concentrated" } },
  { id: "s07", note: "SET 대각선 순환(실제 학교 예시 유사)", patch: { setPlacement: "diagonal" } },
  { id: "c09", note: "SET 자동 · 배정 불가 무작위 15%", patch: { forbidden: [{ kind: "random", rate: 0.15 }] } },
  { id: "c10", note: "SET 자동 · 교사 25% 요일 하나 불가", patch: { forbidden: [{ kind: "dayOff", share: 0.25 }] } },
  { id: "c11", note: "SET 자동 · 선 수업 10%", patch: { pinRate: 0.1 } },
  { id: "c12", note: "SET 자동 · 동일 교과 금지 전 교과", patch: { bans: "all" } },
  { id: "c13", note: "SET 자동 · 가중치 점심 연강 10", patch: {}, weights: { lunch: 10, triple: 2, sameDay: 3 } },
  { id: "c14", note: "SET 자동 · 가중치 3연강 10", patch: {}, weights: { lunch: 3, triple: 10, sameDay: 3 } },
  { id: "c15", note: "SET 자동 · SET 비중 높음(2학년 50%, 3학년 75%)", patch: { setProfile: "high" } },
];

export type SampleResult = {
  id: string;
  note: string;
  exact: string;
  exactMin: number | null;
  sec: number;
  unplaced: number;
  lunchDoubleCount: number;
  tripleRunCount: number;
  sameDaySubjectViolationCount: number;
  cells: TimetableCell[];
  message: string;
  /** 기준 조건(s01)만: 시간표에 저장할 입력 데이터 */
  input?: ReturnType<typeof buildSchool>["input"];
  preferences?: ReturnType<typeof buildSchool>["preferences"];
  weights?: V2Weights;
};

async function loadTermSettings(termId: string) {
  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  const term = await db.collection("terms").findOne({ _id: new ObjectId(termId) });
  const schedule = await db.collection("daySchedules").findOne({ termId });
  if (!term || !schedule) throw new Error("시간표 또는 1단계(학반·요일) 설정이 없습니다.");
  return {
    db,
    term,
    classCounts: schedule.classCounts as GradeClassCounts,
    schedules: schedule.grades as GradeDaySchedules,
  };
}

export function baseSpec(classCounts: GradeClassCounts, schedules: GradeDaySchedules): SchoolSpec {
  return {
    id: "sample",
    label: "비교 샘플",
    axis: "샘플",
    seed: 20261015,
    classesPerGrade: [classCounts[1], classCounts[2], classCounts[3]],
    schedules,
    avgLoad: 16,
    setProfile: "base",
    setPlacement: "auto",
    bans: "core",
  };
}

async function compute(termId: string, conditionId: string, out: string) {
  const { classCounts, schedules } = await loadTermSettings(termId);
  const condition = SAMPLE_CONDITIONS.find((c) => c.id === conditionId);
  if (!condition) throw new Error(`unknown condition ${conditionId}`);
  const school = buildSchool({ ...baseSpec(classCounts, schedules), ...condition.patch });
  if (!school.meta.setPlaced) throw new Error("SET 배치 실패");
  const check = await runPlacementCheck(school.input);
  const r = check.report;
  const base: Omit<SampleResult, "cells" | "message" | "sec" | "unplaced" | "lunchDoubleCount" | "tripleRunCount" | "sameDaySubjectViolationCount"> = {
    id: condition.id,
    note: condition.note,
    exact: r.exact.status,
    exactMin: r.exact.minUnplaced,
  };
  if ((r.exact.minUnplaced ?? r.minUnplaced) > 0) {
    writeFileSync(out, JSON.stringify({ ...base, cells: [], message: "배치 불가 (사전 검사)", sec: 0, unplaced: r.exact.minUnplaced ?? r.minUnplaced, lunchDoubleCount: 0, tripleRunCount: 0, sameDaySubjectViolationCount: 0 }));
    return;
  }
  const weights = condition.weights ?? DEFAULT_V2_WEIGHTS;
  const t0 = Date.now();
  const result = generateTimetableV2({
    ...school.input,
    subjectBlocks: school.input.subjectBlocks ?? [],
    pinnedSubjectBlocks: school.input.subjectBlocks ?? [],
    forbiddenSlots: school.input.forbiddenSlots ?? [],
    preferences: school.preferences,
    timeLimitMs: 30_000,
    v2: { weights, initialCommonCells: r.exact.status === "feasible" ? check.solutionCells : undefined },
  });
  const sample: SampleResult = {
    ...base,
    sec: Math.round((Date.now() - t0) / 100) / 10,
    unplaced: result.unplaced.reduce((s, u) => s + u.remaining, 0),
    lunchDoubleCount: result.lunchDoubleCount,
    tripleRunCount: result.tripleRunCount,
    sameDaySubjectViolationCount: result.sameDaySubjectViolationCount,
    cells: result.cells,
    message: result.message,
    ...(condition.id === "s01" ? { input: school.input, preferences: school.preferences, weights } : {}),
  };
  writeFileSync(out, JSON.stringify(sample));
}

async function write(termId: string, dir: string, baseId = "s01") {
  const samples: SampleResult[] = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  await writeSampleResults(termId, samples, baseId);
}

/**
 * 결과들을 시간표에 저장한다. 입력 데이터·작업본은 baseId 결과로,
 * 나머지는 메모가 붙은 확정 버전으로 (id 순서).
 */
export async function writeSampleResults(
  termId: string,
  unsorted: SampleResult[],
  baseId: string,
) {
  const { db, term } = await loadTermSettings(termId);
  if (term.logicVersion !== "v2") throw new Error("v2 시간표에만 저장합니다.");
  const samples = [...unsorted]
    // SET 배치 비교(s..)를 먼저, 조건 비교(c..)를 뒤에
    .sort((a, b) => Number(a.id[0] !== "s") - Number(b.id[0] !== "s") || a.id.localeCompare(b.id));
  const base = samples.find((s) => s.id === baseId);
  if (!base?.input || !base.preferences) throw new Error(`기준 조건(${baseId}) 결과가 없습니다.`);
  const now = new Date();
  const set = <T extends object>(name: string, doc: T) =>
    db.collection(name).updateOne({ termId }, { $set: { termId, ...doc, updatedAt: now } }, { upsert: true });

  await set("daySchedules", { classCounts: base.input.classCounts, grades: base.input.schedules });
  await set("teachers", { teachers: base.input.teachers });
  await set("subjects", { subjects: base.input.subjects });
  await set("setBlocks", { cells: base.input.wholeCells, partialCells: base.input.partialCells, teacherAssignments: base.input.teacherAssignments ?? [] });
  await set("subjectBlocks", { cells: base.input.subjectBlocks ?? [] });
  await set("teacherConstraints", { forbiddenSlots: base.input.forbiddenSlots ?? [] });
  await set("generationPreferences", { ...base.preferences, v2Weights: base.weights ?? DEFAULT_V2_WEIGHTS });

  const lap = base.preferences.lunchAfterPeriod;
  const diagnostics = (cells: TimetableCell[]) => ({
    lunchDoubles: listLunchTeacherDoubles(cells, lap),
    tripleRuns: listTeacherTripleRuns(cells, lap),
    sameDaySubjectViolations: listSameDaySubjectViolations(cells, base.preferences!.sameDaySubjectBans),
  });
  await db.collection("timetables").deleteOne({ termId });
  await db.collection("timetables").insertOne({
    termId,
    status: "ready",
    cells: base.cells,
    unplaced: [],
    generatedAt: now,
    updatedAt: now,
    message: base.message,
    lunchDoubleCount: base.lunchDoubleCount,
    tripleRunCount: base.tripleRunCount,
    sameDaySubjectViolationCount: base.sameDaySubjectViolationCount,
    ...diagnostics(base.cells),
  });
  await db.collection("v2PlacementChecks").deleteOne({ termId });

  await db.collection("timetableVersions").deleteMany({ termId });
  let versionNumber = 0;
  for (const s of samples) {
    if (s.cells.length === 0 || s.unplaced > 0) {
      console.log(`${s.id} 건너뜀: ${s.message}`);
      continue;
    }
    await db.collection("timetableVersions").insertOne({
      termId,
      versionNumber: ++versionNumber,
      createdAt: new Date(now.getTime() + versionNumber),
      cells: s.cells,
      lunchDoubleCount: s.lunchDoubleCount,
      tripleRunCount: s.tripleRunCount,
      sameDaySubjectViolationCount: s.sameDaySubjectViolationCount,
      note: `${s.id} ${s.note}`,
    });
  }
  await db.collection("terms").updateOne({ _id: term._id }, { $set: { maxReachedChapter: 7 } });
  console.log(`저장 완료: 입력 데이터 + 작업본(${baseId}) + 확정 버전 ${versionNumber}개`);
}

async function main() {
  const [mode, termId, a, b] = process.argv.slice(2);
  if (mode === "compute") await compute(termId, a, b);
  else if (mode === "write") await write(termId, a, b ?? "s01");
  else throw new Error("mode: compute | write");
  process.exit(0);
}

if (process.argv[1]?.endsWith("samples.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
