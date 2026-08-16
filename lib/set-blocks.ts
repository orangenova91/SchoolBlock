import { sumWeekdayPeriods } from "@/lib/day-schedule";
import { isSetSubject } from "@/lib/teachers";
import {
  ELECTIVE_SETS,
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type SetTeacherAssignment,
  type Teacher,
  type Weekday,
} from "@/lib/types";

export type GradeSetKind = "whole" | "partial" | "invalid";

export type GradeSetInfo = {
  grade: Grade;
  set: ElectiveSet;
  kind: GradeSetKind;
  units: number | null;
  classSum: number;
  subjects: {
    name: string;
    units: number;
    classCount: number;
    classNo?: number;
  }[];
};

export type SetTeacherShare = {
  teacherName: string;
  subjectName: string;
  hours: number;
};

export type ClassCapacityIssue = {
  grade: Grade;
  classNo: number;
  commonHours: number;
  setHours: number;
  weekdaySum: number;
};

const WEEKDAY_KEYS = new Set<string>(WEEKDAYS.map(({ key }) => key));

export function isElectiveSet(value: unknown): value is ElectiveSet {
  return (
    typeof value === "string" &&
    (ELECTIVE_SETS as string[]).includes(value)
  );
}

export function slotKey(day: Weekday, period: number): string {
  return `${day}_${period}`;
}

export function cellLookupKey(
  grade: Grade,
  day: Weekday,
  period: number,
): string {
  return `${grade}:${day}:${period}`;
}

export function catalogGradeSets(
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): GradeSetInfo[] {
  const catalog: GradeSetInfo[] = [];

  for (const grade of GRADES) {
    const grouped = new Map<ElectiveSet, GradeSetInfo["subjects"]>();
    for (const subject of subjects[grade] ?? []) {
      if (!isElectiveSet(subject.set)) continue;
      const list = grouped.get(subject.set) ?? [];
      list.push({
        name: subject.name,
        units: subject.units,
        classCount: subject.classCount,
        ...(typeof subject.classNo === "number"
          ? { classNo: subject.classNo }
          : {}),
      });
      grouped.set(subject.set, list);
    }

    for (const set of ELECTIVE_SETS) {
      const list = grouped.get(set);
      if (!list || list.length === 0) continue;

      const units = [...new Set(list.map((item) => item.units))];
      const classSum = list.reduce((sum, item) => sum + item.classCount, 0);
      const unitsOk = units.length === 1;
      const kind: GradeSetKind = !unitsOk
        ? "invalid"
        : classSum === classCounts[grade]
          ? "whole"
          : "partial";

      catalog.push({
        grade,
        set,
        kind,
        units: unitsOk ? units[0] : null,
        classSum,
        subjects: list,
      });
    }
  }

  return catalog;
}

export function wholeGradeSets(catalog: GradeSetInfo[]): GradeSetInfo[] {
  return catalog.filter(
    (item) => item.kind === "whole" && item.units !== null,
  );
}

export function wholeGradeSetHours(
  catalog: GradeSetInfo[],
  grade: Grade,
): number {
  return catalog
    .filter(
      (item) =>
        item.grade === grade && item.kind === "whole" && item.units !== null,
    )
    .reduce((sum, item) => sum + (item.units ?? 0), 0);
}

export function findGradeSet(
  catalog: GradeSetInfo[],
  grade: Grade,
  set: ElectiveSet,
): GradeSetInfo | undefined {
  return catalog.find((item) => item.grade === grade && item.set === set);
}

export function commonHoursByClass(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): Record<Grade, number[]> {
  const next = {} as Record<Grade, number[]>;

  for (const grade of GRADES) {
    const n = classCounts[grade];
    const perClass = Array.from({ length: n }, () => 0);
    const byName = new Map((subjects[grade] ?? []).map((s) => [s.name, s]));

    for (const teacher of teachers) {
      for (const item of teacher.assignments[grade] ?? []) {
        const subject = byName.get(item.name);
        if (!subject || isSetSubject(subject)) continue;
        (item.classHours ?? []).forEach((hours, index) => {
          if (index < n) perClass[index] += hours;
        });
      }
    }

    next[grade] = perClass;
  }

  return next;
}

export type ClassCommonHourBalance = {
  grade: Grade;
  perClass: number[];
  min: number;
  max: number;
  balanced: boolean;
};

/** Per-grade common-hour totals by class; unbalanced if any class differs. */
export function classCommonHourBalances(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): ClassCommonHourBalance[] {
  const byGrade = commonHoursByClass(teachers, subjects, classCounts);
  return GRADES.map((grade) => {
    const perClass = byGrade[grade] ?? [];
    const min = perClass.length > 0 ? Math.min(...perClass) : 0;
    const max = perClass.length > 0 ? Math.max(...perClass) : 0;
    return {
      grade,
      perClass,
      min,
      max,
      balanced: perClass.length === 0 || min === max,
    };
  });
}

export function classCapacityIssues(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
  catalog: GradeSetInfo[],
): ClassCapacityIssue[] {
  const common = commonHoursByClass(teachers, subjects, classCounts);
  const issues: ClassCapacityIssue[] = [];

  for (const grade of GRADES) {
    const weekdaySum = sumWeekdayPeriods(schedules[grade]);
    const setHours = wholeGradeSetHours(catalog, grade);
    const perClass = common[grade] ?? [];
    perClass.forEach((commonHours, index) => {
      if (commonHours + setHours > weekdaySum) {
        issues.push({
          grade,
          classNo: index + 1,
          commonHours,
          setHours,
          weekdaySum,
        });
      }
    });
  }

  return issues;
}

export function setTeacherShares(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
): SetTeacherShare[] {
  const names = new Set(catalogItem.subjects.map((s) => s.name));
  const shares: SetTeacherShare[] = [];

  for (const teacher of teachers) {
    for (const item of teacher.assignments[catalogItem.grade] ?? []) {
      if (!names.has(item.name) || item.hours <= 0) continue;
      shares.push({
        teacherName: teacher.name,
        subjectName: item.name,
        hours: item.hours,
      });
    }
  }

  return shares;
}

