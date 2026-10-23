import {
  catalogGradeSets,
  findGradeSet,
  teachersBusyForGradeSetAtSlot,
} from "@/lib/set-blocks";
import { consumeLessonsForSubjectBlocks } from "@/lib/subject-blocks";
import {
  buildSeedTimetableCells,
  expandCommonLessons,
  type CommonLesson,
} from "@/lib/timetable";
import {
  GRADES,
  WEEKDAYS,
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

/**
 * v2 전용 미배치 사전 검사.
 *
 * 1) 최소 미배치 수 (정확한 하한)
 *    공통 수업 → 칸 배정을 두 가지로 완화해 각각 이분 매칭(최대 매칭)으로 푼다.
 *    - 반 기준: 반마다 "남은 수업 ↔ 그 반의 빈칸 중 담당 교사도 비어 있는 칸".
 *    - 교사 기준: 교사마다 "남은 수업 ↔ 그 교사의 빈 시간 중 해당 반도 빈 시간".
 *    완화 문제에서도 짝이 없는 수업은 실제로도 반드시 미배치이므로
 *    max(반 기준 부족 합, 교사 기준 부족 합)이 최소 미배치 수다 (König/Hall).
 *    0이어도 완전 배치가 보장되지는 않는다(필요조건).
 *
 * 2) 미배치 없이 배정 가능한 경우의 수 (근사)
 *    - 반 하나: 수업×칸 0/1 행렬 A(교사가 비어 있으면 1)의 퍼머넌트를 같은
 *      수업끼리의 순서(중복 시수 m!)로 나눈 값이 그 반의 배치 수다.
 *      상한은 Bregman–Minc 부등식 perm(A) ≤ Π(rᵢ!)^(1/rᵢ),
 *      하한은 Sinkhorn 정규화 A = D₁SD₂(S 이중확률) 후 Gurvits 부등식
 *      perm(S) ≥ Π(1−Sᵢⱼ)^(1−Sᵢⱼ) 로 구한다.
 *    - 반 사이: 반별 배치를 곱하면 "같은 교사가 같은 시간에 두 반"인 경우까지
 *      세므로 전체 상한이다. 추정치는 여기에 교사·시간마다 겹치지 않을 확률
 *      P(최대 1개 반) 을 곱한다. 확률은 S를 각 수업의 칸별 주변확률로 보고
 *      반들끼리 독립이라 가정해 계산한다(스도쿠 개수 추정과 같은 방식의
 *      독립 근사).
 *
 * 고정 칸은 생성기와 같은 `buildSeedTimetableCells`(SET·SET과 겹치지 않는
 * 선 수업)에 배정 불가를 더해 계산한다.
 */

export type FeasibilityShortfall = {
  /** 반 기준이면 "1학년 3반", 교사 기준이면 교사 이름. */
  label: string;
  /** 배치해야 하는 공통 수업 시수. */
  lessons: number;
  /** 완화 문제에서 배치 가능한 최대 시수. */
  assignable: number;
};

export type PlacementCountEstimate = {
  /** 반별 배치 수 곱의 상한 (log10, 엄밀). 전체 경우의 수의 상한이기도 하다. */
  log10Upper: number;
  /** 반별 배치 수 곱의 하한 (log10, 엄밀). 반끼리 교사 겹침은 무시한 값. */
  log10ClassLower: number;
  /** 교사 겹침까지 반영한 전체 경우의 수 추정 (log10, 근사). */
  log10Estimate: number;
  /** 교사 겹침이 없을 확률 (log10, 근사). */
  log10NoClash: number;
};

export type FeasibilityReport = {
  /** 어떤 방법으로도 피할 수 없는 최소 미배치 시수. */
  minUnplaced: number;
  classShortfall: number;
  teacherShortfall: number;
  classes: FeasibilityShortfall[];
  teachers: FeasibilityShortfall[];
  lessonCount: number;
  /** 최소 미배치가 0일 때만 계산한다. */
  estimate: PlacementCountEstimate | null;
  elapsedMs: number;
};

export type FeasibilityInput = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  teacherAssignments?: SetTeacherAssignment[];
  /** 사용자가 칠한 선 수업. */
  subjectBlocks?: SubjectBlockCell[];
  forbiddenSlots?: TeacherForbiddenSlot[];
};

const DAY_KEYS = WEEKDAYS.map(({ key }) => key);
const LOG10E = Math.LOG10E;

function classKey(grade: Grade, classNo: number, day: Weekday, period: number) {
  return `${grade}:${classNo}:${day}:${period}`;
}

