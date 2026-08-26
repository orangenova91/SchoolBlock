import {
  catalogGradeSets,
  findGradeSet,
  homeRoomsForPartialSet,
  teachersForGradeSet,
} from "@/lib/set-blocks";
import { isSetSubject } from "@/lib/teachers";
import {
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type SubjectBlockCell,
  type Teacher,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

const WEEKDAY_KEYS = new Set<string>(WEEKDAYS.map(({ key }) => key));

export function subjectBlockKey(cell: SubjectBlockCell): string {
  return `${cell.teacherName}|${cell.grade}|${cell.classNo}|${cell.subjectName}|${cell.day}|${cell.period}`;
}

export function lessonTargetKey(
  teacherName: string,
  grade: Grade,
  classNo: number,
  subjectName: string,
): string {
  return `${teacherName}|${grade}|${classNo}|${subjectName}`;
}

export function classSlotKey(
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
): string {
  return `${grade}:${classNo}:${day}:${period}`;
}

export function teacherSlotKey(
  teacherName: string,
  day: Weekday,
  period: number,
): string {
  return `${teacherName}:${day}:${period}`;
}

export function parseSubjectBlockCells(
  value: unknown,
): SubjectBlockCell[] | null {
  if (!Array.isArray(value)) return null;

  const cells: SubjectBlockCell[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const {
      grade,
      classNo,
      subjectName,
      teacherName,
      day,
      period,
    } = item as Record<string, unknown>;

    if (grade !== 1 && grade !== 2 && grade !== 3) return null;
    if (
      typeof classNo !== "number" ||
      !Number.isInteger(classNo) ||
      classNo < 1
    ) {
      return null;
    }
    if (typeof subjectName !== "string" || !subjectName.trim()) return null;
    if (typeof teacherName !== "string" || !teacherName.trim()) return null;
    if (typeof day !== "string" || !WEEKDAY_KEYS.has(day)) return null;
    if (
      typeof period !== "number" ||
      !Number.isInteger(period) ||
      period < 1 ||
      period > MAX_PERIODS
    ) {
      return null;
    }

    const cell: SubjectBlockCell = {
      grade,
      classNo,
      subjectName: subjectName.trim(),
      teacherName: teacherName.trim(),
      day: day as Weekday,
      period,
    };
    const key = subjectBlockKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
    cells.push(cell);
  }

  return cells;
}

export type SubjectBlockLessonOption = {
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
  required: number;
  placed: number;
};

function expandCommonLessonTargets(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): { teacherName: string; grade: Grade; classNo: number; subjectName: string }[] {
  const out: {
    teacherName: string;
    grade: Grade;
    classNo: number;
    subjectName: string;
  }[] = [];

  for (const teacher of teachers) {
    const teacherName = teacher.name.trim();
    if (!teacherName) continue;
    for (const grade of GRADES) {
      const byName = new Map((subjects[grade] ?? []).map((s) => [s.name, s]));
      for (const item of teacher.assignments[grade] ?? []) {
        const subject = byName.get(item.name);
        if (!subject || isSetSubject(subject)) continue;
        const n = classCounts[grade];
        const cells = item.classHours ?? [];
        for (let i = 0; i < n; i++) {
          const hours = cells[i] ?? 0;
          for (let k = 0; k < hours; k++) {
            out.push({
              teacherName,
              grade,
              classNo: i + 1,
              subjectName: item.name,
            });
          }
        }
      }
    }
  }
  return out;
}

/** Common (teacher, grade, class, subject) targets with required hours. */
export function listSubjectBlockLessons(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): SubjectBlockLessonOption[] {
  const lessons = expandCommonLessonTargets(teachers, subjects, classCounts);
  const map = new Map<string, SubjectBlockLessonOption>();

  for (const lesson of lessons) {
    const key = lessonTargetKey(
      lesson.teacherName,
      lesson.grade,
      lesson.classNo,
      lesson.subjectName,
    );
    const prev = map.get(key);
    if (prev) prev.required += 1;
    else {
      map.set(key, {
        teacherName: lesson.teacherName,
        grade: lesson.grade,
        classNo: lesson.classNo,
        subjectName: lesson.subjectName,
        required: 1,
        placed: 0,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    if (a.classNo !== b.classNo) return a.classNo - b.classNo;
    const bySubject = a.subjectName.localeCompare(b.subjectName, "ko");
    if (bySubject !== 0) return bySubject;
    return a.teacherName.localeCompare(b.teacherName, "ko");
  });
}

export function countPlacedForLesson(
  cells: SubjectBlockCell[],
  teacherName: string,
  grade: Grade,
  classNo: number,
  subjectName: string,
): number {
  return cells.filter(
    (c) =>
      c.teacherName === teacherName &&
      c.grade === grade &&
      c.classNo === classNo &&
      c.subjectName === subjectName,
  ).length;
}

export function withPlacedCounts(
  options: SubjectBlockLessonOption[],
  cells: SubjectBlockCell[],
): SubjectBlockLessonOption[] {
  return options.map((opt) => ({
    ...opt,
    placed: countPlacedForLesson(
      cells,
      opt.teacherName,
      opt.grade,
      opt.classNo,
      opt.subjectName,
    ),
  }));
}

/** Drop blocks that no longer match assignments / schedule / class counts. */
export function filterSubjectBlocksToAssignments(
  cells: SubjectBlockCell[],
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
): SubjectBlockCell[] {
  const allowed = new Map<string, number>();
  for (const lesson of expandCommonLessonTargets(
    teachers,
    subjects,
    classCounts,
  )) {
    const key = lessonTargetKey(
      lesson.teacherName,
      lesson.grade,
      lesson.classNo,
      lesson.subjectName,
    );
    allowed.set(key, (allowed.get(key) ?? 0) + 1);
  }

  const used = new Map<string, number>();
  const next: SubjectBlockCell[] = [];

  for (const cell of cells) {
    const periods = schedules[cell.grade]?.[cell.day] ?? 0;
    if (cell.period < 1 || cell.period > periods) continue;
    if (cell.classNo < 1 || cell.classNo > classCounts[cell.grade]) continue;

    const subject = (subjects[cell.grade] ?? []).find(
      (s) => s.name === cell.subjectName,
    );
    if (!subject || isSetSubject(subject)) continue;

    const key = lessonTargetKey(
      cell.teacherName,
      cell.grade,
      cell.classNo,
      cell.subjectName,
    );
    const max = allowed.get(key) ?? 0;
    const have = used.get(key) ?? 0;
    if (have >= max) continue;
    used.set(key, have + 1);
    next.push(cell);
  }

  return next;
}

function setOccupiesClass(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
): boolean {
  const catalog = catalogGradeSets(subjects, classCounts);

  for (const cell of wholeCells) {
    if (cell.grade !== grade || cell.day !== day || cell.period !== period) {
      continue;
    }
    return true;
  }

  for (const cell of partialCells) {
    if (cell.grade !== grade || cell.day !== day || cell.period !== period) {
      continue;
    }
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    const rooms = homeRoomsForPartialSet(info, classCounts[grade]);
    if (rooms.includes(classNo)) return true;
  }

  return false;
}

function teachersBusyAtSetSlot(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  day: Weekday,
  period: number,
): Set<string> {
  const catalog = catalogGradeSets(subjects, classCounts);
  const busy = new Set<string>();

  for (const cell of [...wholeCells, ...partialCells]) {
    if (cell.day !== day || cell.period !== period) continue;
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    for (const name of teachersForGradeSet(teachers, info)) {
      busy.add(name);
    }
  }

  return busy;
}

export type SubjectBlockPaintError =
  | "full"
  | "set-lock"
  | "class-busy"
  | "teacher-busy"
  | "set-teacher"
  | "off-schedule";

export function tryPaintSubjectBlock(args: {
  cells: SubjectBlockCell[];
  target: {
    teacherName: string;
    grade: Grade;
    classNo: number;
    subjectName: string;
    required: number;
  };
  day: Weekday;
  period: number;
  schedules: GradeDaySchedules;
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
}): { cells: SubjectBlockCell[]; error?: SubjectBlockPaintError } {
  const {
    cells,
    target,
    day,
    period,
    schedules,
    teachers,
    subjects,
    classCounts,
    wholeCells,
    partialCells,
  } = args;

  const allowed = schedules[target.grade]?.[day] ?? 0;
  if (period < 1 || period > allowed) {
    return { cells, error: "off-schedule" };
  }

  const placed = countPlacedForLesson(
    cells,
    target.teacherName,
    target.grade,
    target.classNo,
    target.subjectName,
  );
  if (placed >= target.required) {
    return { cells, error: "full" };
  }

  if (
    setOccupiesClass(
      wholeCells,
      partialCells,
      subjects,
      classCounts,
      target.grade,
      target.classNo,
      day,
      period,
    )
  ) {
    return { cells, error: "set-lock" };
  }

  const setTeachers = teachersBusyAtSetSlot(
    wholeCells,
    partialCells,
    teachers,
    subjects,
    classCounts,
    day,
    period,
  );
  if (setTeachers.has(target.teacherName)) {
    return { cells, error: "set-teacher" };
  }

  const classTaken = cells.some(
    (c) =>
      c.grade === target.grade &&
      c.classNo === target.classNo &&
      c.day === day &&
      c.period === period,
  );
  if (classTaken) {
    return { cells, error: "class-busy" };
  }

  const teacherTaken = cells.some(
    (c) =>
      c.teacherName === target.teacherName &&
      c.day === day &&
      c.period === period,
  );
  if (teacherTaken) {
    return { cells, error: "teacher-busy" };
  }

  return {
    cells: [
      ...cells,
      {
        grade: target.grade,
        classNo: target.classNo,
        subjectName: target.subjectName,
        teacherName: target.teacherName,
        day,
        period,
      },
    ],
  };
}

export function eraseSubjectBlockAt(
  cells: SubjectBlockCell[],
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
  onlyTeacherName?: string,
  onlySubjectName?: string,
): SubjectBlockCell[] {
  return cells.filter((c) => {
    if (
      c.grade !== grade ||
      c.classNo !== classNo ||
      c.day !== day ||
      c.period !== period
    ) {
      return true;
    }
    if (onlyTeacherName && c.teacherName !== onlyTeacherName) return true;
    if (onlySubjectName && c.subjectName !== onlySubjectName) return true;
    return false;
  });
}

/** Map slot -> subject block for one class grid. */
export function subjectBlocksBySlotForClass(
  cells: SubjectBlockCell[],
  grade: Grade,
  classNo: number,
): Map<string, SubjectBlockCell> {
  const map = new Map<string, SubjectBlockCell>();
  for (const cell of cells) {
    if (cell.grade !== grade || cell.classNo !== classNo) continue;
    map.set(`${cell.day}|${cell.period}`, cell);
  }
  return map;
}

export function setLockedSlotsForClass(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
  grade: Grade,
  classNo: number,
): Set<string> {
  const locked = new Set<string>();
  for (const { key: day } of WEEKDAYS) {
    for (let period = 1; period <= MAX_PERIODS; period++) {
      if (
        setOccupiesClass(
          wholeCells,
          partialCells,
          subjects,
          classCounts,
          grade,
          classNo,
          day,
          period,
        )
      ) {
        locked.add(`${day}|${period}`);
      }
    }
  }
  return locked;
}

export function subjectBlocksToTimetableCells(
  cells: SubjectBlockCell[],
): TimetableCell[] {
  return cells.map((cell) => ({
    grade: cell.grade,
    classNo: cell.classNo,
    day: cell.day,
    period: cell.period,
    subjectName: cell.subjectName,
    teacherName: cell.teacherName,
    kind: "common" as const,
  }));
}

export type LessonRef = {
  id: number;
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
};

/** Remove one expanded lesson per subject-block cell. */
export function consumeLessonsForSubjectBlocks<T extends LessonRef>(
  lessons: T[],
  blocks: SubjectBlockCell[],
): { remaining: T[]; locked: T[] } {
  const bag = new Map<string, T[]>();
  for (const lesson of lessons) {
    const key = lessonTargetKey(
      lesson.teacherName,
      lesson.grade,
      lesson.classNo,
      lesson.subjectName,
    );
    const list = bag.get(key) ?? [];
    list.push(lesson);
    bag.set(key, list);
  }

  const locked: T[] = [];
  for (const block of blocks) {
    const key = lessonTargetKey(
      block.teacherName,
      block.grade,
      block.classNo,
      block.subjectName,
    );
    const list = bag.get(key);
    if (!list || list.length === 0) continue;
    locked.push(list.shift()!);
  }

  const remaining: T[] = [];
  for (const list of bag.values()) remaining.push(...list);
  return { remaining, locked };
}

export function markBusyFromSubjectBlocks(
  blocks: SubjectBlockCell[],
  classBusy: Set<string>,
  teacherBusy: Set<string>,
) {
  for (const cell of blocks) {
    classBusy.add(
      classSlotKey(cell.grade, cell.classNo, cell.day, cell.period),
    );
    teacherBusy.add(
      teacherSlotKey(cell.teacherName, cell.day, cell.period),
    );
  }
}