export function teachersForGradeSet(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
): string[] {
  return [
    ...new Set(setTeacherShares(teachers, catalogItem).map((s) => s.teacherName)),
  ];
}

export function assignedTeacherAt(
  assignments: SetTeacherAssignment[],
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
  subjectName: string,
): string | undefined {
  return assignments.find(
    (a) =>
      a.grade === grade &&
      a.set === set &&
      a.day === day &&
      a.period === period &&
      a.subjectName === subjectName,
  )?.teacherName;
}

/** Subjects within a SET that are shared by more than one teacher, meaning
 * which specific teacher covers a given occurrence is ambiguous unless
 * resolved via `SetTeacherAssignment`. */
export function subjectsNeedingRotation(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
): { subjectName: string; shares: SetTeacherShare[] }[] {
  const shares = setTeacherShares(teachers, catalogItem);
  const bySubject = new Map<string, SetTeacherShare[]>();
  for (const share of shares) {
    const list = bySubject.get(share.subjectName) ?? [];
    list.push(share);
    bySubject.set(share.subjectName, list);
  }
  return [...bySubject.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([subjectName, list]) => ({ subjectName, shares: list }));
}

/**
 * Teachers actually occupied by one subject within a SET at one specific
 * (day, period) occurrence. A subject taught by a single teacher always
 * keeps that teacher busy. A subject rotated between several teachers
 * (e.g. 3 teachers covering 1 period each of a 3-period subject) only
 * keeps the teacher resolved via `assignments` busy for that occurrence —
 * falling back to the full (conservative) roster when no assignment has
 * been made yet, so behavior for terms without rotation data is unchanged.
 */
export function resolveSubjectTeachersAtSlot(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
  subjectName: string,
  day: Weekday,
  period: number,
  assignments: SetTeacherAssignment[] = [],
): string[] {
  const shares = setTeacherShares(teachers, catalogItem).filter(
    (s) => s.subjectName === subjectName,
  );
  if (shares.length <= 1) return shares.map((s) => s.teacherName);

  const assigned = assignedTeacherAt(
    assignments,
    catalogItem.grade,
    catalogItem.set,
    day,
    period,
    subjectName,
  );
  return assigned ? [assigned] : shares.map((s) => s.teacherName);
}

/**
 * Teachers actually occupied by `catalogItem` (across all of its subjects)
 * at one specific (day, period) occurrence. See `resolveSubjectTeachersAtSlot`
 * for the per-subject resolution rule this builds on.
 */
export function teachersBusyForGradeSetAtSlot(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
  day: Weekday,
  period: number,
  assignments: SetTeacherAssignment[] = [],
): string[] {
  const subjectNames = new Set(catalogItem.subjects.map((s) => s.name));
  const busy = new Set<string>();
  for (const subjectName of subjectNames) {
    for (const name of resolveSubjectTeachersAtSlot(
      teachers,
      catalogItem,
      subjectName,
      day,
      period,
      assignments,
    )) {
      busy.add(name);
    }
  }
  return [...busy];
}

export type SetAssignmentSubjectRow = {
  name: string;
  assigned: number;
  required: number;
  classCount: number;
  classNo?: number;
};

export type SetAssignmentSummary = {
  grade: Grade;
  set: ElectiveSet;
  kind: GradeSetKind;
  units: number | null;
  classSum: number;
  requiredHours: number;
  assignedHours: number;
  matched: boolean;
  teachers: string[];
  /** Home rooms (1…N) for partial SET; empty for whole-grade. */
  homeRooms: number[];
  hasAlpha: boolean;
  subjects: SetAssignmentSubjectRow[];
};

/** Per grade·SET teacher-hour totals vs subject requirements. */
export function setAssignmentSummaries(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): SetAssignmentSummary[] {
  const catalog = catalogGradeSets(subjects, classCounts);
  const hoursBySubject = new Map<string, number>();

  for (const teacher of teachers) {
    for (const grade of GRADES) {
      for (const item of teacher.assignments[grade] ?? []) {
        const key = `${grade}:${item.name}`;
        hoursBySubject.set(key, (hoursBySubject.get(key) ?? 0) + (item.hours ?? 0));
      }
    }
  }

  return catalog.map((info) => {
    const n = classCounts[info.grade];
    const subjectRows: SetAssignmentSubjectRow[] = info.subjects.map((s) => {
      const classCount = Math.max(1, s.classCount);
      const required = s.units * classCount;
      const assigned = hoursBySubject.get(`${info.grade}:${s.name}`) ?? 0;
      return {
        name: s.name,
        assigned,
        required,
        classCount,
        ...(typeof s.classNo === "number" ? { classNo: s.classNo } : {}),
      };
    });
    const requiredHours = subjectRows.reduce((sum, row) => sum + row.required, 0);
    const assignedHours = subjectRows.reduce((sum, row) => sum + row.assigned, 0);
    const shares = setTeacherShares(teachers, info);
    const homeRooms =
      info.kind === "partial" ? homeRoomsForPartialSet(info, n) : [];
    const hasAlpha =
      info.kind === "partial" ? partialSetHasAlpha(info, n) : false;

    return {
      grade: info.grade,
      set: info.set,
      kind: info.kind,
      units: info.units,
      classSum: info.classSum,
      requiredHours,
      assignedHours,
      matched: subjectRows.every((row) => row.assigned === row.required),
      teachers: [...new Set(shares.map((s) => s.teacherName))],
      homeRooms,
      hasAlpha,
      subjects: subjectRows,
    };
  });
}

