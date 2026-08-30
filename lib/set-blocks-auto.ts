import { DEFAULT_LUNCH_AFTER_PERIOD } from "@/lib/generation-preferences";
import {
  countPartialPlaced,
  countPlaced,
  findGradeSet,
  partialGradeSets,
  recommendSubjectRotations,
  sameSetInternalTeacherConflicts,
  slotsForGradeSet,
  subjectsNeedingRotation,
  teachersForGradeSet,
  tryPaintCell,
  tryPaintPartialCell,
  wholeGradeSets,
  type GradeSetInfo,
} from "@/lib/set-blocks";
import {
  WEEKDAYS,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type SetBlockCell,
  type SetTeacherAssignment,
  type Teacher,
  type Weekday,
} from "@/lib/types";

const NODE_LIMIT = 80_000;
const TIME_LIMIT_MS = 800;

export type AutoPlaceUnplaced = {
  grade: Grade;
  set: ElectiveSet;
  remaining: number;
  units: number;
};

export type AutoPlaceResult = {
  cells: SetBlockCell[];
  assignments: SetTeacherAssignment[];
  unplaced: AutoPlaceUnplaced[];
  warnings: string[];
};

type Slot = { day: Weekday; period: number };

type SearchTask = {
  grade: Grade;
  set: ElectiveSet;
  remaining: number;
};

function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.findIndex(({ key }) => key === day);
}

function listGradeSlots(
  schedules: GradeDaySchedules,
  grade: Grade,
): Slot[] {
  const slots: Slot[] = [];
  const periods = schedules[grade];
  if (!periods) return slots;
  for (const { key: day } of WEEKDAYS) {
    const count = periods[day] ?? 0;
    for (let period = 1; period <= count; period++) {
      slots.push({ day, period });
    }
  }
  return slots;
}

export function mergeSetTeacherAssignments(
  prev: SetTeacherAssignment[],
  entries: SetTeacherAssignment[],
): SetTeacherAssignment[] {
  const keep = prev.filter(
    (a) =>
      !entries.some(
        (e) =>
          e.grade === a.grade &&
          e.set === a.set &&
          e.day === a.day &&
          e.period === a.period &&
          e.subjectName === a.subjectName,
      ),
  );
  return [...keep, ...entries];
}

export function formatUnplacedSets(unplaced: AutoPlaceUnplaced[]): string {
  return unplaced
    .map((item) => `${item.grade}학년 SET ${item.set} ${item.remaining}교시`)
    .join(", ");
}

export function formatAutoPlaceOutcome(
  placedLabel: string,
  result: AutoPlaceResult,
): { error: boolean; message: string } {
  const parts: string[] = [];
  if (result.unplaced.length > 0) {
    parts.push(
      `${formatUnplacedSets(result.unplaced)}를 배치하지 못했습니다. 칸을 확인한 뒤 저장해 주세요.`,
    );
  } else {
    parts.push(`${placedLabel}를 자동 배치했습니다. 저장을 눌러 반영해 주세요.`);
  }
  if (result.warnings.length > 0) {
    parts.push(result.warnings.join(" "));
  }
  return {
    error: result.unplaced.length > 0,
    message: parts.join(" "),
  };
}

function dummyCellFor(info: GradeSetInfo): SetBlockCell {
  return { grade: info.grade, set: info.set, day: "mon", period: 1 };
}

/** True when two subjects in this SET share a sole teacher, so any slot is illegal. */
function structuralInternalConflict(
  teachers: Teacher[],
  catalog: GradeSetInfo[],
  info: GradeSetInfo,
) {
  const dummy = [dummyCellFor(info)];
  const whole = info.kind === "whole" ? dummy : [];
  const partial = info.kind === "partial" ? dummy : [];
  return sameSetInternalTeacherConflicts(
    whole,
    partial,
    teachers,
    catalog,
    [],
  )[0];
}

