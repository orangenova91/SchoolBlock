import {
  catalogGradeSets,
  findGradeSet,
  homeRoomsForPartialSet,
  teachersForGradeSet,
  type GradeSetInfo,
} from "@/lib/set-blocks";
import { isSetSubject } from "@/lib/teachers";
import {
  GRADES,
  WEEKDAYS,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type Teacher,
  type TimetableCell,
  type TimetableUnplaced,
  type Weekday,
} from "@/lib/types";

export type CommonLesson = {
  id: number;
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
};

type Slot = { day: Weekday; period: number };

function classSlotKey(
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
): string {
  return `${grade}:${classNo}:${day}:${period}`;
}

function teacherSlotKey(
  teacherName: string,
  day: Weekday,
  period: number,
): string {
  return `${teacherName}:${day}:${period}`;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function expandCommonLessons(
  teachers: Teacher[],
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): CommonLesson[] {
  const lessons: CommonLesson[] = [];
  let id = 0;

  for (const teacher of teachers) {
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
            lessons.push({
              id: id++,
              teacherName: teacher.name,
              grade,
              classNo: i + 1,
              subjectName: item.name,
            });
          }
        }
      }
    }
  }

  return lessons;
}

function teachersForSubject(
  teachers: Teacher[],
  grade: Grade,
  subjectName: string,
): string[] {
  const names: string[] = [];
  for (const teacher of teachers) {
    if (
      (teacher.assignments[grade] ?? []).some((a) => a.name === subjectName)
    ) {
      names.push(teacher.name);
    }
  }
  return names;
}

function buildSetCells(args: {
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  catalog: GradeSetInfo[];
}): TimetableCell[] {
  const {
    wholeCells,
    partialCells,
    subjects,
    classCounts,
    teachers,
    catalog,
  } = args;
  const cells: TimetableCell[] = [];

  for (const cell of wholeCells) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    const teacherNames = info ? teachersForGradeSet(teachers, info) : [];
    const teacherName =
      teacherNames.length > 0 ? teacherNames.join("·") : "—";
    const n = classCounts[cell.grade];
    for (let classNo = 1; classNo <= n; classNo++) {
      cells.push({
        grade: cell.grade,
        classNo,
        day: cell.day,
        period: cell.period,
        subjectName: `SET ${cell.set}`,
        teacherName,
        kind: "set",
        set: cell.set,
      });
    }
  }

  for (const cell of partialCells) {
    const n = classCounts[cell.grade];
    const info = findGradeSet(catalog, cell.grade, cell.set);
    const rooms = info ? homeRoomsForPartialSet(info, n) : [];
    const gradeSubjects = subjects[cell.grade] ?? [];

    for (const classNo of rooms) {
      const subject = gradeSubjects.find(
        (s) => s.set === cell.set && s.classNo === classNo,
      );
      const subjectName = subject?.name ?? `SET ${cell.set}`;
      const teacherNames = teachersForSubject(
        teachers,
        cell.grade,
        subjectName,
      );
      cells.push({
        grade: cell.grade,
        classNo,
        day: cell.day,
        period: cell.period,
        subjectName,
        teacherName:
          teacherNames.length > 0 ? teacherNames.join("·") : "—",
        kind: "set",
        set: cell.set,
      });
    }
  }

  return cells;
}

function markBusyFromSetCells(
  setCells: TimetableCell[],
  classBusy: Set<string>,
  teacherBusy: Set<string>,
) {
  for (const cell of setCells) {
    classBusy.add(
      classSlotKey(cell.grade, cell.classNo, cell.day, cell.period),
    );
    for (const name of cell.teacherName.split("·")) {
      if (!name || name === "—") continue;
      teacherBusy.add(teacherSlotKey(name, cell.day, cell.period));
    }
  }
}

function markTeacherBusyFromBlocks(
  wholeCells: SetBlockCell[],
  partialCells: SetBlockCell[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  teacherBusy: Set<string>,
) {
  for (const cell of [...wholeCells, ...partialCells]) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    for (const name of teachersForGradeSet(teachers, info)) {
      teacherBusy.add(teacherSlotKey(name, cell.day, cell.period));
    }
  }
}

function availableSlotsForLesson(
  lesson: CommonLesson,
  schedules: GradeDaySchedules,
  classBusy: Set<string>,
  teacherBusy: Set<string>,
): Slot[] {
  const slots: Slot[] = [];
  const periods = schedules[lesson.grade];
  for (const { key: day } of WEEKDAYS) {
    const count = periods[day] ?? 0;
    for (let period = 1; period <= count; period++) {
      if (
        classBusy.has(
          classSlotKey(lesson.grade, lesson.classNo, day, period),
        )
      ) {
        continue;
      }
      if (teacherBusy.has(teacherSlotKey(lesson.teacherName, day, period))) {
        continue;
      }
      slots.push({ day, period });
    }
  }
  return slots;
}