export function parseSetBlockCells(value: unknown): SetBlockCell[] | null {
  if (!Array.isArray(value)) return null;

  const cells: SetBlockCell[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { grade, set, day, period } = item as Record<string, unknown>;

    if (grade !== 1 && grade !== 2 && grade !== 3) return null;
    if (!isElectiveSet(set)) return null;
    if (typeof day !== "string" || !WEEKDAY_KEYS.has(day)) return null;
    if (
      typeof period !== "number" ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PERIODS
    ) {
      return null;
    }

    const key = cellLookupKey(grade, day as Weekday, period);
    if (seen.has(key)) return null;
    seen.add(key);

    cells.push({
      grade,
      set,
      day: day as Weekday,
      period,
    });
  }

  return cells;
}

export function parseSetTeacherAssignments(
  value: unknown,
): SetTeacherAssignment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const list: SetTeacherAssignment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { grade, set, day, period, subjectName, teacherName } =
      item as Record<string, unknown>;

    if (grade !== 1 && grade !== 2 && grade !== 3) return null;
    if (!isElectiveSet(set)) return null;
    if (typeof day !== "string" || !WEEKDAY_KEYS.has(day)) return null;
    if (
      typeof period !== "number" ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PERIODS
    ) {
      return null;
    }
    if (typeof subjectName !== "string" || subjectName.trim().length === 0) {
      return null;
    }
    if (typeof teacherName !== "string" || teacherName.trim().length === 0) {
      return null;
    }

    list.push({
      grade,
      set,
      day: day as Weekday,
      period,
      subjectName,
      teacherName,
    });
  }

  return list;
}

/** Drops assignments that no longer correspond to a placed cell or a still-
 * ambiguous (multi-teacher) subject, so stale rotation choices don't linger
 * after cells or teacher assignments change. */
export function filterAssignmentsToPlacement(
  assignments: SetTeacherAssignment[],
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  catalog: GradeSetInfo[],
  teachers: Teacher[],
): SetTeacherAssignment[] {
  const placedKeys = new Set(
    [...wholeCells, ...partialCells].map(
      (c) => `${c.grade}:${c.set}:${c.day}:${c.period}`,
    ),
  );

  return assignments.filter((a) => {
    if (!placedKeys.has(`${a.grade}:${a.set}:${a.day}:${a.period}`)) {
      return false;
    }
    const info = findGradeSet(catalog, a.grade, a.set);
    if (!info) return false;
    const shares = setTeacherShares(teachers, info).filter(
      (s) => s.subjectName === a.subjectName,
    );
    if (shares.length <= 1) return false;
    return shares.some((s) => s.teacherName === a.teacherName);
  });
}

export function filterCellsToCatalog(
  cells: SetBlockCell[],
  schedules: GradeDaySchedules,
  catalog: GradeSetInfo[],
): SetBlockCell[] {
  const whole = new Set(
    wholeGradeSets(catalog).map((item) => `${item.grade}:${item.set}`),
  );

  return cells.filter((cell) => {
    const allowed = schedules[cell.grade]?.[cell.day] ?? 0;
    if (cell.period < 1 || cell.period > allowed) return false;
    return whole.has(`${cell.grade}:${cell.set}`);
  });
}

export function countPlaced(
  cells: SetBlockCell[],
  grade: Grade,
  set: ElectiveSet,
): number {
  return cells.filter((cell) => cell.grade === grade && cell.set === set).length;
}

export function setAtCell(
  cells: SetBlockCell[],
  grade: Grade,
  day: Weekday,
  period: number,
): ElectiveSet | undefined {
  return cells.find(
    (cell) =>
      cell.grade === grade && cell.day === day && cell.period === period,
  )?.set;
}

export function removeCell(
  cells: SetBlockCell[],
  grade: Grade,
  day: Weekday,
  period: number,
): SetBlockCell[] {
  return cells.filter(
    (cell) =>
      !(cell.grade === grade && cell.day === day && cell.period === period),
  );
}

export function teacherConflictAt(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
  assignments: SetTeacherAssignment[] = [],
): string[] {
  const target = findGradeSet(catalog, grade, set);
  if (!target || target.kind !== "whole") return [];

  const busy = new Set(
    teachersBusyForGradeSetAtSlot(teachers, target, day, period, assignments),
  );
  if (busy.size === 0) return [];

  const conflicts = new Set<string>();

  // Other grades: whole SETs at this slot
  for (const other of GRADES) {
    if (other === grade) continue;
    const otherSet = setAtCell(wholeCells, other, day, period);
    if (!otherSet) continue;
    const otherInfo = findGradeSet(catalog, other, otherSet);
    if (!otherInfo || otherInfo.kind !== "whole") continue;
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      otherInfo,
      day,
      period,
      assignments,
    )) {
      if (busy.has(name)) conflicts.add(name);
    }
  }

  // Other grades: partial SETs at this slot
  for (const other of GRADES) {
    if (other === grade) continue;
    for (const otherSet of partialSetsAtSlot(partialCells, other, day, period)) {
      const otherInfo = findGradeSet(catalog, other, otherSet);
      if (!otherInfo) continue;
      for (const name of teachersBusyForGradeSetAtSlot(
        teachers,
        otherInfo,
        day,
        period,
        assignments,
      )) {
        if (busy.has(name)) conflicts.add(name);
      }
    }
  }

  return [...conflicts];
}

export function blockedSlotsForSet(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  schedules: GradeDaySchedules,
  grade: Grade,
  set: ElectiveSet,
  assignments: SetTeacherAssignment[] = [],
): Map<string, string[]> {
  const blocked = new Map<string, string[]>();
  const periods = schedules[grade];
  if (!periods) return blocked;

  for (const { key: day } of WEEKDAYS) {
    const count = periods[day];
    for (let period = 1; period <= count; period++) {
      if (setAtCell(wholeCells, grade, day, period)) continue;
      // Already locked by a same-grade partial SET; not a teacher conflict.
      if (partialSetsAtSlot(partialCells, grade, day, period).length > 0) {
        continue;
      }
      const names = teacherConflictAt(
        wholeCells,
        partialCells,
        teachers,
        catalog,
        grade,
        set,
        day,
        period,
        assignments,
      );
      if (names.length > 0) blocked.set(slotKey(day, period), names);
    }
  }

  return blocked;
}

