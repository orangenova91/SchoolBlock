import {
  catalogGradeSets,
  findGradeSet,
  teachersForGradeSet,
  type GradeSetInfo,
} from "@/lib/set-blocks";
import {
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type Teacher,
  type TeacherForbiddenSlot,
  type Weekday,
} from "@/lib/types";

const WEEKDAY_KEYS = new Set<string>(WEEKDAYS.map(({ key }) => key));

export function forbiddenSlotKey(
  teacherName: string,
  day: Weekday,
  period: number,
): string {
  return `${teacherName}|${day}|${period}`;
}

export function parseTeacherForbiddenSlots(
  value: unknown,
): TeacherForbiddenSlot[] | null {
  if (!Array.isArray(value)) return null;

  const slots: TeacherForbiddenSlot[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { teacherName, day, period } = item as Record<string, unknown>;

    if (typeof teacherName !== "string") return null;
    const name = teacherName.trim();
    if (!name) return null;
    if (typeof day !== "string" || !WEEKDAY_KEYS.has(day)) return null;
    if (
      typeof period !== "number" ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PERIODS
    ) {
      return null;
    }

    const key = forbiddenSlotKey(name, day as Weekday, period);
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ teacherName: name, day: day as Weekday, period });
  }

  return slots;
}

/** Keep slots for known teachers and periods that exist in any grade schedule. */
export function filterForbiddenSlots(
  slots: TeacherForbiddenSlot[],
  teachers: Teacher[],
  schedules: GradeDaySchedules,
): TeacherForbiddenSlot[] {
  const names = new Set(
    teachers.map((t) => t.name.trim()).filter(Boolean),
  );
  return slots.filter((s) => {
    if (!names.has(s.teacherName)) return false;
    return GRADES.some((g) => (schedules[g][s.day] ?? 0) >= s.period);
  });
}

/** Max periods per weekday across grades (for the paint grid). */
export function maxPeriodsByWeekday(
  schedules: GradeDaySchedules,
): Record<Weekday, number> {
  const out = {} as Record<Weekday, number>;
  for (const { key } of WEEKDAYS) {
    out[key] = Math.max(0, ...GRADES.map((g) => schedules[g][key] ?? 0));
  }
  return out;
}

export function toggleForbiddenSlot(
  slots: TeacherForbiddenSlot[],
  teacherName: string,
  day: Weekday,
  period: number,
): TeacherForbiddenSlot[] {
  const key = forbiddenSlotKey(teacherName, day, period);
  const exists = slots.some(
    (s) => forbiddenSlotKey(s.teacherName, s.day, s.period) === key,
  );
  if (exists) {
    return slots.filter(
      (s) => forbiddenSlotKey(s.teacherName, s.day, s.period) !== key,
    );
  }
  return [...slots, { teacherName, day, period }];
}

export function isForbidden(
  slots: TeacherForbiddenSlot[],
  teacherName: string,
  day: Weekday,
  period: number,
): boolean {
  return slots.some(
    (s) =>
      s.teacherName === teacherName && s.day === day && s.period === period,
  );
}

export type ForbiddenSetConflict = {
  teacherName: string;
  day: Weekday;
  period: number;
  grade: 1 | 2 | 3;
  set: string;
  kind: "whole" | "partial";
};

function conflictsForBlocks(
  slots: TeacherForbiddenSlot[],
  blocks: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  kind: "whole" | "partial",
): ForbiddenSetConflict[] {
  const forbidden = new Set(
    slots.map((s) => forbiddenSlotKey(s.teacherName, s.day, s.period)),
  );
  const out: ForbiddenSetConflict[] = [];

  for (const cell of blocks) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    for (const name of teachersForGradeSet(teachers, info)) {
      const key = forbiddenSlotKey(name, cell.day, cell.period);
      if (!forbidden.has(key)) continue;
      out.push({
        teacherName: name,
        day: cell.day,
        period: cell.period,
        grade: cell.grade,
        set: cell.set,
        kind,
      });
    }
  }

  return out;
}

export function findForbiddenSetConflicts(
  slots: TeacherForbiddenSlot[],
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): ForbiddenSetConflict[] {
  const catalog = catalogGradeSets(subjects, classCounts);
  return [
    ...conflictsForBlocks(slots, wholeCells, teachers, catalog, "whole"),
    ...conflictsForBlocks(slots, partialCells, teachers, catalog, "partial"),
  ];
}

export function formatForbiddenConflict(c: ForbiddenSetConflict): string {
  const dayLabel = WEEKDAYS.find((d) => d.key === c.day)?.label ?? c.day;
  const setKind = c.kind === "whole" ? "전학년" : "부분";
  return `${c.teacherName}: ${dayLabel}${c.period}교시 ↔ ${c.grade}학년 SET ${c.set}(${setKind})`;
}