function unplacedKey(lesson: CommonLesson): string {
  return `${lesson.teacherName}|${lesson.grade}|${lesson.classNo}|${lesson.subjectName}`;
}

function toUnplacedList(lessons: CommonLesson[]): TimetableUnplaced[] {
  const map = new Map<string, TimetableUnplaced>();
  for (const lesson of lessons) {
    const key = unplacedKey(lesson);
    const prev = map.get(key);
    if (prev) prev.remaining += 1;
    else {
      map.set(key, {
        teacherName: lesson.teacherName,
        grade: lesson.grade,
        classNo: lesson.classNo,
        subjectName: lesson.subjectName,
        remaining: 1,
      });
    }
  }
  return [...map.values()];
}

type PlaceState = {
  classBusy: Set<string>;
  teacherBusy: Set<string>;
  /** lessonId -> slot */
  assignment: Map<number, Slot>;
  cells: TimetableCell[];
};

function placeLesson(
  state: PlaceState,
  lesson: CommonLesson,
  slot: Slot,
) {
  state.classBusy.add(
    classSlotKey(lesson.grade, lesson.classNo, slot.day, slot.period),
  );
  state.teacherBusy.add(
    teacherSlotKey(lesson.teacherName, slot.day, slot.period),
  );
  state.assignment.set(lesson.id, slot);
  state.cells.push({
    grade: lesson.grade,
    classNo: lesson.classNo,
    day: slot.day,
    period: slot.period,
    subjectName: lesson.subjectName,
    teacherName: lesson.teacherName,
    kind: "common",
  });
}

function unplaceLesson(state: PlaceState, lesson: CommonLesson, slot: Slot) {
  state.classBusy.delete(
    classSlotKey(lesson.grade, lesson.classNo, slot.day, slot.period),
  );
  state.teacherBusy.delete(
    teacherSlotKey(lesson.teacherName, slot.day, slot.period),
  );
  state.assignment.delete(lesson.id);
  const idx = state.cells.findIndex(
    (c) =>
      c.kind === "common" &&
      c.grade === lesson.grade &&
      c.classNo === lesson.classNo &&
      c.day === slot.day &&
      c.period === slot.period &&
      c.teacherName === lesson.teacherName &&
      c.subjectName === lesson.subjectName,
  );
  if (idx >= 0) state.cells.splice(idx, 1);
}

/**
 * MRV backtracking with restarts and a time/node budget.
 * Returns best partial assignment if no complete solution within budget.
 */
function lessonDegree(lesson: CommonLesson, lessons: CommonLesson[]): number {
  let d = 0;
  for (const other of lessons) {
    if (other.id === lesson.id) continue;
    if (
      other.teacherName === lesson.teacherName ||
      (other.grade === lesson.grade && other.classNo === lesson.classNo)
    ) {
      d += 1;
    }
  }
  return d;
}

/**
 * MRV backtracking with restarts and a time/node budget.
 * Returns best partial assignment if no complete solution within budget.
 */