/** Slots within a grade already occupied by partial SET(s); used to lock the whole-SET grid the same way `wholeLocked` locks the partial-SET grid. */
export function partialLockedSlots(
  partialCells: SetBlockCell[],
  schedules: GradeDaySchedules,
  grade: Grade,
): Map<string, ElectiveSet[]> {
  const locked = new Map<string, ElectiveSet[]>();
  const periods = schedules[grade];
  if (!periods) return locked;

  for (const { key: day } of WEEKDAYS) {
    const count = periods[day];
    for (let period = 1; period <= count; period++) {
      const sets = partialSetsAtSlot(partialCells, grade, day, period);
      if (sets.length > 0) locked.set(slotKey(day, period), sets);
    }
  }

  return locked;
}

export function tryPaintCell({
  cells,
  partialCells,
  catalog,
  teachers,
  schedules,
  grade,
  set,
  day,
  period,
  assignments = [],
}: {
  cells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
  assignments?: SetTeacherAssignment[];
}): { cells: SetBlockCell[]; error?: string } {
  const info = findGradeSet(catalog, grade, set);
  if (!info || info.kind !== "whole" || info.units === null) {
    return { cells, error: "전학년 SET만 배치할 수 있습니다." };
  }

  const allowed = schedules[grade]?.[day] ?? 0;
  if (period < 1 || period > allowed) {
    return { cells, error: "수업이 없는 교시입니다." };
  }

  const existing = setAtCell(cells, grade, day, period);
  if (existing === set) return { cells };
  if (existing) {
    return { cells, error: "다른 SET가 있는 칸입니다." };
  }

  // A whole-grade SET needs every student in the grade, so it can never
  // share a slot with a partial SET already placed for the same grade —
  // regardless of whether teachers conflict.
  const partialHere = partialSetsAtSlot(partialCells, grade, day, period);
  if (partialHere.length > 0) {
    return {
      cells,
      error: `이미 부분 SET가 배치된 칸입니다: ${partialHere.join(", ")}`,
    };
  }

  if (countPlaced(cells, grade, set) >= info.units) {
    return {
      cells,
      error: `${grade}학년 SET ${set}는 ${info.units}교시까지 배치할 수 있습니다.`,
    };
  }

  const conflicts = teacherConflictAt(
    cells,
    partialCells,
    teachers,
    catalog,
    grade,
    set,
    day,
    period,
    assignments,
  );
  if (conflicts.length > 0) {
    return {
      cells,
      error: `같은 시간에 이미 배치된 교사: ${conflicts.join(", ")}`,
    };
  }

  return {
    cells: [...cells, { grade, set, day, period }],
  };
}

export function wholeSetsPlacementComplete(
  cells: SetBlockCell[],
  catalog: GradeSetInfo[],
): boolean {
  const wholes = wholeGradeSets(catalog);
  if (wholes.length === 0) return true;
  return wholes.every(
    (item) => countPlaced(cells, item.grade, item.set) === (item.units ?? 0),
  );
}

export function catalogHasInvalidSets(catalog: GradeSetInfo[]): boolean {
  return catalog.some((item) => item.kind === "invalid");
}

export function partialGradeSets(catalog: GradeSetInfo[]): GradeSetInfo[] {
  return catalog.filter(
    (item) => item.kind === "partial" && item.units !== null,
  );
}

/** Home rooms (1…N) that take this partial SET. Excludes +α. */
export function homeRoomsForPartialSet(
  info: GradeSetInfo,
  gradeClassCount: number,
): number[] {
  const rooms = new Set<number>();
  for (const subject of info.subjects) {
    if (
      typeof subject.classNo === "number" &&
      subject.classNo >= 1 &&
      subject.classNo <= gradeClassCount
    ) {
      rooms.add(subject.classNo);
    }
  }
  return [...rooms].sort((a, b) => a - b);
}

export function partialSetHasAlpha(
  info: GradeSetInfo,
  gradeClassCount: number,
): boolean {
  return info.subjects.some(
    (s) =>
      typeof s.classNo === "number" && s.classNo === gradeClassCount + 1,
  );
}

export function roomsOverlap(a: number[], b: number[]): boolean {
  const setB = new Set(b);
  return a.some((n) => setB.has(n));
}

export function parsePartialSetBlockCells(
  value: unknown,
): SetBlockCell[] | null {
  if (!Array.isArray(value)) return null;

  const cells: SetBlockCell[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { grade, set, day, period } = item as Record<string, unknown>;

    if (grade !== 1 && grade !== 2 && grade !== 3) return null;
    if (!isElectiveSet(set)) return null;
    if (typeof day !== "string" || !WEEKDAY_KEYS.has(day)) return null;
    if (
      typeof period !== "number" ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PERIODS
    ) {
      return null;
    }

    const key = `${grade}:${set}:${day}:${period}`;
    if (seen.has(key)) return null;
    seen.add(key);

    cells.push({
      grade,
      set,
      day: day as Weekday,
      period,
    });
  }

  return cells;
}

export function filterPartialCellsToCatalog(
  cells: SetBlockCell[],
  schedules: GradeDaySchedules,
  catalog: GradeSetInfo[],
): SetBlockCell[] {
  const partial = new Set(
    partialGradeSets(catalog).map((item) => `${item.grade}:${item.set}`),
  );

  return cells.filter((cell) => {
    const allowed = schedules[cell.grade]?.[cell.day] ?? 0;
    if (cell.period < 1 || cell.period > allowed) return false;
    return partial.has(`${cell.grade}:${cell.set}`);
  });
}

export function countPartialPlaced(
  cells: SetBlockCell[],
  grade: Grade,
  set: ElectiveSet,
): number {
  return cells.filter((cell) => cell.grade === grade && cell.set === set)
    .length;
}

