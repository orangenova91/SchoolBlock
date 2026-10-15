import loadHighs, { type Highs } from "highs";
import {
  buildSeedState,
  checkPlacementFeasibility,
  type FeasibilityInput,
  type FeasibilityReport,
} from "@/lib/timetable-feasibility";
import {
  WEEKDAYS,
  type Grade,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

/**
 * v2 전용: 미배치 없이 배치할 수 있는지 정수계획법(MILP)으로 정확히 판정한다.
 *
 * 변수
 *   x[g,s] ∈ {0,1}  수업 묶음 g(교사·반·교과)의 1시간을 칸 s에 넣는다.
 *                  (반이 비어 있고 교사가 SET·선 수업·배정 불가로 막히지 않은
 *                  칸에만 만든다)
 *   u[g] ∈ ℤ≥0     g 중 배치하지 못한 시간 수.
 * 제약
 *   Σ_s x[g,s] + u[g] = 시수[g]
 *   반 하나의 한 칸에는 수업 1개 이하
 *   교사 한 명은 같은 요일·교시에 수업 1개 이하
 * 목표
 *   Σ u[g] 최소화
 *
 * 풀이기(HiGHS)가 "Optimal"로 끝나면 목표값이 곧 정확한 최소 미배치 수다.
 * 0이면 미배치 없는 배치안 자체도 함께 얻으므로 v2 초기 배치로 쓴다.
 */

export type ExactUnplacedLesson = {
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
  count: number;
};

export type ExactCheck = {
  /**
   * feasible: 미배치 0 배치가 존재함(증명).
   * infeasible: 최소 미배치가 1 이상임(증명).
   * unknown: 시간 제한 안에 증명하지 못했거나 풀이기 오류. 이때는 빠른
   *   검사(매칭) 결과로 판단한다.
   */
  status: "feasible" | "infeasible" | "unknown";
  /** unknown의 이유. */
  unknownReason?: "timeout" | "error";
  /** 증명된 최소 미배치 수. unknown이면 null. */
  minUnplaced: number | null;
  /** infeasible일 때 최적해에서 남는 수업 (한 가지 예). */
  unplacedLessons: ExactUnplacedLesson[];
  /** feasible일 때 공통 수업 배치안 (SET·선 수업 제외). */
  solutionCells: TimetableCell[];
  elapsedMs: number;
};

/** 정확 판정 시간 상한. 큰 학교(반 48개, 1680시수)에서 5~6초가 걸렸다. */
export const EXACT_TIME_LIMIT_MS = 20_000;

let highsPromise: Promise<Highs> | null = null;

function getHighs(): Promise<Highs> {
  if (!highsPromise) {
    highsPromise = loadHighs().catch((error) => {
      highsPromise = null;
      throw error;
    });
  }
  return highsPromise;
}

const DAY_KEYS = WEEKDAYS.map(({ key }) => key);

type Group = {
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
  hours: number;
};

export async function checkExactPlacement(
  input: FeasibilityInput,
  timeLimitMs = EXACT_TIME_LIMIT_MS,
): Promise<ExactCheck> {
  const startedAt = Date.now();
  const { classBusy, teacherBusy, remaining } = buildSeedState(input);

  const groupIndex = new Map<string, number>();
  const groups: Group[] = [];
  for (const lesson of remaining) {
    const key = `${lesson.teacherName}|${lesson.grade}|${lesson.classNo}|${lesson.subjectName}`;
    const index = groupIndex.get(key);
    if (index !== undefined) {
      groups[index].hours += 1;
      continue;
    }
    groupIndex.set(key, groups.length);
    groups.push({
      teacherName: lesson.teacherName,
      grade: lesson.grade,
      classNo: lesson.classNo,
      subjectName: lesson.subjectName,
      hours: 1,
    });
  }

  if (groups.length === 0) {
    return {
      status: "feasible",
      minUnplaced: 0,
      unplacedLessons: [],
      solutionCells: [],
      elapsedMs: Date.now() - startedAt,
    };
  }

  // x 변수: 들어갈 수 있는 (묶음, 칸) 쌍만
  type XVar = { group: number; day: Weekday; period: number };
  const xs: XVar[] = [];
  const byGroup: number[][] = groups.map(() => []);
  const byClassSlot = new Map<string, number[]>();
  const byTeacherTime = new Map<string, number[]>();
  groups.forEach((g, gi) => {
    for (const day of DAY_KEYS) {
      for (let period = 1; period <= (input.schedules[g.grade][day] ?? 0); period++) {
        if (classBusy.has(`${g.grade}:${g.classNo}:${day}:${period}`)) continue;
        if (teacherBusy.has(`${g.teacherName}:${day}:${period}`)) continue;
        const j = xs.length;
        xs.push({ group: gi, day, period });
        byGroup[gi].push(j);
        const ck = `${g.grade}:${g.classNo}:${day}:${period}`;
        const tk = `${g.teacherName}:${day}:${period}`;
        (byClassSlot.get(ck) ?? byClassSlot.set(ck, []).get(ck)!).push(j);
        (byTeacherTime.get(tk) ?? byTeacherTime.set(tk, []).get(tk)!).push(j);
      }
    }
  });

  // CPLEX LP 형식 (변수 이름은 x{번호}, u{번호})
  const lines: string[] = ["Minimize", ` obj: ${groups.map((_, gi) => `u${gi}`).join(" + ")}`, "Subject To"];
  const sum = (cols: number[]) => cols.map((j) => `x${j}`).join(" + ");
  groups.forEach((g, gi) => {
    const cols = byGroup[gi];
    lines.push(` g${gi}: ${cols.length ? `${sum(cols)} + ` : ""}u${gi} = ${g.hours}`);
  });
  let row = 0;
  for (const cols of byClassSlot.values()) {
    if (cols.length > 1) lines.push(` c${row++}: ${sum(cols)} <= 1`);
  }
  for (const cols of byTeacherTime.values()) {
    if (cols.length > 1) lines.push(` t${row++}: ${sum(cols)} <= 1`);
  }
  lines.push("Bounds");
  groups.forEach((g, gi) => lines.push(` 0 <= u${gi} <= ${g.hours}`));
  if (xs.length) {
    lines.push("Binaries");
    for (let j = 0; j < xs.length; j += 20) {
      lines.push(" " + xs.slice(j, j + 20).map((_, k) => `x${j + k}`).join(" "));
    }
  }
  lines.push("Generals");
  lines.push(" " + groups.map((_, gi) => `u${gi}`).join(" "));
  lines.push("End");

  const highs = await getHighs();
  const result = highs.solve(lines.join("\n"), {
    output_flag: false,
    time_limit: Math.max(1, timeLimitMs / 1000),
  });
  const elapsedMs = Date.now() - startedAt;

  if (result.Status !== "Optimal") {
    return {
      status: "unknown",
      unknownReason: "timeout",
      minUnplaced: null,
      unplacedLessons: [],
      solutionCells: [],
      elapsedMs,
    };
  }

  const value = (name: string) =>
    (result.Columns as Record<string, { Primal: number } | undefined>)[name]?.Primal ?? 0;
  const minUnplaced = Math.round(result.ObjectiveValue);

  if (minUnplaced > 0) {
    const unplacedLessons: ExactUnplacedLesson[] = [];
    groups.forEach((g, gi) => {
      const count = Math.round(value(`u${gi}`));
      if (count > 0) {
        unplacedLessons.push({
          teacherName: g.teacherName,
          grade: g.grade,
          classNo: g.classNo,
          subjectName: g.subjectName,
          count,
        });
      }
    });
    return { status: "infeasible", minUnplaced, unplacedLessons, solutionCells: [], elapsedMs };
  }

  const solutionCells: TimetableCell[] = [];
  xs.forEach((x, j) => {
    if (value(`x${j}`) < 0.5) return;
    const g = groups[x.group];
    solutionCells.push({
      grade: g.grade,
      classNo: g.classNo,
      day: x.day,
      period: x.period,
      subjectName: g.subjectName,
      teacherName: g.teacherName,
      kind: "common",
    });
  });
  return { status: "feasible", minUnplaced: 0, unplacedLessons: [], solutionCells, elapsedMs };
}

/** 화면에 보내는 검사 결과 (배치안은 서버에만 둔다). */
export type PlacementCheckReport = FeasibilityReport & {
  exact: Omit<ExactCheck, "solutionCells">;
  /** 검사한 시각 (API 응답에서 채운다). */
  checkedAt?: string;
  /** 조건이 바뀌지 않아 저장된 결과를 다시 썼으면 true. */
  cached?: boolean;
};

/**
 * 사전 검사 전체: 매칭 하한·경우의 수 추정(수 ms) → 정확 판정(MILP).
 * 정확 판정이 시간 안에 끝나지 못하면 매칭 하한으로 판단한다.
 */
export async function runPlacementCheck(
  input: FeasibilityInput,
  timeLimitMs = EXACT_TIME_LIMIT_MS,
): Promise<{ report: PlacementCheckReport; solutionCells: TimetableCell[] }> {
  const matching = checkPlacementFeasibility(input);
  let full: ExactCheck;
  try {
    full = await checkExactPlacement(input, timeLimitMs);
  } catch (error) {
    // 풀이기(WebAssembly) 로드·실행 실패는 판정 불가로 보고 빠른 검사로 판단한다.
    console.error("exact placement check failed:", error);
    full = {
      status: "unknown",
      unknownReason: "error",
      minUnplaced: null,
      unplacedLessons: [],
      solutionCells: [],
      elapsedMs: 0,
    };
  }
  const { solutionCells, ...exact } = full;
  return {
    report: {
      ...matching,
      // 정확 판정이 불가를 증명했으면 경우의 수 추정은 의미가 없다.
      estimate: exact.status === "infeasible" ? null : matching.estimate,
      exact,
      elapsedMs: matching.elapsedMs + exact.elapsedMs,
    },
    solutionCells,
  };
}

/** 증명된(또는 판정 실패 시 매칭으로 계산한) 최소 미배치 수. */
export function effectiveMinUnplaced(
  report: Pick<PlacementCheckReport, "exact" | "minUnplaced">,
): number {
  return report.exact.minUnplaced ?? report.minUnplaced;
}

/** 미배치가 반드시 생기는 조건이면 v2 배치를 진행하지 않는다. */
export function isPlacementBlocked(
  report: Pick<PlacementCheckReport, "exact" | "minUnplaced">,
): boolean {
  return effectiveMinUnplaced(report) > 0;
}
