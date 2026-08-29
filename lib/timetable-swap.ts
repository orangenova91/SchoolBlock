import { dayLabel } from "@/lib/types";
import {
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  type Grade,
  type GradeDaySchedules,
  type TeacherForbiddenSlot,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

export type TimetableCellRef = {
  grade: Grade;
  classNo: number;
  day: Weekday;
  period: number;
  subjectName: string;
  teacherName: string;
};

const WEEKDAY_KEYS = new Set<string>(WEEKDAYS.map(({ key }) => key));

function teacherNames(teacherName: string): string[] {
  return teacherName
    .split("·")
    .map((name) => name.trim())
    .filter(Boolean);
}

function sameCell(a: TimetableCell, b: TimetableCellRef): boolean {
  return (
    a.grade === b.grade &&
    a.classNo === b.classNo &&
    a.day === b.day &&
    a.period === b.period &&
    a.subjectName === b.subjectName &&
    a.teacherName === b.teacherName
  );
}

export function parseCellRef(value: unknown): TimetableCellRef | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const grade = raw.grade;
  if (grade !== 1 && grade !== 2 && grade !== 3) return null;
  if (
    typeof raw.classNo !== "number" ||
    !Number.isInteger(raw.classNo) ||
    raw.classNo < 1
  ) {
    return null;
  }
  if (typeof raw.day !== "string" || !WEEKDAY_KEYS.has(raw.day)) return null;
  if (
    typeof raw.period !== "number" ||
    !Number.isInteger(raw.period) ||
    raw.period < 1 ||
    raw.period > MAX_PERIODS
  ) {
    return null;
  }
  if (typeof raw.subjectName !== "string" || !raw.subjectName.trim()) {
    return null;
  }
  if (typeof raw.teacherName !== "string" || !raw.teacherName.trim()) {
    return null;
  }
  return {
    grade,
    classNo: raw.classNo,
    day: raw.day as Weekday,
    period: raw.period,
    subjectName: raw.subjectName.trim(),
    teacherName: raw.teacherName.trim(),
  };
}

export function findCell(
  cells: TimetableCell[],
  ref: TimetableCellRef,
): TimetableCell | undefined {
  return cells.find((cell) => sameCell(cell, ref));
}

export function isSameClassSwapTarget(
  from: TimetableCellRef,
  to: Pick<TimetableCell, "grade" | "classNo" | "day" | "period" | "kind">,
): boolean {
  if (to.kind !== "common") return false;
  if (from.grade !== to.grade || from.classNo !== to.classNo) return false;
  return from.day !== to.day || from.period !== to.period;
}

export function swapSameClassCommonCells(
  cells: TimetableCell[],
  from: TimetableCellRef,
  to: TimetableCellRef,
  options: {
    forbiddenSlots: TeacherForbiddenSlot[];
    schedules: GradeDaySchedules;
  },
): { cells: TimetableCell[] } | { error: string } {
  if (!GRADES.includes(from.grade) || !GRADES.includes(to.grade)) {
    return { error: "학년이 올바르지 않습니다." };
  }
  if (from.grade !== to.grade || from.classNo !== to.classNo) {
    return { error: "같은 학반의 수업만 맞바꿀 수 있습니다." };
  }
  if (from.day === to.day && from.period === to.period) {
    return { error: "같은 칸끼리는 바꿀 수 없습니다." };
  }

  const source = findCell(cells, from);
  const target = findCell(cells, to);
  if (!source || !target) {
    return { error: "수업을 찾을 수 없습니다." };
  }
  if (source.kind !== "common" || target.kind !== "common") {
    return { error: "SET 수업은 맞바꿀 수 없습니다." };
  }

  if ((options.schedules[source.grade][target.day] ?? 0) < target.period) {
    return { error: "해당 요일에 없는 교시입니다." };
  }
  if ((options.schedules[target.grade][source.day] ?? 0) < source.period) {
    return { error: "해당 요일에 없는 교시입니다." };
  }

  const next = cells.map((cell) => {
    if (sameCell(cell, from)) {
      return { ...cell, day: target.day, period: target.period };
    }
    if (sameCell(cell, to)) {
      return { ...cell, day: source.day, period: source.period };
    }
    return cell;
  });

  const moved: TimetableCell[] = [
    { ...source, day: target.day, period: target.period },
    { ...target, day: source.day, period: source.period },
  ];

  const forbidden = new Set(
    options.forbiddenSlots.map(
      (slot) => `${slot.teacherName}|${slot.day}|${slot.period}`,
    ),
  );

  for (const cell of moved) {
    for (const name of teacherNames(cell.teacherName)) {
      if (forbidden.has(`${name}|${cell.day}|${cell.period}`)) {
        return {
          error: `${name} 교사는 ${dayLabel(cell.day)}${cell.period}교시에 배정 불가입니다.`,
        };
      }
    }
  }

  for (const cell of moved) {
    for (const name of teacherNames(cell.teacherName)) {
      const clash = next.some((other) => {
        if (other.day !== cell.day || other.period !== cell.period) return false;
        if (sameCell(other, cell)) return false;
        return teacherNames(other.teacherName).includes(name);
      });
      if (clash) {
        return {
          error: `${name} 교사는 이미 ${dayLabel(cell.day)}${cell.period}교시에 다른 수업이 있습니다.`,
        };
      }
    }
  }

  return { cells: next };
}