function teacherKey(name: string, day: Weekday, period: number) {
  return `${name}:${day}:${period}`;
}

function logFactorial(n: number): number {
  let sum = 0;
  for (let k = 2; k <= n; k++) sum += Math.log(k);
  return sum;
}

/** 왼쪽 정점별 인접 오른쪽 정점 목록에서 최대 매칭 크기 (Kuhn). */
function maxMatching(adjacency: number[][], rightCount: number): number {
  const matchOfRight = new Int32Array(rightCount).fill(-1);
  let size = 0;
  for (let left = 0; left < adjacency.length; left++) {
    const seen = new Uint8Array(rightCount);
    const tryAugment = (u: number): boolean => {
      for (const v of adjacency[u]) {
        if (seen[v]) continue;
        seen[v] = 1;
        if (matchOfRight[v] < 0 || tryAugment(matchOfRight[v])) {
          matchOfRight[v] = u;
          return true;
        }
      }
      return false;
    };
    if (tryAugment(left)) size += 1;
  }
  return size;
}

export type SeedState = {
  classBusy: Set<string>;
  teacherBusy: Set<string>;
  remaining: CommonLesson[];
};

/** 생성기와 같은 규칙으로 고정 칸·교사 점유·남은 공통 수업을 만든다. */
export function buildSeedState(input: FeasibilityInput): SeedState {
  const { teachers, subjects, classCounts } = input;
  const teacherAssignments = input.teacherAssignments ?? [];
  const seed = buildSeedTimetableCells({
    ...input,
    teacherAssignments,
    subjectBlocks: input.subjectBlocks ?? [],
  });

  const classBusy = new Set<string>();
  const teacherBusy = new Set<string>();
  const keptBlocks: SubjectBlockCell[] = [];
  for (const cell of seed) {
    classBusy.add(classKey(cell.grade, cell.classNo, cell.day, cell.period));
    for (const name of cell.teacherName.split("·")) {
      if (name && name !== "—") teacherBusy.add(teacherKey(name.trim(), cell.day, cell.period));
    }
    if (cell.kind === "common") keptBlocks.push(cell);
  }
  // 순환 SET 과목은 칸마다 담당 교사가 정해지므로 생성기와 같은 함수로 묶는다.
  const catalog = catalogGradeSets(subjects, classCounts);
  for (const cell of [...input.wholeCells, ...input.partialCells]) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      info,
      cell.day,
      cell.period,
      teacherAssignments,
    )) {
      teacherBusy.add(teacherKey(name, cell.day, cell.period));
    }
  }
  for (const f of input.forbiddenSlots ?? []) {
    teacherBusy.add(teacherKey(f.teacherName, f.day, f.period));
  }

  const { remaining } = consumeLessonsForSubjectBlocks(
    expandCommonLessons(teachers, subjects, classCounts),
    keptBlocks,
  );
  return { classBusy, teacherBusy, remaining };
}

type ClassProblem = {
  grade: Grade;
  classNo: number;
  lessons: CommonLesson[];
  slots: { day: Weekday; period: number }[];
  /** lessons[i]가 들어갈 수 있는 slots 인덱스 목록. */
  adjacency: number[][];
};