function structuralNotesFor(
  items: GradeSetInfo[],
  teachers: Teacher[],
  catalog: GradeSetInfo[],
): { blocked: Set<string>; warnings: string[] } {
  const blocked = new Set<string>();
  const warnings: string[] = [];
  for (const info of items) {
    const conflict = structuralInternalConflict(teachers, catalog, info);
    if (!conflict) continue;
    blocked.add(`${info.grade}:${info.set}`);
    warnings.push(
      `${info.grade}학년 SET ${info.set}: 같은 SET 안에서 교사 ${conflict.teacherName}이(가) "${conflict.subjectNames.join('", "')}"을 동시에 맡습니다. 교사 배정을 확인해 주세요.`,
    );
  }
  return { blocked, warnings };
}

function slotScore(args: {
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
  cells: SetBlockCell[];
  lunchAfterPeriod: number;
}): number {
  const { grade, set, day, period, cells, lunchAfterPeriod } = args;
  const sameSet = cells.filter(
    (cell) => cell.grade === grade && cell.set === set,
  );
  const sameGrade = cells.filter((cell) => cell.grade === grade);

  let score = 0;
  score += sameSet.filter((cell) => cell.day === day).length * 50;
  score += sameGrade.filter((cell) => cell.day === day).length * 10;
  if (sameSet.some((cell) => cell.day === day && Math.abs(cell.period - period) === 1)) {
    score += 20;
  }
  if (period === lunchAfterPeriod || period === lunchAfterPeriod + 1) {
    score += 15;
  }
  if (period === 1) score += 8;
  score += sameSet.filter((cell) => cell.period === period).length * 3;
  const aligned = cells.some(
    (cell) =>
      cell.grade !== grade && cell.day === day && cell.period === period,
  );
  if (aligned) score -= 5;
  score += weekdayIndex(day) * 0.01 + period * 0.001;
  return score;
}

function teachersOverlap(
  teachers: Teacher[],
  a: GradeSetInfo,
  b: GradeSetInfo,
): boolean {
  const busyB = new Set(teachersForGradeSet(teachers, b));
  return teachersForGradeSet(teachers, a).some((name) => busyB.has(name));
}

function remainingOf(
  tasks: SearchTask[],
  catalog: GradeSetInfo[],
  countFn: (grade: Grade, set: ElectiveSet) => number,
): AutoPlaceUnplaced[] {
  return tasks
    .map((task) => {
      const info = findGradeSet(catalog, task.grade, task.set);
      const units = info?.units ?? 0;
      const remaining = Math.max(0, units - countFn(task.grade, task.set));
      return { grade: task.grade, set: task.set, remaining, units };
    })
    .filter((item) => item.remaining > 0);
}

function applyBestRotations(args: {
  teachers: Teacher[];
  catalog: GradeSetInfo[];
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  assignments: SetTeacherAssignment[];
}): { assignments: SetTeacherAssignment[]; warnings: string[] } {
  const { teachers, catalog, wholeCells, partialCells } = args;
  let assignments = args.assignments;
  const warnings: string[] = [];

  for (const info of catalog) {
    if (info.kind === "invalid" || info.units === null) continue;
    const slots = slotsForGradeSet(
      wholeCells,
      partialCells,
      info.grade,
      info.set,
    );
    if (slots.length !== info.units) continue;

    for (const rotation of subjectsNeedingRotation(teachers, info)) {
      const combos = recommendSubjectRotations({
        teachers,
        catalog,
        wholeCells,
        partialCells,
        assignments,
        grade: info.grade,
        set: info.set,
        shares: rotation.shares,
        slots,
        limit: 24,
      });
      let applied = false;
      for (const combo of combos) {
        const next = mergeSetTeacherAssignments(
          assignments,
          slots.map((slot, i) => ({
            grade: info.grade,
            set: info.set,
            day: slot.day,
            period: slot.period,
            subjectName: rotation.subjectName,
            teacherName: combo.teacherNames[i],
          })),
        );
        if (
          sameSetInternalTeacherConflicts(
            wholeCells,
            partialCells,
            teachers,
            catalog,
            next,
          ).length > 0
        ) {
          continue;
        }
        assignments = next;
        applied = true;
        break;
      }
      if (!applied && combos.length > 0) {
        warnings.push(
          `${info.grade}학년 SET ${info.set}의 "${rotation.subjectName}"은 같은 SET 안 교사 겹침 없이 담당 조합을 고르지 못했습니다.`,
        );
      }
    }
  }

  return { assignments, warnings };
}