export function partialSetsAtSlot(
  cells: SetBlockCell[],
  grade: Grade,
  day: Weekday,
  period: number,
): ElectiveSet[] {
  return cells
    .filter(
      (cell) =>
        cell.grade === grade && cell.day === day && cell.period === period,
    )
    .map((cell) => cell.set);
}

export function removePartialCell(
  cells: SetBlockCell[],
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
): SetBlockCell[] {
  return cells.filter(
    (cell) =>
      !(
        cell.grade === grade &&
        cell.set === set &&
        cell.day === day &&
        cell.period === period
      ),
  );
}

export function partialRoomConflictAt(
  partialCells: SetBlockCell[],
  catalog: GradeSetInfo[],
  classCounts: GradeClassCounts,
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
): ElectiveSet[] {
  const target = findGradeSet(catalog, grade, set);
  if (!target || target.kind !== "partial") return [];

  const myRooms = homeRoomsForPartialSet(target, classCounts[grade]);
  if (myRooms.length === 0) return [];

  const conflicts: ElectiveSet[] = [];
  for (const otherSet of partialSetsAtSlot(partialCells, grade, day, period)) {
    if (otherSet === set) continue;
    const other = findGradeSet(catalog, grade, otherSet);
    if (!other || other.kind !== "partial") continue;
    const otherRooms = homeRoomsForPartialSet(other, classCounts[grade]);
    if (roomsOverlap(myRooms, otherRooms)) conflicts.push(otherSet);
  }
  return conflicts;
}

export function partialTeacherConflictAt(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
  assignments: SetTeacherAssignment[] = [],
): string[] {
  const target = findGradeSet(catalog, grade, set);
  if (!target || target.kind !== "partial") return [];

  const busy = new Set(
    teachersBusyForGradeSetAtSlot(teachers, target, day, period, assignments),
  );
  if (busy.size === 0) return [];

  const conflicts = new Set<string>();

  // Same grade: other partial SETs in this slot
  for (const otherSet of partialSetsAtSlot(partialCells, grade, day, period)) {
    if (otherSet === set) continue;
    const other = findGradeSet(catalog, grade, otherSet);
    if (!other) continue;
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      other,
      day,
      period,
      assignments,
    )) {
      if (busy.has(name)) conflicts.add(name);
    }
  }

  // All grades: whole SETs at this slot
  for (const otherGrade of GRADES) {
    const wholeSet = setAtCell(wholeCells, otherGrade, day, period);
    if (!wholeSet) continue;
    const other = findGradeSet(catalog, otherGrade, wholeSet);
    if (!other) continue;
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      other,
      day,
      period,
      assignments,
    )) {
      if (busy.has(name)) conflicts.add(name);
    }
  }

  // Other grades: partial SETs at this slot
  for (const otherGrade of GRADES) {
    if (otherGrade === grade) continue;
    for (const otherSet of partialSetsAtSlot(
      partialCells,
      otherGrade,
      day,
      period,
    )) {
      const other = findGradeSet(catalog, otherGrade, otherSet);
      if (!other) continue;
      for (const name of teachersBusyForGradeSetAtSlot(
        teachers,
        other,
        day,
        period,
        assignments,
      )) {
        if (busy.has(name)) conflicts.add(name);
      }
    }
  }

  return [...conflicts];
}

export function blockedPartialSlotsForSet(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
  grade: Grade,
  set: ElectiveSet,
  assignments: SetTeacherAssignment[] = [],
): Map<string, string> {
  const blocked = new Map<string, string>();
  const periods = schedules[grade];
  if (!periods) return blocked;

  for (const { key: day } of WEEKDAYS) {
    const count = periods[day];
    for (let period = 1; period <= count; period++) {
      const key = slotKey(day, period);
      if (setAtCell(wholeCells, grade, day, period)) {
        blocked.set(key, "전학년 SET");
        continue;
      }
      if (partialSetsAtSlot(partialCells, grade, day, period).includes(set)) {
        continue;
      }
      const rooms = partialRoomConflictAt(
        partialCells,
        catalog,
        classCounts,
        grade,
        set,
        day,
        period,
      );
      if (rooms.length > 0) {
        blocked.set(key, `학반 겹침: ${rooms.join(", ")}`);
        continue;
      }
      const teachersConflict = partialTeacherConflictAt(
        wholeCells,
        partialCells,
        teachers,
        catalog,
        grade,
        set,
        day,
        period,
        assignments,
      );
      if (teachersConflict.length > 0) {
        blocked.set(key, `교사: ${teachersConflict.join(", ")}`);
      }
    }
  }

  return blocked;
}

export function tryPaintPartialCell({
  wholeCells,
  partialCells,
  catalog,
  classCounts,
  teachers,
  schedules,
  grade,
  set,
  day,
  period,
  assignments = [],
}: {
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
  assignments?: SetTeacherAssignment[];
}): { cells: SetBlockCell[]; error?: string } {
  const info = findGradeSet(catalog, grade, set);
  if (!info || info.kind !== "partial" || info.units === null) {
    return { cells: partialCells, error: "부분 SET만 배치할 수 있습니다." };
  }

  const allowed = schedules[grade]?.[day] ?? 0;
  if (period < 1 || period > allowed) {
    return { cells: partialCells, error: "수업이 없는 교시입니다." };
  }

  if (setAtCell(wholeCells, grade, day, period)) {
    return { cells: partialCells, error: "전학년 SET가 있는 칸입니다." };
  }

  if (partialSetsAtSlot(partialCells, grade, day, period).includes(set)) {
    return { cells: partialCells };
  }

  if (countPartialPlaced(partialCells, grade, set) >= info.units) {
    return {
      cells: partialCells,
      error: `${grade}학년 SET ${set}는 ${info.units}교시까지 배치할 수 있습니다.`,
    };
  }

  const roomConflicts = partialRoomConflictAt(
    partialCells,
    catalog,
    classCounts,
    grade,
    set,
    day,
    period,
  );
  if (roomConflicts.length > 0) {
    return {
      cells: partialCells,
      error: `같은 시간에 학반이 겹치는 SET: ${roomConflicts.join(", ")}`,
    };
  }

  const teacherConflicts = partialTeacherConflictAt(
    wholeCells,
    partialCells,
    teachers,
    catalog,
    grade,
    set,
    day,
    period,
    assignments,
  );
  if (teacherConflicts.length > 0) {
    return {
      cells: partialCells,
      error: `같은 시간에 이미 배치된 교사: ${teacherConflicts.join(", ")}`,
    };
  }

  return {
    cells: [...partialCells, { grade, set, day, period }],
  };
}