export function checkPlacementFeasibility(
  input: FeasibilityInput,
): FeasibilityReport {
  const startedAt = Date.now();
  const { classCounts, schedules } = input;
  const { classBusy, teacherBusy, remaining } = buildSeedState(input);

  // ── 반 기준 ──
  const byClass = new Map<string, CommonLesson[]>();
  for (const lesson of remaining) {
    const key = `${lesson.grade}:${lesson.classNo}`;
    const list = byClass.get(key);
    if (list) list.push(lesson);
    else byClass.set(key, [lesson]);
  }
  const problems: ClassProblem[] = [];
  const classes: FeasibilityShortfall[] = [];
  let classShortfall = 0;
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= classCounts[grade]; classNo++) {
      const lessons = byClass.get(`${grade}:${classNo}`) ?? [];
      if (lessons.length === 0) continue;
      const slots: { day: Weekday; period: number }[] = [];
      for (const day of DAY_KEYS) {
        for (let period = 1; period <= (schedules[grade][day] ?? 0); period++) {
          if (!classBusy.has(classKey(grade, classNo, day, period))) {
            slots.push({ day, period });
          }
        }
      }
      const adjacency = lessons.map((lesson) => {
        const edges: number[] = [];
        slots.forEach((slot, index) => {
          if (!teacherBusy.has(teacherKey(lesson.teacherName, slot.day, slot.period))) {
            edges.push(index);
          }
        });
        return edges;
      });
      problems.push({ grade, classNo, lessons, slots, adjacency });
      const assignable = maxMatching(adjacency, slots.length);
      if (assignable < lessons.length) {
        classShortfall += lessons.length - assignable;
        classes.push({
          label: `${grade}학년 ${classNo}반`,
          lessons: lessons.length,
          assignable,
        });
      }
    }
  }

  // ── 교사 기준 ──
  const teacherRows: FeasibilityShortfall[] = [];
  let teacherShortfall = 0;
  const times: { day: Weekday; period: number }[] = [];
  for (const day of DAY_KEYS) {
    const maxPeriod = Math.max(0, ...GRADES.map((g) => schedules[g][day] ?? 0));
    for (let period = 1; period <= maxPeriod; period++) times.push({ day, period });
  }
  const byTeacher = new Map<string, CommonLesson[]>();
  for (const lesson of remaining) {
    const list = byTeacher.get(lesson.teacherName);
    if (list) list.push(lesson);
    else byTeacher.set(lesson.teacherName, [lesson]);
  }
  for (const [name, lessons] of byTeacher) {
    const adjacency = lessons.map((lesson) => {
      const edges: number[] = [];
      times.forEach(({ day, period }, index) => {
        if (period > (schedules[lesson.grade][day] ?? 0)) return;
        if (teacherBusy.has(teacherKey(name, day, period))) return;
        if (classBusy.has(classKey(lesson.grade, lesson.classNo, day, period))) return;
        edges.push(index);
      });
      return edges;
    });
    const assignable = maxMatching(adjacency, times.length);
    if (assignable < lessons.length) {
      teacherShortfall += lessons.length - assignable;
      teacherRows.push({ label: name, lessons: lessons.length, assignable });
    }
  }

  const minUnplaced = Math.max(classShortfall, teacherShortfall);
  return {
    minUnplaced,
    classShortfall,
    teacherShortfall,
    classes,
    teachers: teacherRows,
    lessonCount: remaining.length,
    estimate: minUnplaced === 0 ? estimatePlacementCount(problems) : null,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * 반 하나의 배치 수(로그)와, 수업별 칸 주변확률 S를 계산한다.
 *
 * n개 수업, m개 빈칸(n ≤ m)인 직사각 행렬은 빈칸 몫으로 "모든 칸에 1인"
 * 가상 행 m−n개를 덧붙여 정사각 B로 만든다. perm(B) = perm(A)·(m−n)!.
 */
function classPermanent(problem: ClassProblem): {
  logUpper: number;
  logLower: number;
  marginals: Float64Array[];
} {
  const n = problem.lessons.length;
  const m = problem.slots.length;
  const rows: number[][] = [
    ...problem.adjacency,
    ...Array.from({ length: m - n }, () => Array.from({ length: m }, (_, j) => j)),
  ];

  // Bregman–Minc 상한
  let logUpper = 0;
  for (const row of rows) {
    if (row.length > 0) logUpper += logFactorial(row.length) / row.length;
  }

  // Sinkhorn: S = diag(x)·B·diag(y)
  const x = new Float64Array(m).fill(1);
  const y = new Float64Array(m).fill(1);
  for (let iter = 0; iter < 500; iter++) {
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (const j of rows[i]) s += y[j];
      x[i] = s > 0 ? 1 / s : 0;
    }
    const colSum = new Float64Array(m);
    for (let i = 0; i < m; i++) for (const j of rows[i]) colSum[j] += x[i];
    let maxDev = 0;
    for (let j = 0; j < m; j++) {
      const next = colSum[j] > 0 ? 1 / colSum[j] : 0;
      maxDev = Math.max(maxDev, Math.abs(colSum[j] * y[j] - 1));
      y[j] = next;
    }
    if (maxDev < 1e-9) break;
  }

  // Gurvits: perm(S) ≥ Π (1−Sᵢⱼ)^(1−Sᵢⱼ)
  let logPermS = 0;
  const marginals: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(m);
    for (const j of rows[i]) {
      const s = Math.min(1, x[i] * y[j]);
      row[j] = s;
      if (s < 1) logPermS += (1 - s) * Math.log(1 - s);
    }
    if (i < n) marginals.push(row);
  }
  let logScale = 0;
  for (let i = 0; i < m; i++) if (x[i] > 0) logScale += Math.log(x[i]);
  for (let j = 0; j < m; j++) if (y[j] > 0) logScale += Math.log(y[j]);
  const logLower = logPermS - logScale;

  // 가상 행(빈칸) 순서와 같은 수업끼리의 순서는 같은 시간표다.
  const dup = new Map<string, number>();
  for (const lesson of problem.lessons) {
    const key = `${lesson.teacherName}|${lesson.subjectName}`;
    dup.set(key, (dup.get(key) ?? 0) + 1);
  }
  let logSame = logFactorial(m - n);
  for (const count of dup.values()) logSame += logFactorial(count);

  return {
    logUpper: logUpper - logSame,
    logLower: Math.min(logLower, logUpper) - logSame,
    marginals,
  };
}