function solveBacktracking(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  options: { timeLimitMs: number; nodeLimit: number; restarts: number },
): {
  commonCells: TimetableCell[];
  unplaced: TimetableUnplaced[];
  attemptsUsed: number;
  nodes: number;
} {
  const globalDeadline = Date.now() + options.timeLimitMs;
  const sliceMs = Math.max(
    400,
    Math.floor(options.timeLimitMs / Math.max(1, options.restarts)),
  );
  let nodes = 0;
  let bestCells: TimetableCell[] = [];
  let bestRemaining = lessons;
  let attemptsUsed = 0;

  const degrees = new Map<number, number>();
  for (const lesson of lessons) {
    degrees.set(lesson.id, lessonDegree(lesson, lessons));
  }

  const considerBest = (
    state: PlaceState,
    remaining: Set<number>,
    byId: Map<number, CommonLesson>,
  ) => {
    const left = [...remaining].map((id) => byId.get(id)!);
    if (left.length < bestRemaining.length) {
      bestRemaining = left;
      bestCells = [...state.cells];
    }
  };

  for (let restart = 0; restart < options.restarts; restart++) {
    if (Date.now() > globalDeadline) break;
    attemptsUsed = restart + 1;
    const restartDeadline = Math.min(globalDeadline, Date.now() + sliceMs);

    const state: PlaceState = {
      classBusy: new Set(classBusySeed),
      teacherBusy: new Set(teacherBusySeed),
      assignment: new Map(),
      cells: [],
    };
    const remaining = new Set(lessons.map((l) => l.id));
    const byId = new Map(lessons.map((l) => [l.id, l]));

    const search = (): boolean => {
      nodes += 1;
      if (nodes > options.nodeLimit || Date.now() > restartDeadline) {
        considerBest(state, remaining, byId);
        return false;
      }
      if (remaining.size === 0) return true;

      let bestId: number | null = null;
      let bestSlots: Slot[] = [];
      let bestCount = Infinity;
      let bestDeg = -1;

      for (const id of remaining) {
        const lesson = byId.get(id)!;
        const slots = availableSlotsForLesson(
          lesson,
          schedules,
          state.classBusy,
          state.teacherBusy,
        );
        const deg = degrees.get(id) ?? 0;
        if (
          slots.length < bestCount ||
          (slots.length === bestCount && deg > bestDeg)
        ) {
          bestCount = slots.length;
          bestId = id;
          bestSlots = slots;
          bestDeg = deg;
          if (bestCount === 0) break;
        }
      }

      if (bestId === null || bestCount === 0) {
        considerBest(state, remaining, byId);
        return false;
      }

      const lesson = byId.get(bestId)!;
      remaining.delete(bestId);

      for (const slot of shuffle(bestSlots)) {
        placeLesson(state, lesson, slot);
        if (search()) return true;
        unplaceLesson(state, lesson, slot);
        if (nodes > options.nodeLimit || Date.now() > restartDeadline) {
          remaining.add(bestId);
          considerBest(state, remaining, byId);
          return false;
        }
      }

      remaining.add(bestId);
      considerBest(state, remaining, byId);
      return false;
    };

    if (search()) {
      return {
        commonCells: state.cells,
        unplaced: [],
        attemptsUsed,
        nodes,
      };
    }
  }

  return {
    commonCells: bestCells,
    unplaced: toUnplacedList(bestRemaining),
    attemptsUsed,
    nodes,
  };
}

/**
 * Repair: for each unplaced lesson, try to displace one conflicting common cell
 * and re-place the displaced lesson elsewhere.
 */