export type WholePartialSameSlotConflict = {
  grade: Grade;
  day: Weekday;
  period: number;
  wholeSet: ElectiveSet;
  partialSets: ElectiveSet[];
};

/**
 * A whole-grade SET needs every student in the grade, so it can never share
 * a slot with a partial SET already placed in the same grade — regardless of
 * teacher overlap. This is a stronger, unconditional check on top of
 * `crossSetTeacherConflicts`.
 */
export function wholePartialSameSlotConflicts(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
): WholePartialSameSlotConflict[] {
  const conflicts: WholePartialSameSlotConflict[] = [];

  for (const cell of wholeCells) {
    const partialSets = partialSetsAtSlot(
      partialCells,
      cell.grade,
      cell.day,
      cell.period,
    );
    if (partialSets.length > 0) {
      conflicts.push({
        grade: cell.grade,
        day: cell.day,
        period: cell.period,
        wholeSet: cell.set,
        partialSets,
      });
    }
  }

  return conflicts;
}

export function formatWholePartialSameSlotConflict(
  c: WholePartialSameSlotConflict,
): string {
  const dayLabel = WEEKDAYS.find((d) => d.key === c.day)?.label ?? c.day;
  return `${c.grade}학년 ${dayLabel}${c.period}교시: 전학년 SET ${c.wholeSet} ↔ 부분 SET ${c.partialSets.join(", ")}`;
}

export type CrossSetTeacherConflict = {
  teacherName: string;
  day: Weekday;
  period: number;
  grade: Grade;
  set: ElectiveSet;
  otherGrade: Grade;
  otherSet: ElectiveSet;
};

/**
 * Teacher conflicts between two independent SET-cell arrays (e.g. whole vs
 * partial), regardless of which side was just edited. Used as a
 * belt-and-suspenders server-side check since the paint-time UI can only
 * warn about the array it currently has loaded.
 */
export function crossSetTeacherConflicts(
  cellsA: SetBlockCell[],
  cellsB: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  assignments: SetTeacherAssignment[] = [],
): CrossSetTeacherConflict[] {
  const conflicts: CrossSetTeacherConflict[] = [];

  for (const a of cellsA) {
    const infoA = findGradeSet(catalog, a.grade, a.set);
    if (!infoA) continue;
    const teachersA = teachersBusyForGradeSetAtSlot(
      teachers,
      infoA,
      a.day,
      a.period,
      assignments,
    );
    if (teachersA.length === 0) continue;
    const busyA = new Set(teachersA);

    for (const b of cellsB) {
      if (b.day !== a.day || b.period !== a.period) continue;
      if (b.grade === a.grade && b.set === a.set) continue;
      const infoB = findGradeSet(catalog, b.grade, b.set);
      if (!infoB) continue;
      for (const name of teachersBusyForGradeSetAtSlot(
        teachers,
        infoB,
        b.day,
        b.period,
        assignments,
      )) {
        if (!busyA.has(name)) continue;
        conflicts.push({
          teacherName: name,
          day: a.day,
          period: a.period,
          grade: a.grade,
          set: a.set,
          otherGrade: b.grade,
          otherSet: b.set,
        });
      }
    }
  }

  return conflicts;
}

export function formatCrossSetTeacherConflict(
  c: CrossSetTeacherConflict,
): string {
  const dayLabel = WEEKDAYS.find((d) => d.key === c.day)?.label ?? c.day;
  return `${c.teacherName}: ${dayLabel}${c.period}교시 · ${c.grade}학년 SET ${c.set} ↔ ${c.otherGrade}학년 SET ${c.otherSet}`;
}

export type SameSetInternalTeacherConflict = {
  teacherName: string;
  day: Weekday;
  period: number;
  grade: Grade;
  set: ElectiveSet;
  /** The 2+ distinct subjects within this SET this teacher is required for
   * at the same occurrence — physically impossible since every subject in a
   * whole/partial SET shares the exact same slots (one per home room). */
  subjectNames: string[];
};

/**
 * The teacher *certain* to cover `subjectName` at one occurrence — i.e.
 * unambiguous, either because only one teacher is assigned to it at all, or
 * because rotation has already been resolved via `SetTeacherAssignment` for
 * this exact slot. Returns undefined when it's still ambiguous (multiple
 * teachers share the subject and no rotation choice has been made yet), so
 * callers don't mistake "not yet decided" for "definitely busy".
 */
function certainSubjectTeacherAtSlot(
  teachers: Teacher[],
  catalogItem: GradeSetInfo,
  subjectName: string,
  day: Weekday,
  period: number,
  assignments: SetTeacherAssignment[],
): string | undefined {
  const shares = setTeacherShares(teachers, catalogItem).filter(
    (s) => s.subjectName === subjectName,
  );
  if (shares.length === 0) return undefined;
  if (shares.length === 1) return shares[0].teacherName;
  return assignedTeacherAt(
    assignments,
    catalogItem.grade,
    catalogItem.set,
    day,
    period,
    subjectName,
  );
}