function pickTaskIndex(
  tasks: SearchTask[],
  legalCounts: number[],
  teacherCounts: number[],
): number {
  let best = -1;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].remaining <= 0) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const legal = legalCounts[i];
    const bestLegal = legalCounts[best];
    if (legal < bestLegal) {
      best = i;
      continue;
    }
    if (legal === bestLegal && teacherCounts[i] > teacherCounts[best]) {
      best = i;
    }
  }
  return best;
}

function searchPlacement<TCandidate extends Slot & { nextCells: SetBlockCell[] }>(
  tasks: SearchTask[],
  startCells: SetBlockCell[],
  teacherCounts: number[],
  listCandidates: (
    task: SearchTask,
    cells: SetBlockCell[],
  ) => TCandidate[],
): SetBlockCell[] {
  const deadline = Date.now() + TIME_LIMIT_MS;
  let nodes = 0;
  let bestCells = startCells;
  let bestRemaining = tasks.reduce((sum, task) => sum + task.remaining, 0);

  function remainingTotal(): number {
    return tasks.reduce((sum, task) => sum + task.remaining, 0);
  }

  function search(cells: SetBlockCell[]): boolean {
    const left = remainingTotal();
    if (left < bestRemaining) {
      bestRemaining = left;
      bestCells = cells;
    }
    if (left === 0) return true;
    if (nodes >= NODE_LIMIT || Date.now() > deadline) return false;
    nodes += 1;

    const legalByTask = tasks.map((task) =>
      task.remaining <= 0 ? Number.POSITIVE_INFINITY : listCandidates(task, cells).length,
    );
    const taskIndex = pickTaskIndex(tasks, legalByTask, teacherCounts);
    if (taskIndex < 0) return true;
    if (legalByTask[taskIndex] === 0) return false;

    const task = tasks[taskIndex];
    const candidates = listCandidates(task, cells);
    for (const candidate of candidates) {
      task.remaining -= 1;
      const ok = search(candidate.nextCells);
      task.remaining += 1;
      if (ok) return true;
      if (nodes >= NODE_LIMIT || Date.now() > deadline) return false;
    }
    return false;
  }

  search(startCells);
  return bestCells;
}

function wouldStarvePartials(args: {
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  wholeInfo: GradeSetInfo;
}): boolean {
  const {
    wholeCells,
    partialCells,
    catalog,
    classCounts,
    teachers,
    schedules,
    wholeInfo,
  } = args;

  for (const partial of partialGradeSets(catalog)) {
    const remaining =
      (partial.units ?? 0) -
      countPartialPlaced(partialCells, partial.grade, partial.set);
    if (remaining <= 0) continue;
    if (
      partial.grade !== wholeInfo.grade &&
      !teachersOverlap(teachers, wholeInfo, partial)
    ) {
      continue;
    }

    let legal = 0;
    for (const slot of listGradeSlots(schedules, partial.grade)) {
      const painted = tryPaintPartialCell({
        wholeCells,
        partialCells,
        catalog,
        classCounts,
        teachers,
        schedules,
        grade: partial.grade,
        set: partial.set,
        day: slot.day,
        period: slot.period,
      });
      if (!painted.error) legal += 1;
      if (legal >= remaining) break;
    }
    if (legal < remaining) return true;
  }

  return false;
}

function wouldStarveOtherPartials(args: {
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  placedInfo: GradeSetInfo;
}): boolean {
  const {
    wholeCells,
    partialCells,
    catalog,
    classCounts,
    teachers,
    schedules,
    placedInfo,
  } = args;

  for (const other of partialGradeSets(catalog)) {
    if (other.grade === placedInfo.grade && other.set === placedInfo.set) {
      continue;
    }
    const remaining =
      (other.units ?? 0) - countPartialPlaced(partialCells, other.grade, other.set);
    if (remaining <= 0) continue;
    if (
      other.grade !== placedInfo.grade &&
      !teachersOverlap(teachers, placedInfo, other)
    ) {
      continue;
    }

    let legal = 0;
    for (const slot of listGradeSlots(schedules, other.grade)) {
      const painted = tryPaintPartialCell({
        wholeCells,
        partialCells,
        catalog,
        classCounts,
        teachers,
        schedules,
        grade: other.grade,
        set: other.set,
        day: slot.day,
        period: slot.period,
      });
      if (!painted.error) legal += 1;
      if (legal >= remaining) break;
    }
    if (legal < remaining) return true;
  }

  return false;
}