function repairUnplaced(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  initialCells: TimetableCell[],
  initialUnplaced: TimetableUnplaced[],
  timeLimitMs: number,
): { commonCells: TimetableCell[]; unplaced: TimetableUnplaced[] } {
  if (initialUnplaced.length === 0) {
    return { commonCells: initialCells, unplaced: [] };
  }

  const deadline = Date.now() + timeLimitMs;
  const byKey = new Map<string, CommonLesson[]>();
  for (const lesson of lessons) {
    const key = unplacedKey(lesson);
    const list = byKey.get(key) ?? [];
    list.push(lesson);
    byKey.set(key, list);
  }

  const state: PlaceState = {
    classBusy: new Set(classBusySeed),
    teacherBusy: new Set(teacherBusySeed),
    assignment: new Map(),
    cells: [],
  };

  // Rebuild state from initial common cells (approximate: match lessons greedily)
  const pool = new Map<string, CommonLesson[]>();
  for (const lesson of lessons) {
    const key = unplacedKey(lesson);
    const list = pool.get(key) ?? [];
    list.push(lesson);
    pool.set(key, list);
  }

  for (const cell of initialCells) {
    if (cell.kind !== "common") continue;
    const key = `${cell.teacherName}|${cell.grade}|${cell.classNo}|${cell.subjectName}`;
    const list = pool.get(key);
    const lesson = list?.pop();
    if (!lesson) continue;
    placeLesson(state, lesson, { day: cell.day, period: cell.period });
  }

  let pending: CommonLesson[] = [];
  for (const u of initialUnplaced) {
    const key = `${u.teacherName}|${u.grade}|${u.classNo}|${u.subjectName}`;
    const list = byKey.get(key) ?? [];
    for (let i = 0; i < u.remaining; i++) {
      const lesson = list.pop();
      if (lesson) pending.push(lesson);
    }
  }

  pending = shuffle(pending);
  let progress = true;
  while (progress && pending.length > 0 && Date.now() < deadline) {
    progress = false;
    const nextPending: CommonLesson[] = [];

    for (const lesson of pending) {
      if (Date.now() > deadline) {
        nextPending.push(lesson);
        continue;
      }

      const free = availableSlotsForLesson(
        lesson,
        schedules,
        state.classBusy,
        state.teacherBusy,
      );
      if (free.length > 0) {
        placeLesson(state, lesson, shuffle(free)[0]);
        progress = true;
        continue;
      }

      // Try displace one common cell at a candidate slot
      let placed = false;
      const periods = schedules[lesson.grade];
      const candidates: Slot[] = [];
      for (const { key: day } of WEEKDAYS) {
        const count = periods[day] ?? 0;
        for (let period = 1; period <= count; period++) {
          candidates.push({ day, period });
        }
      }

      for (const slot of shuffle(candidates)) {
        const classKey = classSlotKey(
          lesson.grade,
          lesson.classNo,
          slot.day,
          slot.period,
        );
        const teacherKey = teacherSlotKey(
          lesson.teacherName,
          slot.day,
          slot.period,
        );
        const classTaken = state.classBusy.has(classKey);
        const teacherTaken = state.teacherBusy.has(teacherKey);

        // Need exactly the conflicts we can undo (common cells only)
        const blockers = state.cells.filter((c) => {
          if (c.kind !== "common") return false;
          const sameClass =
            c.grade === lesson.grade &&
            c.classNo === lesson.classNo &&
            c.day === slot.day &&
            c.period === slot.period;
          const sameTeacher =
            c.teacherName === lesson.teacherName &&
            c.day === slot.day &&
            c.period === slot.period;
          return sameClass || sameTeacher;
        });

        // SET locks: cannot displace
        if (classTaken && !blockers.some((c) => c.grade === lesson.grade && c.classNo === lesson.classNo && c.day === slot.day && c.period === slot.period)) {
          continue;
        }
        if (
          teacherTaken &&
          !blockers.some(
            (c) =>
              c.teacherName === lesson.teacherName &&
              c.day === slot.day &&
              c.period === slot.period,
          )
        ) {
          // Teacher busy due to SET
          continue;
        }

        if (blockers.length === 0 || blockers.length > 2) continue;

        const displaced: { lesson: CommonLesson; slot: Slot }[] = [];
        let ok = true;
        for (const blocker of blockers) {
          const bKey = `${blocker.teacherName}|${blocker.grade}|${blocker.classNo}|${blocker.subjectName}`;
          // Find lesson id from assignment by matching cell
          let found: CommonLesson | null = null;
          for (const [id, assigned] of state.assignment) {
            if (
              assigned.day === blocker.day &&
              assigned.period === blocker.period
            ) {
              const L = lessons.find((l) => l.id === id);
              if (
                L &&
                L.teacherName === blocker.teacherName &&
                L.grade === blocker.grade &&
                L.classNo === blocker.classNo &&
                L.subjectName === blocker.subjectName
              ) {
                found = L;
                break;
              }
            }
          }
          if (!found) {
            ok = false;
            break;
          }
          unplaceLesson(state, found, {
            day: blocker.day,
            period: blocker.period,
          });
          displaced.push({
            lesson: found,
            slot: { day: blocker.day, period: blocker.period },
          });
        }

        if (!ok) {
          for (const d of displaced) placeLesson(state, d.lesson, d.slot);
          continue;
        }

        placeLesson(state, lesson, slot);

        let allReplaced = true;
        const stillOut: CommonLesson[] = [];
        for (const d of displaced) {
          const alt = availableSlotsForLesson(
            d.lesson,
            schedules,
            state.classBusy,
            state.teacherBusy,
          );
          if (alt.length === 0) {
            allReplaced = false;
            stillOut.push(d.lesson);
          } else {
            placeLesson(state, d.lesson, shuffle(alt)[0]);
          }
        }

        if (allReplaced) {
          placed = true;
          progress = true;
          break;
        }

        // rollback
        unplaceLesson(state, lesson, slot);
        for (const d of displaced) {
          // may already be re-placed partially
          const assigned = state.assignment.get(d.lesson.id);
          if (assigned) unplaceLesson(state, d.lesson, assigned);
          placeLesson(state, d.lesson, d.slot);
        }
        void stillOut;
      }

      if (!placed) nextPending.push(lesson);
    }

    pending = nextPending;
  }

  return {
    commonCells: state.cells,
    unplaced: toUnplacedList(pending),
  };
}