function estimatePlacementCount(problems: ClassProblem[]): PlacementCountEstimate {
  let logUpper = 0;
  let logLower = 0;
  // 교사 → 시간 → [반별 그 교사가 그 시간에 수업할 확률]
  const usage = new Map<string, Map<string, number[]>>();
  for (const problem of problems) {
    const { logUpper: up, logLower: low, marginals } = classPermanent(problem);
    logUpper += up;
    logLower += low;
    const perTeacher = new Map<string, Map<string, number>>();
    problem.lessons.forEach((lesson, i) => {
      let times = perTeacher.get(lesson.teacherName);
      if (!times) {
        times = new Map();
        perTeacher.set(lesson.teacherName, times);
      }
      marginals[i].forEach((p, j) => {
        if (p <= 0) return;
        const { day, period } = problem.slots[j];
        const key = `${day}:${period}`;
        times!.set(key, (times!.get(key) ?? 0) + p);
      });
    });
    for (const [name, times] of perTeacher) {
      let byTime = usage.get(name);
      if (!byTime) {
        byTime = new Map();
        usage.set(name, byTime);
      }
      for (const [key, p] of times) {
        const list = byTime.get(key);
        const q = Math.min(1, p);
        if (list) list.push(q);
        else byTime.set(key, [q]);
      }
    }
  }

  // 교사·시간마다 P(최대 1개 반) = Π(1−q) + Σ q·Π_{다른 반}(1−q)
  let logNoClash = 0;
  for (const byTime of usage.values()) {
    for (const qs of byTime.values()) {
      if (qs.length < 2) continue;
      let none = 1;
      for (const q of qs) none *= 1 - q;
      let exactlyOne = 0;
      for (let a = 0; a < qs.length; a++) {
        let prod = qs[a];
        for (let b = 0; b < qs.length; b++) if (b !== a) prod *= 1 - qs[b];
        exactlyOne += prod;
      }
      logNoClash += Math.log(Math.max(1e-300, none + exactlyOne));
    }
  }

  return {
    log10Upper: logUpper * LOG10E,
    log10ClassLower: logLower * LOG10E,
    log10Estimate: (logLower + logNoClash) * LOG10E,
    log10NoClash: logNoClash * LOG10E,
  };
}

/** 생성 후: 실제 미배치 중 조건상 피할 수 없는 몫과 탐색 한계 몫을 나눠 설명. */
export function explainUnplaced(
  unplacedCount: number,
  report: FeasibilityReport,
): string {
  if (unplacedCount === 0) return "";
  const { minUnplaced } = report;
  if (minUnplaced >= unplacedCount) {
    return `사후 검사: 미배치 ${unplacedCount}교시는 현재 조건에서 피할 수 없습니다(최소 ${minUnplaced}교시). 다시 시도해도 줄지 않으니 선 수업·배정 불가·SET 배치를 조정해 주세요.`;
  }
  if (minUnplaced > 0) {
    return `사후 검사: 미배치 ${unplacedCount}교시 중 최소 ${minUnplaced}교시는 현재 조건에서 피할 수 없고, 나머지 ${unplacedCount - minUnplaced}교시는 다시 시도하면 줄어들 수 있습니다.`;
  }
  return `사후 검사: 조건상으로는 모두 배치할 자리가 있습니다. 미배치 ${unplacedCount}교시는 다시 시도하면 배치될 수 있습니다.`;
}

/** 10^x 를 "약 3.2 × 10^45" 형태로. */
export function formatPowerOfTen(log10: number): string {
  if (!Number.isFinite(log10)) return "-";
  if (log10 < 0) return "1 미만";
  const exponent = Math.floor(log10);
  const mantissa = Math.pow(10, log10 - exponent);
  if (exponent < 4) return Math.round(Math.pow(10, log10)).toLocaleString("ko-KR");
  return `약 ${mantissa.toFixed(1)} × 10^${exponent}`;
}