/**
 * Fills remaining whole-grade SET occurrences. Existing `cells` are kept.
 * Uses `tryPaintCell` for hard constraints, then applies the best teacher
 * rotation for every SET that ends up fully placed.
 */
export function autoPlaceWholeSets(args: {
  cells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
  assignments?: SetTeacherAssignment[];
  lunchAfterPeriod?: number;
}): AutoPlaceResult {
  const {
    partialCells,
    catalog,
    teachers,
    schedules,
    classCounts,
    assignments = [],
    lunchAfterPeriod = DEFAULT_LUNCH_AFTER_PERIOD,
  } = args;
  const startCells = args.cells;
  const wholes = wholeGradeSets(catalog);
  const structural = structuralNotesFor(wholes, teachers, catalog);
  const placeable = wholes.filter(
    (info) => !structural.blocked.has(`${info.grade}:${info.set}`),
  );
  const tasks: SearchTask[] = placeable.map((info) => ({
    grade: info.grade,
    set: info.set,
    remaining: Math.max(
      0,
      (info.units ?? 0) - countPlaced(startCells, info.grade, info.set),
    ),
  }));
  const teacherCounts = placeable.map((info) => teachersForGradeSet(teachers, info).length);

  const listCandidates = (
    task: SearchTask,
    cells: SetBlockCell[],
    guardPartials: boolean,
  ) => {
    const info = findGradeSet(catalog, task.grade, task.set);
    const scored: { day: Weekday; period: number; nextCells: SetBlockCell[]; score: number }[] =
      [];
    if (!info) return scored;
    for (const slot of listGradeSlots(schedules, task.grade)) {
      const painted = tryPaintCell({
        cells,
        partialCells,
        catalog,
        teachers,
        schedules,
        grade: task.grade,
        set: task.set,
        day: slot.day,
        period: slot.period,
        assignments,
      });
      if (painted.error) continue;
      if (
        guardPartials &&
        wouldStarvePartials({
          wholeCells: painted.cells,
          partialCells,
          catalog,
          classCounts,
          teachers,
          schedules,
          wholeInfo: info,
        })
      ) {
        continue;
      }
      scored.push({
        ...slot,
        nextCells: painted.cells,
        score: slotScore({
          grade: task.grade,
          set: task.set,
          day: slot.day,
          period: slot.period,
          cells,
          lunchAfterPeriod,
        }),
      });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored;
  };

  let placed = searchPlacement(tasks, startCells, teacherCounts, (task, cells) =>
    listCandidates(task, cells, true),
  );
  const stillLeft = (cells: SetBlockCell[]) =>
    remainingOf(tasks, catalog, (grade, set) => countPlaced(cells, grade, set));

  if (stillLeft(placed).length > 0) {
    for (const task of tasks) {
      const info = findGradeSet(catalog, task.grade, task.set);
      task.remaining = Math.max(
        0,
        (info?.units ?? 0) - countPlaced(startCells, task.grade, task.set),
      );
    }
    placed = searchPlacement(tasks, startCells, teacherCounts, (task, cells) =>
      listCandidates(task, cells, false),
    );
  }

  const unplaced = [
    ...wholes
      .filter((info) => structural.blocked.has(`${info.grade}:${info.set}`))
      .map((info) => ({
        grade: info.grade,
        set: info.set,
        remaining: Math.max(
          0,
          (info.units ?? 0) - countPlaced(startCells, info.grade, info.set),
        ),
        units: info.units ?? 0,
      }))
      .filter((item) => item.remaining > 0),
    ...stillLeft(placed),
  ];
  const rotated = applyBestRotations({
    teachers,
    catalog,
    wholeCells: placed,
    partialCells,
    assignments,
  });

  return {
    cells: placed,
    assignments: rotated.assignments,
    unplaced,
    warnings: [...structural.warnings, ...rotated.warnings],
  };
}

/**
 * Fills remaining partial SET occurrences. Existing `partialCells` are kept.
 * Whole-grade cells stay locked. Applies teacher rotations for completed SETs.
 */
export function autoPlacePartialSets(args: {
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  catalog: GradeSetInfo[];
  teachers: Teacher[];
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
  assignments?: SetTeacherAssignment[];
  lunchAfterPeriod?: number;
}): AutoPlaceResult {
  const {
    wholeCells,
    catalog,
    teachers,
    schedules,
    classCounts,
    assignments = [],
    lunchAfterPeriod = DEFAULT_LUNCH_AFTER_PERIOD,
  } = args;
  const startCells = args.partialCells;
  const partials = partialGradeSets(catalog);
  const structural = structuralNotesFor(partials, teachers, catalog);
  const placeable = partials.filter(
    (info) => !structural.blocked.has(`${info.grade}:${info.set}`),
  );
  const tasks: SearchTask[] = placeable.map((info) => ({
    grade: info.grade,
    set: info.set,
    remaining: Math.max(
      0,
      (info.units ?? 0) - countPartialPlaced(startCells, info.grade, info.set),
    ),
  }));
  const teacherCounts = placeable.map(
    (info) => teachersForGradeSet(teachers, info).length,
  );

  const listCandidates = (
    task: SearchTask,
    cells: SetBlockCell[],
    guardOthers: boolean,
  ) => {
    const info = findGradeSet(catalog, task.grade, task.set);
    const scored: { day: Weekday; period: number; nextCells: SetBlockCell[]; score: number }[] =
      [];
    if (!info) return scored;
    for (const slot of listGradeSlots(schedules, task.grade)) {
      const painted = tryPaintPartialCell({
        wholeCells,
        partialCells: cells,
        catalog,
        classCounts,
        teachers,
        schedules,
        grade: task.grade,
        set: task.set,
        day: slot.day,
        period: slot.period,
        assignments,
      });
      if (painted.error) continue;
      if (
        guardOthers &&
        wouldStarveOtherPartials({
          wholeCells,
          partialCells: painted.cells,
          catalog,
          classCounts,
          teachers,
          schedules,
          placedInfo: info,
        })
      ) {
        continue;
      }
      scored.push({
        ...slot,
        nextCells: painted.cells,
        score: slotScore({
          grade: task.grade,
          set: task.set,
          day: slot.day,
          period: slot.period,
          cells,
          lunchAfterPeriod,
        }),
      });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored;
  };

  let placed = searchPlacement(tasks, startCells, teacherCounts, (task, cells) =>
    listCandidates(task, cells, true),
  );
  const stillLeft = (cells: SetBlockCell[]) =>
    remainingOf(tasks, catalog, (grade, set) =>
      countPartialPlaced(cells, grade, set),
    );

  if (stillLeft(placed).length > 0) {
    for (const task of tasks) {
      const info = findGradeSet(catalog, task.grade, task.set);
      task.remaining = Math.max(
        0,
        (info?.units ?? 0) - countPartialPlaced(startCells, task.grade, task.set),
      );
    }
    placed = searchPlacement(tasks, startCells, teacherCounts, (task, cells) =>
      listCandidates(task, cells, false),
    );
  }

  const unplaced = [
    ...partials
      .filter((info) => structural.blocked.has(`${info.grade}:${info.set}`))
      .map((info) => ({
        grade: info.grade,
        set: info.set,
        remaining: Math.max(
          0,
          (info.units ?? 0) -
            countPartialPlaced(startCells, info.grade, info.set),
        ),
        units: info.units ?? 0,
      }))
      .filter((item) => item.remaining > 0),
    ...stillLeft(placed),
  ];
  const rotated = applyBestRotations({
    teachers,
    catalog,
    wholeCells,
    partialCells: placed,
    assignments,
  });

  return {
    cells: placed,
    assignments: rotated.assignments,
    unplaced,
    warnings: [...structural.warnings, ...rotated.warnings],
  };
}