function teacherCapacityIssues(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  teacherBusySeed: Set<string>,
): string | null {
  const need = new Map<string, number>();
  for (const lesson of lessons) {
    need.set(lesson.teacherName, (need.get(lesson.teacherName) ?? 0) + 1);
  }

  for (const [teacherName, hours] of need) {
    let free = 0;
    // Union of all grade day lengths the teacher might need — use max periods per weekday across grades
    for (const { key: day } of WEEKDAYS) {
      const maxP = Math.max(
        0,
        ...GRADES.map((g) => schedules[g][day] ?? 0),
      );
      for (let period = 1; period <= maxP; period++) {
        if (!teacherBusySeed.has(teacherSlotKey(teacherName, day, period))) {
          free += 1;
        }
      }
    }
    if (hours > free) {
      return `${teacherName} 교사의 공통 시수(${hours})가 SET 잠금 후 남는 교시(${free})보다 많습니다.`;
    }
  }
  return null;
}

export type GenerateTimetableInput = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  /** Wall-clock budget for search (ms). */
  timeLimitMs?: number;
  restarts?: number;
};

export type GenerateTimetableResult = {
  cells: TimetableCell[];
  unplaced: TimetableUnplaced[];
  attemptsUsed: number;
  status: "ready" | "failed";
  message: string;
};

export function generateTimetable(
  input: GenerateTimetableInput,
): GenerateTimetableResult {
  const {
    teachers,
    subjects,
    classCounts,
    schedules,
    wholeCells,
    partialCells,
    timeLimitMs = 10_000,
    restarts = 20,
  } = input;

  const catalog = catalogGradeSets(subjects, classCounts);
  const setCells = buildSetCells({
    wholeCells,
    partialCells,
    subjects,
    classCounts,
    teachers,
    catalog,
  });

  const classBusySeed = new Set<string>();
  const teacherBusySeed = new Set<string>();
  markBusyFromSetCells(setCells, classBusySeed, teacherBusySeed);
  markTeacherBusyFromBlocks(
    wholeCells,
    partialCells,
    teachers,
    catalog,
    teacherBusySeed,
  );

  const lessons = expandCommonLessons(teachers, subjects, classCounts);

  const capacityError = teacherCapacityIssues(
    lessons,
    schedules,
    teacherBusySeed,
  );

  const searchBudget = Math.max(2000, Math.floor(timeLimitMs * 0.75));
  const repairBudget = Math.max(1000, timeLimitMs - searchBudget);

  const solved = solveBacktracking(
    lessons,
    schedules,
    classBusySeed,
    teacherBusySeed,
    {
      timeLimitMs: searchBudget,
      nodeLimit: 400_000,
      restarts,
    },
  );

  let commonCells = solved.commonCells;
  let unplaced = solved.unplaced;

  if (unplaced.length > 0) {
    let repaired = repairUnplaced(
      lessons,
      schedules,
      classBusySeed,
      teacherBusySeed,
      commonCells,
      unplaced,
      Math.floor(repairBudget * 0.55),
    );
    commonCells = repaired.commonCells;
    unplaced = repaired.unplaced;

    if (unplaced.length > 0) {
      repaired = repairUnplaced(
        lessons,
        schedules,
        classBusySeed,
        teacherBusySeed,
        commonCells,
        unplaced,
        Math.floor(repairBudget * 0.45),
      );
      commonCells = repaired.commonCells;
      unplaced = repaired.unplaced;
    }
  }

  const unplacedCount = unplaced.reduce((s, u) => s + u.remaining, 0);

  if (unplacedCount === 0) {
    return {
      cells: [...setCells, ...commonCells],
      unplaced: [],
      attemptsUsed: solved.attemptsUsed,
      status: "ready",
      message: `공통 수업 배치를 완료했습니다. (재시작 ${solved.attemptsUsed}회)`,
    };
  }

  const hint = capacityError ? ` ${capacityError}` : "";

  return {
    cells: [...setCells, ...commonCells],
    unplaced,
    attemptsUsed: solved.attemptsUsed,
    status: "failed",
    message: `일부 공통 수업을 배치하지 못했습니다. (미배치 ${unplacedCount}교시)${hint}`,
  };
}

export function cellsForClass(
  cells: TimetableCell[],
  grade: Grade,
  classNo: number,
): TimetableCell[] {
  return cells.filter((c) => c.grade === grade && c.classNo === classNo);
}

export function cellsForTeacher(
  cells: TimetableCell[],
  teacherName: string,
): TimetableCell[] {
  return cells.filter(
    (c) =>
      c.teacherName === teacherName ||
      c.teacherName.split("·").includes(teacherName),
  );
}

export function maxPeriods(schedules: GradeDaySchedules, grade: Grade): number {
  return Math.max(0, ...WEEKDAYS.map(({ key }) => schedules[grade][key] ?? 0));
}
