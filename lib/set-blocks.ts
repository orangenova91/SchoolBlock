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
  cells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  grade: Grade,
  set: ElectiveSet,
  day: Weekday,
  period: number,
): string[] {
  const target = findGradeSet(catalog, grade, set);
  if (!target || target.kind !== "whole") return [];

  const busy = new Set(teachersForGradeSet(teachers, target));
  if (busy.size === 0) return [];

  const conflicts = new Set<string>();

  for (const other of GRADES) {
    if (other === grade) continue;
    const otherSet = setAtCell(cells, other, day, period);
    if (!otherSet) continue;
    const otherInfo = findGradeSet(catalog, other, otherSet);
    if (!otherInfo || otherInfo.kind !== "whole") continue;
    for (const name of teachersForGradeSet(teachers, otherInfo)) {
      if (busy.has(name)) conflicts.add(name);
    }
  }

  return [...conflicts];
}

export function blockedSlotsForSet(
  cells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  schedules: GradeDaySchedules,
  grade: Grade,
  set: ElectiveSet,
): Map<string, string[]> {
  const blocked = new Map<string, string[]>();
  const periods = schedules[grade];
  if (!periods) return blocked;

  for (const { key: day } of WEEKDAYS) {
    const count = periods[day];
    for (let period = 1; period <= count; period++) {
      if (setAtCell(cells, grade, day, period)) continue;
      const names = teacherConflictAt(
        cells,
        teachers,
        catalog,
        grade,
        set,
        day,
        period,
      );
      if (names.length > 0) blocked.set(slotKey(day, period), names);
    }
  }

  return blocked;
}

export function tryPaintCell({
  cells,
  catalog,
  teachers,
  schedules,
  grade,
  set,
  day,
  period,
}: {
  cells: SetBlockCell[];
  catalog: GradeSetInfo[];
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
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

  if (countPlaced(cells, grade, set) >= info.units) {
    return {
      cells,
      error: `${grade}학년 SET ${set}는 ${info.units}교시까지 배치할 수 있습니다.`,
    };
  }

  const conflicts = teacherConflictAt(
    cells,
    teachers,
    catalog,
    grade,
    set,
    day,
    period,
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
): string[] {
  const target = findGradeSet(catalog, grade, set);
  if (!target || target.kind !== "partial") return [];

  const busy = new Set(teachersForGradeSet(teachers, target));
  if (busy.size === 0) return [];

  const conflicts = new Set<string>();

  // Same grade: other partial SETs in this slot
  for (const otherSet of partialSetsAtSlot(partialCells, grade, day, period)) {
    if (otherSet === set) continue;
    const other = findGradeSet(catalog, grade, otherSet);
    if (!other) continue;
    for (const name of teachersForGradeSet(teachers, other)) {
      if (busy.has(name)) conflicts.add(name);
    }
  }

  // All grades: whole SETs at this slot
  for (const otherGrade of GRADES) {
    const wholeSet = setAtCell(wholeCells, otherGrade, day, period);
    if (!wholeSet) continue;
    const other = findGradeSet(catalog, otherGrade, wholeSet);
    if (!other) continue;
    for (const name of teachersForGradeSet(teachers, other)) {
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
      for (const name of teachersForGradeSet(teachers, other)) {
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