/**
 * Teacher conflicts *inside* a single (grade, SET): two different subjects
 * of the same SET (taught in different home rooms) sharing a teacher who
 * would have to be in two rooms at once. Every subject in a whole/partial
 * SET occupies the identical occurrence slots, so this is never resolvable
 * by rotation — unlike `crossSetTeacherConflicts`, which only compares
 * *different* (grade, SET) pairs and skips this case entirely.
 *
 * Only counts *certain* overlaps (see `certainSubjectTeacherAtSlot`): a
 * subject that still shares an unresolved multi-teacher pool with another
 * subject is a normal, resolvable mid-setup state (the rotation step is
 * exactly what disambiguates it), not a reportable conflict. Reporting that
 * conservatively would also create a deadlock on save — the rotation UI
 * needs the cells saved first to offer choices.
 */
export function sameSetInternalTeacherConflicts(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  assignments: SetTeacherAssignment[] = [],
): SameSetInternalTeacherConflict[] {
  const conflicts: SameSetInternalTeacherConflict[] = [];
  const seen = new Set<string>();

  for (const cell of [...wholeCells, ...partialCells]) {
    const groupKey = `${cell.grade}_${cell.set}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);

    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    const subjectNames = [...new Set(info.subjects.map((s) => s.name))];
    if (subjectNames.length < 2) continue;

    const slots = slotsForGradeSet(wholeCells, partialCells, cell.grade, cell.set);
    for (const slot of slots) {
      const bySubject = new Map<string, Set<string>>();
      for (const subjectName of subjectNames) {
        const teacherName = certainSubjectTeacherAtSlot(
          teachers,
          info,
          subjectName,
          slot.day,
          slot.period,
          assignments,
        );
        if (!teacherName) continue;
        if (!bySubject.has(teacherName)) bySubject.set(teacherName, new Set());
        bySubject.get(teacherName)!.add(subjectName);
      }
      for (const [teacherName, subjects] of bySubject) {
        if (subjects.size > 1) {
          conflicts.push({
            teacherName,
            day: slot.day,
            period: slot.period,
            grade: cell.grade,
            set: cell.set,
            subjectNames: [...subjects],
          });
        }
      }
    }
  }

  return conflicts;
}

export function formatSameSetInternalTeacherConflict(
  c: SameSetInternalTeacherConflict,
): string {
  const dayLabel = WEEKDAYS.find((d) => d.key === c.day)?.label ?? c.day;
  return `${c.teacherName}: ${dayLabel}${c.period}교시 · ${c.grade}학년 SET ${c.set} 안에서 "${c.subjectNames.join('", "')}" 과목에 동시에 필요합니다`;
}

export function partialSetsPlacementComplete(
  cells: SetBlockCell[],
  catalog: GradeSetInfo[],
): boolean {
  const partials = partialGradeSets(catalog);
  if (partials.length === 0) return true;
  return partials.every(
    (item) =>
      countPartialPlaced(cells, item.grade, item.set) === (item.units ?? 0),
  );
}

/** Partial SET hours locked onto each home room (excludes +α). */
export function partialSetHoursByClass(
  catalog: GradeSetInfo[],
  classCounts: GradeClassCounts,
): Record<Grade, number[]> {
  const next = {} as Record<Grade, number[]>;
  for (const grade of GRADES) {
    const n = classCounts[grade];
    const per = Array.from({ length: n }, () => 0);
    for (const info of partialGradeSets(catalog)) {
      if (info.grade !== grade || info.units === null) continue;
      for (const room of homeRoomsForPartialSet(info, n)) {
        if (room >= 1 && room <= n) per[room - 1] += info.units;
      }
    }
    next[grade] = per;
  }
  return next;
}

/** Total SET hours per home room (whole-grade + partial; excludes +α). */
export function setHoursByClass(
  catalog: GradeSetInfo[],
  classCounts: GradeClassCounts,
): Record<Grade, number[]> {
  const next = {} as Record<Grade, number[]>;
  const partial = partialSetHoursByClass(catalog, classCounts);

  for (const grade of GRADES) {
    const n = classCounts[grade];
    const whole = wholeGradeSetHours(catalog, grade);
    const part = partial[grade] ?? [];
    next[grade] = Array.from({ length: n }, (_, i) => whole + (part[i] ?? 0));
  }

  return next;
}

/** Common + SET hours per home room. */
export function totalHoursByClass(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): Record<Grade, number[]> {
  const common = commonHoursByClass(teachers, subjects, classCounts);
  const catalog = catalogGradeSets(subjects, classCounts);
  const setHours = setHoursByClass(catalog, classCounts);
  const next = {} as Record<Grade, number[]>;

  for (const grade of GRADES) {
    const n = classCounts[grade];
    const c = common[grade] ?? [];
    const s = setHours[grade] ?? [];
    next[grade] = Array.from(
      { length: n },
      (_, i) => (c[i] ?? 0) + (s[i] ?? 0),
    );
  }

  return next;
}

export type ClassTotalHourMismatch = {
  grade: Grade;
  classNo: number;
  total: number;
  weekdaySum: number;
};

/** Classes whose common+SET total does not equal weekly periods. */
export function classTotalHourMismatches(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
): ClassTotalHourMismatch[] {
  const totals = totalHoursByClass(teachers, subjects, classCounts);
  const issues: ClassTotalHourMismatch[] = [];

  for (const grade of GRADES) {
    const weekdaySum = sumWeekdayPeriods(schedules[grade]);
    if (weekdaySum <= 0) continue;
    const perClass = totals[grade] ?? [];
    perClass.forEach((total, index) => {
      if (total !== weekdaySum) {
        issues.push({
          grade,
          classNo: index + 1,
          total,
          weekdaySum,
        });
      }
    });
  }

  return issues;
}

export function partialClassCapacityIssues(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
  catalog: GradeSetInfo[],
): ClassCapacityIssue[] {
  const common = commonHoursByClass(teachers, subjects, classCounts);
  const partialHours = partialSetHoursByClass(catalog, classCounts);
  const issues: ClassCapacityIssue[] = [];

  for (const grade of GRADES) {
    const weekdaySum = sumWeekdayPeriods(schedules[grade]);
    const wholeHours = wholeGradeSetHours(catalog, grade);
    const perClass = common[grade] ?? [];
    const partial = partialHours[grade] ?? [];
    perClass.forEach((commonHours, index) => {
      const setHours = wholeHours + (partial[index] ?? 0);
      if (commonHours + setHours > weekdaySum) {
        issues.push({
          grade,
          classNo: index + 1,
          commonHours,
          setHours,
          weekdaySum,
        });
      }
    });
  }

  return issues;
}

export function partialSetsMissingClassNos(
  catalog: GradeSetInfo[],
  classCounts: GradeClassCounts,
): string | null {
  for (const info of partialGradeSets(catalog)) {
    const n = classCounts[info.grade];
    for (const subject of info.subjects) {
      if (subject.classNo === undefined) {
        return `${info.grade}학년 SET ${info.set}의 "${subject.name}"에 학반이 없습니다. 교과 설정(2/2)에서 지정해 주세요.`;
      }
      if (subject.classNo < 1 || subject.classNo > n + 1) {
        return `${info.grade}학년 SET ${info.set}의 "${subject.name}" 학반 번호가 올바르지 않습니다.`;
      }
    }
  }
  return null;
}

/** All (day, period) occurrences currently placed for a grade·SET, across
 * whichever of the whole/partial arrays it belongs to. Every subject inside
 * the SET shares this same set of occurrences (SET catalog entries only
 * form a valid "whole"/"partial" group when all of their subjects share the
 * same weekly unit count). */
export function slotsForGradeSet(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  grade: Grade,
  set: ElectiveSet,
): { day: Weekday; period: number }[] {
  const source = wholeCells.some(
    (c) => c.grade === grade && c.set === set,
  )
    ? wholeCells
    : partialCells;
  return source
    .filter((c) => c.grade === grade && c.set === set)
    .map((c) => ({ day: c.day, period: c.period }));
}

/**
 * Every distinct way of assigning specific teachers to specific slot
 * occurrences that respects each teacher's weekly hour share (e.g. teacher
 * A × 2 hours + teacher B × 1 hour over 3 slots ⇒ 3 permutations). Returns
 * an empty array if the shares' hours don't add up to `slotCount`. Capped
 * at `maxResults` distinct permutations, which is generous for realistic
 * school data (a handful of teachers sharing a handful of periods).
 */
export function enumerateTeacherSlotCombinations(
  shares: { teacherName: string; hours: number }[],
  slotCount: number,
  maxResults = 500,
): string[][] {
  const totalHours = shares.reduce((sum, s) => sum + s.hours, 0);
  if (slotCount <= 0 || totalHours !== slotCount) return [];

  const pool: string[] = [];
  for (const share of shares) {
    for (let i = 0; i < share.hours; i++) pool.push(share.teacherName);
  }

  const results: string[][] = [];
  const used = Array.from({ length: pool.length }, () => false);
  const current: string[] = [];

  function backtrack() {
    if (results.length >= maxResults) return;
    if (current.length === slotCount) {
      results.push([...current]);
      return;
    }
    const triedAtThisLevel = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      if (used[i] || triedAtThisLevel.has(pool[i])) continue;
      triedAtThisLevel.add(pool[i]);
      used[i] = true;
      current.push(pool[i]);
      backtrack();
      current.pop();
      used[i] = false;
      if (results.length >= maxResults) return;
    }
  }

  backtrack();
  return results;
}

export type RotationCombination = {
  /** Teacher assigned to each slot, in the same order as the `slots` input. */
  teacherNames: string[];
  /**
   * How many "genuinely freed" opportunities this combination creates:
   * for each slot, every teacher in the rotation group who is *not* chosen
   * there and has no other already-placed SET obligation at that exact
   * (day, period) becomes free to teach elsewhere at that time instead of
   * being conservatively marked busy. Higher is better.
   */
  score: number;
};

/**
 * Ranks the feasible teacher-per-slot combinations for a rotating SET
 * subject by how much real scheduling flexibility each one frees up for
 * the *other* teachers in the rotation, based on which slots are already
 * claimed elsewhere by other placed SETs.
 */
export function recommendSubjectRotations({
  teachers,
  catalog,
  wholeCells,
  partialCells,
  assignments = [],
  grade,
  set,
  shares,
  slots,
  limit = 8,
}: {
  teachers: Teacher[];
  catalog: GradeSetInfo[];
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  assignments?: SetTeacherAssignment[];
  grade: Grade;
  set: ElectiveSet;
  shares: SetTeacherShare[];
  slots: { day: Weekday; period: number }[];
  limit?: number;
}): RotationCombination[] {
  const combos = enumerateTeacherSlotCombinations(
    shares.map((s) => ({ teacherName: s.teacherName, hours: s.hours })),
    slots.length,
  );
  if (combos.length === 0) return [];

  const groupNames = new Set(shares.map((s) => s.teacherName));

  function busyElsewhereAt(
    day: Weekday,
    period: number,
    teacherName: string,
  ): boolean {
    for (const cell of [...wholeCells, ...partialCells]) {
      if (cell.grade === grade && cell.set === set) continue;
      if (cell.day !== day || cell.period !== period) continue;
      const info = findGradeSet(catalog, cell.grade, cell.set);
      if (!info) continue;
      if (
        teachersBusyForGradeSetAtSlot(
          teachers,
          info,
          day,
          period,
          assignments,
        ).includes(teacherName)
      ) {
        return true;
      }
    }
    return false;
  }

  const scored: RotationCombination[] = combos.map((teacherNames) => {
    let score = 0;
    slots.forEach((slot, index) => {
      const chosen = teacherNames[index];
      for (const name of groupNames) {
        if (name === chosen) continue;
        if (!busyElsewhereAt(slot.day, slot.period, name)) score += 1;
      }
    });
    return { teacherNames, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
