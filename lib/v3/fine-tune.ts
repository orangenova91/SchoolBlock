import { listLunchTeacherDoubles, listSameDaySubjectViolations, listTeacherTripleRuns } from "@/lib/timetable";
import { swapSameClassCommonCells, type TimetableCellRef } from "@/lib/timetable-swap";
import type {
  GradeDaySchedules,
  SameDaySubjectBan,
  SubjectBlockCell,
  TeacherForbiddenSlot,
  TimetableCell,
} from "@/lib/types";

/**
 * v3 9장 미세 조정: 저장본에서 시작해 같은 학반 공통 수업끼리 맞바꾼다.
 * 화면(미리 계산)과 서버(저장 때 다시 적용)가 같은 규칙을 쓴다.
 */
export type FineTuneContext = {
  schedules: GradeDaySchedules;
  forbiddenSlots: TeacherForbiddenSlot[];
  /** 선 수업 배치로 고정한 수업 (맞바꿀 수 없다) */
  pins: SubjectBlockCell[];
  lunchAfterPeriod: number;
  sameDaySubjectBans: SameDaySubjectBan[];
};

export type FineTuneSwap = { from: TimetableCellRef; to: TimetableCellRef };

export const MAX_FINE_TUNE_SWAPS = 500;

type SlotLesson = Pick<TimetableCell, "grade" | "classNo" | "day" | "period" | "subjectName">;

const pinKey = (c: SlotLesson) => `${c.grade}|${c.classNo}|${c.day}|${c.period}|${c.subjectName}`;

export function pinnedLessonKeys(pins: SubjectBlockCell[]): Set<string> {
  return new Set(pins.map(pinKey));
}

export const isPinnedLesson = (keys: Set<string>, cell: SlotLesson) => keys.has(pinKey(cell));

export function applyFineTuneSwap(
  cells: TimetableCell[],
  swap: FineTuneSwap,
  ctx: Pick<FineTuneContext, "schedules" | "forbiddenSlots">,
  pinned: Set<string>,
): { cells: TimetableCell[] } | { error: string } {
  if (isPinnedLesson(pinned, swap.from) || isPinnedLesson(pinned, swap.to)) {
    return { error: "선 수업 배치로 고정한 수업은 옮길 수 없습니다." };
  }
  return swapSameClassCommonCells(cells, swap.from, swap.to, ctx);
}

export function fineTuneMetrics(cells: TimetableCell[], ctx: Pick<FineTuneContext, "lunchAfterPeriod" | "sameDaySubjectBans">) {
  const lunchDoubles = listLunchTeacherDoubles(cells, ctx.lunchAfterPeriod);
  const tripleRuns = listTeacherTripleRuns(cells, ctx.lunchAfterPeriod);
  const sameDaySubjectViolations = listSameDaySubjectViolations(cells, ctx.sameDaySubjectBans);
  return { lunchDoubles, tripleRuns, sameDaySubjectViolations };
}
