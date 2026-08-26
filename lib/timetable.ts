import {
  catalogGradeSets,
  findGradeSet,
  homeRoomsForPartialSet,
  resolveSubjectTeachersAtSlot,
  teachersBusyForGradeSetAtSlot,
  type GradeSetInfo,
} from "@/lib/set-blocks";
import {
  DEFAULT_LUNCH_AFTER_PERIOD,
  createDefaultGenerationPreferences,
  hasSoftPreferences,
  isTripleRunWindow,
  lunchDoubleWeight,
  lunchPairPeriods,
  sameDaySubjectBanKey,
} from "@/lib/generation-preferences";
import {
  consumeLessonsForSubjectBlocks,
  filterSubjectBlocksToAssignments,
  markBusyFromSubjectBlocks,
  subjectBlocksToTimetableCells,
} from "@/lib/subject-blocks";
import { isSetSubject } from "@/lib/teachers";
import {
  GRADES,
  WEEKDAYS,
  type GenerationPreferences,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SameDaySubjectBan,
  type SameDaySubjectViolation,
  type SetBlockCell,
  type SetTeacherAssignment,
  type SoftRunDetail,
  type SubjectBlockCell,
  type Teacher,
  type TeacherForbiddenSlot,
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
  teacherAssignments?: SetTeacherAssignment[];
}): TimetableCell[] {
  const {
    wholeCells,
    partialCells,
    subjects,
    classCounts,
    teachers,
    catalog,
    teacherAssignments = [],
  } = args;
  const cells: TimetableCell[] = [];

  for (const cell of wholeCells) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    const gradeSubjects = subjects[cell.grade] ?? [];
    const n = classCounts[cell.grade];

    // Fallback for rooms without a classNo assignment yet (e.g. saved before
    // per-room mapping existed): the generic "SET X" label with every
    // variant's teachers combined, same as before this room-level mapping.
    const fallbackTeacherNames = info
      ? teachersBusyForGradeSetAtSlot(
          teachers,
          info,
          cell.day,
          cell.period,
          teacherAssignments,
        )
      : [];
    const fallbackTeacherName =
      fallbackTeacherNames.length > 0 ? fallbackTeacherNames.join("·") : "—";

    for (let classNo = 1; classNo <= n; classNo++) {
      const subject = gradeSubjects.find(
        (s) => s.set === cell.set && s.classNo === classNo,
      );
      if (!subject || !info) {
        cells.push({
          grade: cell.grade,
          classNo,
          day: cell.day,
          period: cell.period,
          subjectName: `SET ${cell.set}`,
          teacherName: fallbackTeacherName,
          kind: "set",
          set: cell.set,
        });
        continue;
      }
      const teacherNames = resolveSubjectTeachersAtSlot(
        teachers,
        info,
        subject.name,
        cell.day,
        cell.period,
        teacherAssignments,
      );
      cells.push({
        grade: cell.grade,
        classNo,
        day: cell.day,
        period: cell.period,
        subjectName: subject.name,
        teacherName:
          teacherNames.length > 0 ? teacherNames.join("·") : "—",
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
      const teacherNames = info
        ? resolveSubjectTeachersAtSlot(
            teachers,
            info,
            subjectName,
            cell.day,
            cell.period,
            teacherAssignments,
          )
        : teachersForSubject(teachers, cell.grade, subjectName);
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
  teacherAssignments: SetTeacherAssignment[] = [],
) {
  for (const cell of [...wholeCells, ...partialCells]) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      info,
      cell.day,
      cell.period,
      teacherAssignments,
    )) {
      teacherBusy.add(teacherSlotKey(name, cell.day, cell.period));
    }
  }
}

function availableSlotsForLesson(
  lesson: Pick<CommonLesson, "teacherName" | "grade" | "classNo">,
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

function teacherNamesOnCell(cell: TimetableCell): string[] {
  return cell.teacherName
    .split("·")
    .map((n) => n.trim())
    .filter(Boolean);
}

function teacherHasLessonAt(
  teacherName: string,
  day: Weekday,
  period: number,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
): boolean {
  const name = teacherName.trim();
  if (!name) return false;
  for (const cell of fixedCells) {
    if (cell.day !== day || cell.period !== period) continue;
    if (teacherNamesOnCell(cell).includes(name)) return true;
  }
  for (const cell of placed) {
    if (cell.day !== day || cell.period !== period) continue;
    if (teacherNamesOnCell(cell).includes(name)) return true;
  }
  return false;
}

/** Same teacher assigned on both sides of lunch. */
function lunchDoublePenaltyForSlot(
  lesson: CommonLesson,
  slot: Slot,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
  lunchAfterPeriod: number,
): number {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  if (slot.period !== before && slot.period !== after) return 0;
  const partner = slot.period === before ? after : before;
  return teacherHasLessonAt(
    lesson.teacherName,
    slot.day,
    partner,
    fixedCells,
    placed,
  )
    ? 1
    : 0;
}

/** Same teacher would end up with 3 consecutive taught periods (any class/subject). */
function triplePeriodPenaltyForSlot(
  lesson: CommonLesson,
  slot: Slot,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
  lunchAfterPeriod: number,
): number {
  const teacherHasPeriod = (period: number) =>
    period === slot.period ||
    teacherHasLessonAt(lesson.teacherName, slot.day, period, fixedCells, placed);

  for (let start = slot.period - 2; start <= slot.period; start++) {
    if (start < 1) continue;
    if (!isTripleRunWindow(start, lunchAfterPeriod)) continue;
    if (
      teacherHasPeriod(start) &&
      teacherHasPeriod(start + 1) &&
      teacherHasPeriod(start + 2)
    ) {
      return 1;
    }
  }
  return 0;
}

function softSlotPenalty(
  lesson: CommonLesson,
  slot: Slot,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
  preferences: GenerationPreferences,
): number {
  let penalty = 0;
  if (preferences.avoidLunchDouble) {
    penalty +=
      lunchDoublePenaltyForSlot(
        lesson,
        slot,
        fixedCells,
        placed,
        preferences.lunchAfterPeriod,
      ) * lunchDoubleWeight(preferences);
  }
  if (preferences.avoidTriplePeriod) {
    penalty += triplePeriodPenaltyForSlot(
      lesson,
      slot,
      fixedCells,
      placed,
      preferences.lunchAfterPeriod,
    );
  }
  return penalty;
}

/** Prefer slots with lower soft penalty; shuffle ties. */
function orderSlotsForLesson(
  lesson: CommonLesson,
  slots: Slot[],
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
  preferences: GenerationPreferences,
): Slot[] {
  if (!hasSoftPreferences(preferences) || slots.length <= 1) {
    return shuffle(slots);
  }
  const scored = slots.map((slot) => ({
    slot,
    penalty: softSlotPenalty(lesson, slot, fixedCells, placed, preferences),
    rand: Math.random(),
  }));
  scored.sort((a, b) => a.penalty - b.penalty || a.rand - b.rand);
  return scored.map((s) => s.slot);
}

/**
 * Domain for a lesson during search. When `hardAvoidLunch` is on, slots that
 * would straddle lunch with a lesson the same teacher already has (fixed or
 * placed so far) are removed from the domain entirely — not just deprioritized.
 * Because this is re-evaluated fresh at every step against the current
 * placement, any complete assignment reached under this mode is guaranteed to
 * have zero teacher lunch doubles among common lessons.
 */
function slotsForLessonSearch(
  lesson: CommonLesson,
  schedules: GradeDaySchedules,
  classBusy: Set<string>,
  teacherBusy: Set<string>,
  hardAvoidLunch: boolean,
  lunchAfterPeriod: number,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
): Slot[] {
  const slots = availableSlotsForLesson(lesson, schedules, classBusy, teacherBusy);
  if (!hardAvoidLunch) return slots;

  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  return slots.filter((slot) => {
    if (slot.period !== before && slot.period !== after) return true;
    const partner = slot.period === before ? after : before;
    return !teacherHasLessonAt(
      lesson.teacherName,
      slot.day,
      partner,
      fixedCells,
      placed,
    );
  });
}

function formatLessonBrief(cell: TimetableCell): string {
  return `${cell.grade}학년 ${cell.classNo}반 ${cell.subjectName}`;
}

/**
 * Same teacher teaching on both sides of lunch (any class/subject).
 * One entry per teacher+day.
 */
export function listLunchTeacherDoubles(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): SoftRunDetail[] {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const beforeByTeacherDay = new Map<string, TimetableCell>();
  const afterByTeacherDay = new Map<string, TimetableCell>();

  for (const cell of cells) {
    if (cell.period !== before && cell.period !== after) continue;
    for (const name of teacherNamesOnCell(cell)) {
      const key = `${name}|${cell.day}`;
      if (cell.period === before) beforeByTeacherDay.set(key, cell);
      else afterByTeacherDay.set(key, cell);
    }
  }

  const out: SoftRunDetail[] = [];
  for (const [key, beforeCell] of beforeByTeacherDay) {
    const afterCell = afterByTeacherDay.get(key);
    if (!afterCell) continue;
    const sep = key.indexOf("|");
    const teacherName = key.slice(0, sep);
    const day = key.slice(sep + 1) as Weekday;
    out.push({
      kind: "lunch",
      grade: beforeCell.grade,
      classNo: beforeCell.classNo,
      day,
      subjectName: `${formatLessonBrief(beforeCell)} / ${formatLessonBrief(afterCell)}`,
      teacherName,
      startPeriod: before,
      endPeriod: after,
    });
  }
  out.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    return a.teacherName.localeCompare(b.teacherName, "ko");
  });
  return out;
}

/** @deprecated alias — lunch doubles are teacher-based. */
export function listLunchSubjectDoubles(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): SoftRunDetail[] {
  return listLunchTeacherDoubles(cells, lunchAfterPeriod);
}

export function countLunchTeacherDoubles(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): number {
  return listLunchTeacherDoubles(cells, lunchAfterPeriod).length;
}

/** Count same-teacher lunch straddles. */
export function countLunchSubjectDoubles(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): number {
  return countLunchTeacherDoubles(cells, lunchAfterPeriod);
}

function sameTimetableCell(a: TimetableCell, b: TimetableCell): boolean {
  return (
    a.grade === b.grade &&
    a.classNo === b.classNo &&
    a.day === b.day &&
    a.period === b.period &&
    a.subjectName === b.subjectName &&
    a.teacherName === b.teacherName &&
    a.kind === b.kind
  );
}

function isFixedTimetableCell(
  cell: TimetableCell,
  fixedCells: TimetableCell[],
): boolean {
  return fixedCells.some((f) => sameTimetableCell(f, cell));
}

function findTeacherLessonAt(
  cells: TimetableCell[],
  teacherName: string,
  day: Weekday,
  period: number,
): TimetableCell | undefined {
  const name = teacherName.trim();
  return cells.find(
    (c) =>
      c.day === day &&
      c.period === period &&
      teacherNamesOnCell(c).includes(name),
  );
}

function buildOccupancy(cells: TimetableCell[]): {
  classBusy: Set<string>;
  teacherBusy: Set<string>;
} {
  const classBusy = new Set<string>();
  const teacherBusy = new Set<string>();
  for (const cell of cells) {
    classBusy.add(
      classSlotKey(cell.grade, cell.classNo, cell.day, cell.period),
    );
    for (const name of teacherNamesOnCell(cell)) {
      teacherBusy.add(teacherSlotKey(name, cell.day, cell.period));
    }
  }
  return { classBusy, teacherBusy };
}

/** Free slots for relocating one common cell (class + all its teachers). */
function candidateSlotsForCommonMove(
  cell: TimetableCell,
  otherCells: TimetableCell[],
  schedules: GradeDaySchedules,
): Slot[] {
  const { classBusy, teacherBusy } = buildOccupancy(otherCells);
  const teachers = teacherNamesOnCell(cell);
  const slots: Slot[] = [];
  const periods = schedules[cell.grade];
  for (const { key: day } of WEEKDAYS) {
    const count = periods[day] ?? 0;
    for (let period = 1; period <= count; period++) {
      if (day === cell.day && period === cell.period) continue;
      if (
        classBusy.has(classSlotKey(cell.grade, cell.classNo, day, period))
      ) {
        continue;
      }
      if (
        teachers.some((name) =>
          teacherBusy.has(teacherSlotKey(name, day, period)),
        )
      ) {
        continue;
      }
      slots.push({ day, period });
    }
  }
  return slots;
}

function lunchDoubleCountIfMoved(
  fixedCells: TimetableCell[],
  commonCells: TimetableCell[],
  commonIndex: number,
  slot: Slot,
  lunchAfterPeriod: number,
): number {
  const nextCommon = commonCells.map((c, i) =>
    i === commonIndex ? { ...c, day: slot.day, period: slot.period } : c,
  );
  return countLunchTeacherDoubles(
    [...fixedCells, ...nextCommon],
    lunchAfterPeriod,
  );
}

/**
 * Hill-climb: move movable common lessons off lunch doubles when a free
 * alternative slot exists. SET / 교과 블록 cells are never moved.
 */
export function improveLunchTeacherDoubles(args: {
  fixedCells: TimetableCell[];
  commonCells: TimetableCell[];
  schedules: GradeDaySchedules;
  lunchAfterPeriod: number;
  timeLimitMs: number;
}): {
  commonCells: TimetableCell[];
  beforeCount: number;
  afterCount: number;
  moves: number;
} {
  const { fixedCells, schedules, lunchAfterPeriod } = args;
  const deadline = Date.now() + Math.max(0, args.timeLimitMs);
  let commonCells = [...args.commonCells];
  const beforeCount = countLunchTeacherDoubles(
    [...fixedCells, ...commonCells],
    lunchAfterPeriod,
  );
  let afterCount = beforeCount;
  let moves = 0;

  if (beforeCount === 0 || args.timeLimitMs <= 0) {
    return { commonCells, beforeCount, afterCount, moves };
  }

  let guard = 0;
  while (Date.now() < deadline && guard < 500) {
    guard += 1;
    const all = [...fixedCells, ...commonCells];
    const doubles = listLunchTeacherDoubles(all, lunchAfterPeriod);
    if (doubles.length === 0) break;

    let progressed = false;
    for (const detail of doubles) {
      if (Date.now() >= deadline) break;

      const sides = [
        findTeacherLessonAt(
          all,
          detail.teacherName,
          detail.day,
          detail.startPeriod,
        ),
        findTeacherLessonAt(
          all,
          detail.teacherName,
          detail.day,
          detail.endPeriod,
        ),
      ];

      for (const side of sides) {
        if (!side || side.kind !== "common") continue;
        if (isFixedTimetableCell(side, fixedCells)) continue;

        const commonIndex = commonCells.findIndex((c) =>
          sameTimetableCell(c, side),
        );
        if (commonIndex < 0) continue;

        const others = all.filter((c) => !sameTimetableCell(c, side));
        const candidates = shuffle(
          candidateSlotsForCommonMove(side, others, schedules),
        );
        if (candidates.length === 0) continue;

        const current = afterCount;
        // Prefer moves that clear this teacher's lunch pair first (heuristic order).
        const [beforeP, afterP] = lunchPairPeriods(lunchAfterPeriod);
        const ranked = [...candidates].sort((a, b) => {
          const score = (slot: Slot) => {
            // Avoid landing on the other lunch side same day for this teacher.
            if (
              slot.day === detail.day &&
              (slot.period === beforeP || slot.period === afterP)
            ) {
              return 1;
            }
            return 0;
          };
          return score(a) - score(b) || Math.random() - 0.5;
        });

        for (const slot of ranked) {
          if (Date.now() >= deadline) break;
          const nextCount = lunchDoubleCountIfMoved(
            fixedCells,
            commonCells,
            commonIndex,
            slot,
            lunchAfterPeriod,
          );
          if (nextCount < current) {
            commonCells = commonCells.map((c, i) =>
              i === commonIndex
                ? { ...c, day: slot.day, period: slot.period }
                : c,
            );
            afterCount = nextCount;
            moves += 1;
            progressed = true;
            break;
          }
        }
        if (progressed) break;
      }
      if (progressed) break;
    }

    if (!progressed) break;
  }

  return { commonCells, beforeCount, afterCount, moves };
}

/**
 * Same class+subject 3-period runs (lunch boundary breaks the run).
 * Overlapping windows each count (e.g. 4-in-a-row → 2).
 */
/**
 * Same teacher teaching 3+ consecutive periods, any class/subject (lunch
 * boundary breaks the run). Overlapping windows each count (4-in-a-row → 2),
 * one entry per teacher+day+window.
 */
export function listTeacherTripleRuns(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): SoftRunDetail[] {
  const byTeacherDay = new Map<string, Map<number, TimetableCell>>();
  for (const cell of cells) {
    for (const name of teacherNamesOnCell(cell)) {
      const key = `${name}|${cell.day}`;
      if (!byTeacherDay.has(key)) byTeacherDay.set(key, new Map());
      byTeacherDay.get(key)!.set(cell.period, cell);
    }
  }

  const out: SoftRunDetail[] = [];
  for (const [key, byPeriod] of byTeacherDay) {
    const sep = key.indexOf("|");
    const teacherName = key.slice(0, sep);
    const day = key.slice(sep + 1) as Weekday;
    for (const start of byPeriod.keys()) {
      if (!isTripleRunWindow(start, lunchAfterPeriod)) continue;
      const c0 = byPeriod.get(start);
      const c1 = byPeriod.get(start + 1);
      const c2 = byPeriod.get(start + 2);
      if (!c0 || !c1 || !c2) continue;
      out.push({
        kind: "triple",
        grade: c0.grade,
        classNo: c0.classNo,
        day,
        subjectName: [c0, c1, c2].map(formatLessonBrief).join(" / "),
        teacherName,
        startPeriod: start,
        endPeriod: start + 2,
      });
    }
  }
  out.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (a.startPeriod !== b.startPeriod) return a.startPeriod - b.startPeriod;
    return a.teacherName.localeCompare(b.teacherName, "ko");
  });
  return out;
}

/**
 * Count same-teacher 3+ consecutive-period runs (lunch boundary breaks the
 * run). Overlapping windows each count (e.g. 4-in-a-row → 2).
 */
export function countTeacherTripleRuns(
  cells: TimetableCell[],
  lunchAfterPeriod: number,
): number {
  return listTeacherTripleRuns(cells, lunchAfterPeriod).length;
}

function softPreferenceScore(
  cells: TimetableCell[],
  preferences: GenerationPreferences,
): number {
  let score = 0;
  if (preferences.avoidLunchDouble) {
    score +=
      countLunchTeacherDoubles(cells, preferences.lunchAfterPeriod) *
      lunchDoubleWeight(preferences);
  }
  if (preferences.avoidTriplePeriod) {
    score += countTeacherTripleRuns(cells, preferences.lunchAfterPeriod);
  }
  return score;
}

function unplacedKey(
  lesson: Pick<CommonLesson, "teacherName" | "grade" | "classNo" | "subjectName">,
): string {
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

/**
 * Classify each still-unplaced lesson group against the final committed
 * schedule (seed busy state + every placed common cell): if zero slots exist
 * where the class and teacher are both free, it's genuinely "impossible" no
 * matter how much more search time is spent; if at least one slot exists in
 * isolation, other lessons simply ended up occupying it ("contention").
 */
function classifyUnplacedLessons(
  unplaced: TimetableUnplaced[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  commonCells: TimetableCell[],
): TimetableUnplaced[] {
  const classBusy = new Set(classBusySeed);
  const teacherBusy = new Set(teacherBusySeed);
  for (const cell of commonCells) {
    classBusy.add(
      classSlotKey(cell.grade, cell.classNo, cell.day, cell.period),
    );
    teacherBusy.add(teacherSlotKey(cell.teacherName, cell.day, cell.period));
  }
  return unplaced.map((u) => {
    const free = availableSlotsForLesson(u, schedules, classBusy, teacherBusy);
    return { ...u, reason: free.length === 0 ? "impossible" : "contention" };
  });
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
 * Soft preferences bias slot order; when any soft preference is on, keeps
 * searching for a complete solution with a lower combined soft penalty.
 */
function solveBacktracking(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  fixedCells: TimetableCell[],
  preferences: GenerationPreferences,
  options: {
    timeLimitMs: number;
    nodeLimit: number;
    restarts: number;
    /** Exclude lunch-straddling slots from the domain instead of just deprioritizing them. */
    hardAvoidLunch: boolean;
  },
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
  let bestComplete: TimetableCell[] | null = null;
  let bestCompletePenalty = Infinity;

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

  const scoreComplete = (commonCells: TimetableCell[]) =>
    softPreferenceScore([...fixedCells, ...commonCells], preferences);

  const keepSearchingAfterComplete = () => hasSoftPreferences(preferences);

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
        const slots = slotsForLessonSearch(
          lesson,
          schedules,
          state.classBusy,
          state.teacherBusy,
          options.hardAvoidLunch,
          preferences.lunchAfterPeriod,
          fixedCells,
          state.cells,
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

      const ordered = orderSlotsForLesson(
        lesson,
        bestSlots,
        fixedCells,
        state.cells,
        preferences,
      );

      for (const slot of ordered) {
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
      if (!keepSearchingAfterComplete()) {
        return {
          commonCells: state.cells,
          unplaced: [],
          attemptsUsed,
          nodes,
        };
      }
      const penalty = scoreComplete(state.cells);
      if (penalty < bestCompletePenalty) {
        bestCompletePenalty = penalty;
        bestComplete = [...state.cells];
      }
      if (penalty === 0) {
        return {
          commonCells: state.cells,
          unplaced: [],
          attemptsUsed,
          nodes,
        };
      }
    }
  }

  if (bestComplete) {
    return {
      commonCells: bestComplete,
      unplaced: [],
      attemptsUsed,
      nodes,
    };
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

function markTeacherBusyFromForbidden(
  forbiddenSlots: TeacherForbiddenSlot[],
  teacherBusy: Set<string>,
) {
  for (const slot of forbiddenSlots) {
    teacherBusy.add(
      teacherSlotKey(slot.teacherName, slot.day, slot.period),
    );
  }
}

export type GenerateTimetableInput = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  /** Per-slot teacher resolution for multi-teacher rotating SET subjects. */
  teacherAssignments?: SetTeacherAssignment[];
  /** Pre-locked common lessons (교과 블록). */
  subjectBlocks?: SubjectBlockCell[];
  /** Slots where the teacher must not teach (weekday + period). */
  forbiddenSlots?: TeacherForbiddenSlot[];
  /** Soft generation preferences (lunch doubles, etc.). */
  preferences?: GenerationPreferences;
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
  /**
   * Lunch-double diagnostics for `cells`, always computed regardless of the
   * 점심시간 연강 배제 preference so users can check the data even when
   * generating with it off.
   */
  lunchDoubleCount: number;
  lunchDoubles: SoftRunDetail[];
  /**
   * Same-teacher 3+ consecutive-period diagnostics for `cells`, always
   * computed regardless of the 3연강 완화 preference so users can check the
   * data even when generating with it off.
   */
  tripleRunCount: number;
  tripleRuns: SoftRunDetail[];
  /**
   * Same-day-subject diagnostics for `cells`, always computed against
   * `preferences.sameDaySubjectBans` regardless of the 동일 교과 같은 날
   * 배치 금지 master switch, so users can check the data even when off.
   */
  sameDaySubjectViolationCount: number;
  sameDaySubjectViolations: SameDaySubjectViolation[];
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
    teacherAssignments = [],
    subjectBlocks = [],
    forbiddenSlots = [],
    preferences: preferencesInput,
    timeLimitMs = 10_000,
    restarts = 20,
  } = input;

  const preferences =
    preferencesInput ?? createDefaultGenerationPreferences();

  const catalog = catalogGradeSets(subjects, classCounts);
  const setCells = buildSetCells({
    wholeCells,
    partialCells,
    subjects,
    classCounts,
    teachers,
    catalog,
    teacherAssignments,
  });

  const lockedBlocks = filterSubjectBlocksToAssignments(
    subjectBlocks,
    teachers,
    subjects,
    classCounts,
    schedules,
  );
  const blockCells = subjectBlocksToTimetableCells(lockedBlocks);
  const fixedCells = [...setCells, ...blockCells];

  const classBusySeed = new Set<string>();
  const teacherBusySeed = new Set<string>();
  markBusyFromSetCells(setCells, classBusySeed, teacherBusySeed);
  markTeacherBusyFromBlocks(
    wholeCells,
    partialCells,
    teachers,
    catalog,
    teacherBusySeed,
    teacherAssignments,
  );
  markBusyFromSubjectBlocks(lockedBlocks, classBusySeed, teacherBusySeed);
  markTeacherBusyFromForbidden(forbiddenSlots, teacherBusySeed);

  const allLessons = expandCommonLessons(teachers, subjects, classCounts);
  const { remaining: lessons } = consumeLessonsForSubjectBlocks(
    allLessons,
    lockedBlocks,
  );

  const capacityError = teacherCapacityIssues(
    lessons,
    schedules,
    teacherBusySeed,
  );

  const searchBudget = Math.max(2000, Math.floor(timeLimitMs * 0.75));
  const repairBudget = Math.max(1000, timeLimitMs - searchBudget);

  // When avoiding lunch doubles, try a first pass that removes lunch-straddling
  // slots from each lesson's domain entirely (hard constraint), so any complete
  // solution found is guaranteed to have zero teacher lunch doubles. Only if
  // that proves infeasible within its budget do we fall back to the soft
  // (deprioritize-only) search below, which can still tolerate fixed-block-
  // induced or otherwise unavoidable doubles.
  let solved: ReturnType<typeof solveBacktracking>;
  if (preferences.avoidLunchDouble) {
    const hardRestarts = Math.max(1, Math.round(restarts * 0.7));
    const hardTimeLimitMs = Math.max(1500, Math.round(searchBudget * 0.7));

    const hardAttempt = solveBacktracking(
      lessons,
      schedules,
      classBusySeed,
      teacherBusySeed,
      fixedCells,
      preferences,
      {
        timeLimitMs: hardTimeLimitMs,
        nodeLimit: 400_000,
        restarts: hardRestarts,
        hardAvoidLunch: true,
      },
    );

    if (hardAttempt.unplaced.length === 0) {
      solved = hardAttempt;
    } else {
      const remainingRestarts = Math.max(
        1,
        restarts - hardAttempt.attemptsUsed,
      );
      const remainingTimeMs = Math.max(
        1500,
        searchBudget - hardTimeLimitMs,
      );
      solved = solveBacktracking(
        lessons,
        schedules,
        classBusySeed,
        teacherBusySeed,
        fixedCells,
        preferences,
        {
          timeLimitMs: remainingTimeMs,
          nodeLimit: 400_000,
          restarts: remainingRestarts,
          hardAvoidLunch: false,
        },
      );
    }
  } else {
    solved = solveBacktracking(
      lessons,
      schedules,
      classBusySeed,
      teacherBusySeed,
      fixedCells,
      preferences,
      {
        timeLimitMs: searchBudget,
        nodeLimit: 400_000,
        restarts,
        hardAvoidLunch: false,
      },
    );
  }

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
    let finalCommon = commonCells;
    if (preferences.avoidLunchDouble) {
      // Repair budget is unused on complete solves — spend it on lunch cleanup.
      // The before/after counts are reflected in the dedicated lunch-double
      // diagnostic panel, so no separate message note is needed here.
      const improved = improveLunchTeacherDoubles({
        fixedCells,
        commonCells: finalCommon,
        schedules,
        lunchAfterPeriod: preferences.lunchAfterPeriod,
        timeLimitMs: Math.max(1500, repairBudget),
      });
      finalCommon = improved.commonCells;
    }

    const allCells = [...setCells, ...blockCells, ...finalCommon];
    // Always computed (regardless of the preference) so the diagnostic
    // panels can be checked even when generating with avoidance turned off.
    const lunchDoubles = listLunchTeacherDoubles(
      allCells,
      preferences.lunchAfterPeriod,
    );
    const tripleRuns = listTeacherTripleRuns(
      allCells,
      preferences.lunchAfterPeriod,
    );
    const sameDaySubjectViolations = listSameDaySubjectViolations(
      allCells,
      preferences.sameDaySubjectBans,
    );
    return {
      cells: allCells,
      unplaced: [],
      attemptsUsed: solved.attemptsUsed,
      status: "ready",
      message: `공통 수업 배치를 완료했습니다. (재시작 ${solved.attemptsUsed}회)`,
      lunchDoubleCount: lunchDoubles.length,
      lunchDoubles,
      tripleRunCount: tripleRuns.length,
      tripleRuns,
      sameDaySubjectViolationCount: sameDaySubjectViolations.length,
      sameDaySubjectViolations,
    };
  }

  const classifiedUnplaced = classifyUnplacedLessons(
    unplaced,
    schedules,
    classBusySeed,
    teacherBusySeed,
    commonCells,
  );
  const impossibleCount = classifiedUnplaced
    .filter((u) => u.reason === "impossible")
    .reduce((s, u) => s + u.remaining, 0);
  const contentionCount = unplacedCount - impossibleCount;

  const hint = capacityError ? ` ${capacityError}` : "";
  const reasonHint =
    impossibleCount >= unplacedCount
      ? " 미배치 교시는 현재 배치 상태에서 배정 가능한 자리가 근본적으로 없습니다. 재시도해도 결과가 같을 수 있으니 교사 배정이나 시간표 구조 조정이 필요합니다."
      : impossibleCount > 0
        ? ` 미배치 ${unplacedCount}교시 중 최소 ${impossibleCount}교시는 배정 가능한 자리가 근본적으로 없어 재시도로는 해결되지 않습니다. 나머지 ${contentionCount}교시는 다른 수업과의 자리 경합이라 다시 시도하면 배치될 수 있습니다.`
        : " 모두 다른 수업과의 자리 경합으로 보입니다. 다시 시도하면 배치될 수 있습니다.";

  const failedCells = [...setCells, ...blockCells, ...commonCells];
  const failedLunchDoubles = listLunchTeacherDoubles(
    failedCells,
    preferences.lunchAfterPeriod,
  );
  const failedTripleRuns = listTeacherTripleRuns(
    failedCells,
    preferences.lunchAfterPeriod,
  );
  const failedSameDaySubjectViolations = listSameDaySubjectViolations(
    failedCells,
    preferences.sameDaySubjectBans,
  );

  return {
    cells: failedCells,
    unplaced: classifiedUnplaced,
    attemptsUsed: solved.attemptsUsed,
    status: "failed",
    message: `일부 공통 수업을 배치하지 못했습니다. (미배치 ${unplacedCount}교시)${reasonHint}${hint}`,
    lunchDoubleCount: failedLunchDoubles.length,
    lunchDoubles: failedLunchDoubles,
    tripleRunCount: failedTripleRuns.length,
    tripleRuns: failedTripleRuns,
    sameDaySubjectViolationCount: failedSameDaySubjectViolations.length,
    sameDaySubjectViolations: failedSameDaySubjectViolations,
  };
}

type LunchSlotTarget = {
  grade: Grade;
  classNo: number;
  day: Weekday;
  period: number;
};

/** Every (grade, class, day) lunch-adjacent pair not already fixed by SET/교과 블록. */
function buildLunchSlotTargets(
  classCounts: GradeClassCounts,
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  lunchAfterPeriod: number,
): LunchSlotTarget[] {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const targets: LunchSlotTarget[] = [];
  for (const grade of GRADES) {
    const n = classCounts[grade];
    for (let classNo = 1; classNo <= n; classNo++) {
      for (const { key: day } of WEEKDAYS) {
        const count = schedules[grade][day] ?? 0;
        // Both sides of lunch must exist that day, otherwise there is no
        // straddle risk and this pair is left for the normal search.
        if (count < after) continue;
        for (const period of [before, after]) {
          if (
            classBusySeed.has(classSlotKey(grade, classNo, day, period))
          ) {
            continue;
          }
          targets.push({ grade, classNo, day, period });
        }
      }
    }
  }
  return targets;
}

type LunchLessonGroup = {
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
  count: number;
};

/** Group interchangeable lesson-hours (same teacher/grade/class/subject). */
function buildLunchLessonGroups(
  lessons: CommonLesson[],
): Map<string, LunchLessonGroup> {
  const map = new Map<string, LunchLessonGroup>();
  for (const lesson of lessons) {
    const key = unplacedKey(lesson);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else {
      map.set(key, {
        teacherName: lesson.teacherName,
        grade: lesson.grade,
        classNo: lesson.classNo,
        subjectName: lesson.subjectName,
        count: 1,
      });
    }
  }
  return map;
}

/**
 * Slot-centric MRV backtracking: unlike `solveBacktracking` (lesson -> slot),
 * here the targets (lunch-adjacent periods) are fixed and known up front, and
 * we pick which lesson fills each one. Any complete fill is guaranteed to
 * have zero teacher lunch doubles, since a candidate is rejected outright if
 * its teacher already has a lesson on the opposite side of lunch that day.
 */
function solveLunchSlots(
  targets: LunchSlotTarget[],
  groupsSeed: Map<string, LunchLessonGroup>,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  lunchAfterPeriod: number,
  timeLimitMs: number,
  restarts: number,
): { cells: TimetableCell[]; attemptsUsed: number } {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const globalDeadline = Date.now() + Math.max(0, timeLimitMs);
  const sliceMs = Math.max(
    300,
    Math.floor(timeLimitMs / Math.max(1, restarts)),
  );
  const nodeLimit = 200_000;

  // Which group keys are even eligible for a given class — stable across
  // restarts, so this index is built once instead of rescanning every group
  // (231+ entries) on every single candidate check.
  const classGroupKeys = new Map<string, string[]>();
  for (const [key, g] of groupsSeed) {
    const classKey = `${g.grade}|${g.classNo}`;
    const list = classGroupKeys.get(classKey);
    if (list) list.push(key);
    else classGroupKeys.set(classKey, [key]);
  }

  let bestCells: TimetableCell[] = [];
  let attemptsUsed = 0;

  for (let restart = 0; restart < restarts; restart++) {
    if (Date.now() > globalDeadline) break;
    attemptsUsed = restart + 1;
    const restartDeadline = Math.min(globalDeadline, Date.now() + sliceMs);

    const classBusy = new Set(classBusySeed);
    const teacherBusy = new Set(teacherBusySeed);
    const groups = new Map<string, LunchLessonGroup>();
    for (const [key, g] of groupsSeed) groups.set(key, { ...g });
    const placed: TimetableCell[] = [];
    const remaining = new Set(targets.map((_, i) => i));
    let nodes = 0;
    let bestPartial: TimetableCell[] = [];

    const considerBest = () => {
      if (placed.length > bestPartial.length) {
        bestPartial = [...placed];
      }
    };

    const candidateKeysFor = (target: LunchSlotTarget): string[] => {
      const partner = target.period === before ? after : before;
      const keys = classGroupKeys.get(`${target.grade}|${target.classNo}`);
      if (!keys) return [];
      const out: string[] = [];
      for (const key of keys) {
        const g = groups.get(key)!;
        if (g.count <= 0) continue;
        // `teacherBusy` already tracks every seed + placed-so-far commitment
        // for this restart, so both checks below are O(1) set lookups
        // equivalent to (but far cheaper than) scanning fixedCells + placed.
        if (
          teacherBusy.has(
            teacherSlotKey(g.teacherName, target.day, target.period),
          )
        ) {
          continue;
        }
        if (teacherBusy.has(teacherSlotKey(g.teacherName, target.day, partner))) {
          continue;
        }
        out.push(key);
      }
      return out;
    };

    const search = (): boolean => {
      nodes += 1;
      if (nodes > nodeLimit || Date.now() > restartDeadline) {
        considerBest();
        return false;
      }
      if (remaining.size === 0) return true;

      let bestIdx = -1;
      let bestCandidates: string[] = [];
      let bestCount = Infinity;
      for (const idx of remaining) {
        const cands = candidateKeysFor(targets[idx]);
        if (cands.length < bestCount) {
          bestCount = cands.length;
          bestIdx = idx;
          bestCandidates = cands;
          if (bestCount === 0) break;
        }
      }

      if (bestIdx < 0 || bestCount === 0) {
        considerBest();
        return false;
      }

      const target = targets[bestIdx];
      remaining.delete(bestIdx);

      for (const key of shuffle(bestCandidates)) {
        const group = groups.get(key)!;
        group.count -= 1;
        classBusy.add(
          classSlotKey(target.grade, target.classNo, target.day, target.period),
        );
        teacherBusy.add(
          teacherSlotKey(group.teacherName, target.day, target.period),
        );
        const cell: TimetableCell = {
          grade: target.grade,
          classNo: target.classNo,
          day: target.day,
          period: target.period,
          subjectName: group.subjectName,
          teacherName: group.teacherName,
          kind: "common",
        };
        placed.push(cell);

        if (search()) return true;

        placed.pop();
        classBusy.delete(
          classSlotKey(target.grade, target.classNo, target.day, target.period),
        );
        teacherBusy.delete(
          teacherSlotKey(group.teacherName, target.day, target.period),
        );
        group.count += 1;

        if (nodes > nodeLimit || Date.now() > restartDeadline) {
          remaining.add(bestIdx);
          considerBest();
          return false;
        }
      }

      remaining.add(bestIdx);
      considerBest();
      return false;
    };

    const restartCells = search() ? placed : bestPartial;
    // Each restart's backtracking commits to a different set of "hard"
    // targets, which in turn leaves a different residual for the greedy
    // top-up — so top up per restart and compare combined totals, rather
    // than only keeping the raw backtracked best and topping up once.
    const toppedUp = greedyFillRemainingLunchSlots(
      targets,
      restartCells,
      groupsSeed,
      classBusySeed,
      teacherBusySeed,
      lunchAfterPeriod,
    );
    if (toppedUp.length > bestCells.length) {
      bestCells = toppedUp;
    }
    if (bestCells.length === targets.length) break;
  }

  return { cells: bestCells, attemptsUsed };
}

/**
 * Greedy, no-backtrack sweep over whatever `solveLunchSlots` left unfilled.
 * MRV backtracking spends its whole budget wrestling with the few genuinely
 * tight targets (e.g. classes whose electives leave only 1-2 usable
 * teachers) and, under a tight time budget, may never even attempt the
 * (usually much larger) set of targets with plenty of valid candidates. This
 * pass mops those up with simple greedy (most-constrained-first, no undo)
 * placement — safe since by construction only abundant-candidate targets
 * are likely to remain.
 */
function greedyFillRemainingLunchSlots(
  targets: LunchSlotTarget[],
  placedSoFar: TimetableCell[],
  groupsSeed: Map<string, LunchLessonGroup>,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  lunchAfterPeriod: number,
): TimetableCell[] {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const classBusy = new Set(classBusySeed);
  const teacherBusy = new Set(teacherBusySeed);
  const groups = new Map<string, LunchLessonGroup>();
  for (const [key, g] of groupsSeed) groups.set(key, { ...g });
  const classGroupKeys = new Map<string, string[]>();
  for (const [key, g] of groupsSeed) {
    const classKey = `${g.grade}|${g.classNo}`;
    const list = classGroupKeys.get(classKey);
    if (list) list.push(key);
    else classGroupKeys.set(classKey, [key]);
  }

  const placed = [...placedSoFar];
  for (const cell of placed) {
    classBusy.add(
      classSlotKey(cell.grade, cell.classNo, cell.day, cell.period),
    );
    teacherBusy.add(
      teacherSlotKey(cell.teacherName, cell.day, cell.period),
    );
    const key = unplacedKey({
      teacherName: cell.teacherName,
      grade: cell.grade,
      classNo: cell.classNo,
      subjectName: cell.subjectName,
    });
    const g = groups.get(key);
    if (g && g.count > 0) g.count -= 1;
  }

  const filled = new Set(
    placed.map((c) => classSlotKey(c.grade, c.classNo, c.day, c.period)),
  );
  const remaining = targets.filter(
    (t) => !filled.has(classSlotKey(t.grade, t.classNo, t.day, t.period)),
  );

  let progressed = true;
  while (progressed) {
    progressed = false;
    let bestIdx = -1;
    let bestCandidates: string[] = [];
    let bestCount = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const target = remaining[i];
      const partner = target.period === before ? after : before;
      const keys = classGroupKeys.get(`${target.grade}|${target.classNo}`);
      const candidates: string[] = [];
      for (const key of keys ?? []) {
        const g = groups.get(key)!;
        if (g.count <= 0) continue;
        if (
          teacherBusy.has(
            teacherSlotKey(g.teacherName, target.day, target.period),
          )
        ) {
          continue;
        }
        if (teacherBusy.has(teacherSlotKey(g.teacherName, target.day, partner))) {
          continue;
        }
        candidates.push(key);
      }
      if (candidates.length > 0 && candidates.length < bestCount) {
        bestCount = candidates.length;
        bestIdx = i;
        bestCandidates = candidates;
      }
    }

    if (bestIdx < 0) break;

    const target = remaining[bestIdx];
    const key = shuffle(bestCandidates)[0];
    const group = groups.get(key)!;
    group.count -= 1;
    classBusy.add(
      classSlotKey(target.grade, target.classNo, target.day, target.period),
    );
    teacherBusy.add(
      teacherSlotKey(group.teacherName, target.day, target.period),
    );
    placed.push({
      grade: target.grade,
      classNo: target.classNo,
      day: target.day,
      period: target.period,
      subjectName: group.subjectName,
      teacherName: group.teacherName,
      kind: "common",
    });
    remaining.splice(bestIdx, 1);
    progressed = true;
  }

  return placed;
}

export type LunchPriorityInput = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  /** Per-slot teacher resolution for multi-teacher rotating SET subjects. */
  teacherAssignments?: SetTeacherAssignment[];
  /** Already-manually-locked 교과 블록 (kept as-is, never re-filled here). */
  subjectBlocks?: SubjectBlockCell[];
  forbiddenSlots?: TeacherForbiddenSlot[];
  lunchAfterPeriod?: number;
  timeLimitMs?: number;
  restarts?: number;
};

export type LunchPriorityResult = {
  /**
   * Chosen lessons for lunch-adjacent periods, in 교과 블록 cell format so
   * they can be merged into `generateTimetable`'s `subjectBlocks` as fixed
   * cells for the following "남은 시간 시간표 배치" step.
   */
  lunchCells: SubjectBlockCell[];
  /** Full preview (SET + 교과 블록 + lunch cells) for immediate display. */
  cells: TimetableCell[];
  targetCount: number;
  filledCount: number;
  status: "ready" | "failed";
  message: string;
};

/**
 * Stage 1 of the two-step generation flow: place only the lunch-adjacent
 * periods first (repeatable — each call restarts from scratch), guaranteeing
 * zero teacher lunch doubles among what it places. The rest of the schedule
 * is filled afterwards by `generateTimetable`, fed these cells as fixed
 * (교과 블록-style) cells.
 */
export function solveLunchPriority(
  input: LunchPriorityInput,
): LunchPriorityResult {
  const {
    teachers,
    subjects,
    classCounts,
    schedules,
    wholeCells,
    partialCells,
    teacherAssignments = [],
    subjectBlocks = [],
    forbiddenSlots = [],
    lunchAfterPeriod = DEFAULT_LUNCH_AFTER_PERIOD,
    timeLimitMs = 8_000,
    restarts = 15,
  } = input;

  const { setCells, classBusySeed, teacherBusySeed, lockedBlocks } =
    prepareBusySeeds({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments,
      subjectBlocks,
      forbiddenSlots,
    });
  const blockCells = subjectBlocksToTimetableCells(lockedBlocks);
  const fixedCells = [...setCells, ...blockCells];

  const targets = buildLunchSlotTargets(
    classCounts,
    schedules,
    classBusySeed,
    lunchAfterPeriod,
  );

  if (targets.length === 0) {
    return {
      lunchCells: [],
      cells: fixedCells,
      targetCount: 0,
      filledCount: 0,
      status: "ready",
      message:
        "점심 전후 교시가 모두 SET·교과 블록으로 이미 채워져 있어 추가로 배치할 것이 없습니다.",
    };
  }

  const allLessons = expandCommonLessons(teachers, subjects, classCounts);
  const { remaining: lessons } = consumeLessonsForSubjectBlocks(
    allLessons,
    lockedBlocks,
  );
  const groups = buildLunchLessonGroups(lessons);

  // `solveLunchSlots` already tops up each restart's backtracked result with
  // a greedy sweep internally and returns the best combined total.
  const { cells: placedCells, attemptsUsed } = solveLunchSlots(
    targets,
    groups,
    classBusySeed,
    teacherBusySeed,
    lunchAfterPeriod,
    timeLimitMs,
    restarts,
  );

  const lunchCells: SubjectBlockCell[] = placedCells.map((c) => ({
    grade: c.grade,
    classNo: c.classNo,
    subjectName: c.subjectName,
    teacherName: c.teacherName,
    day: c.day,
    period: c.period,
  }));

  const targetCount = targets.length;
  const filledCount = placedCells.length;
  const allCells = [...fixedCells, ...placedCells];

  const structuralGap = countStructurallyImpossibleLunchTargets(
    targets,
    placedCells,
    groups,
    teacherBusySeed,
    lunchAfterPeriod,
  );

  if (filledCount === targetCount) {
    // This stage guarantees it never *adds* a double, but cells it inherited
    // as already-fixed (e.g. from 동일 교과 우선 배치, which has its own lunch
    // avoidance but can still be forced into one) may already contain one —
    // check the actual result rather than assuming, so the message never
    // promises more than it delivers.
    const remainingDoubles = listLunchTeacherDoubles(allCells, lunchAfterPeriod);
    const guaranteeNote =
      remainingDoubles.length === 0
        ? ` 이 결과를 기준으로 "남은 시간 시간표 배치"를 실행하면 점심 연강 0건이 보장됩니다.`
        : ` 다만 이미 고정된 배치에 점심 연강 ${remainingDoubles.length}건이 남아 있어 이번 단계로는 완전히 없앨 수 없습니다.`;
    return {
      lunchCells,
      cells: allCells,
      targetCount,
      filledCount,
      status: "ready",
      message: `점심 전후 교시 ${targetCount}칸을 모두 배치했습니다. (재시도 ${attemptsUsed}회)${guaranteeNote}`,
    };
  }

  const unfilled = targetCount - filledCount;
  const hint =
    structuralGap >= unfilled
      ? " 미배치 칸은 재시도 횟수·시간과 무관하게 해당 시간대에 배정 가능한 교사가 근본적으로 없는 경우로 보입니다. 교사 배정이나 시간표 구조 조정이 필요합니다."
      : structuralGap > 0
        ? ` 미배치 ${unfilled}칸 중 최소 ${structuralGap}칸은 해당 시간대에 배정 가능한 교사가 근본적으로 없어 재시도로는 해결되지 않습니다. 나머지는 다시 시도하면 배치될 수 있습니다.`
        : " 각 칸은 개별적으로는 배정 가능한 교사가 있지만, 여러 반이 점심 전후로 비는 같은 교사를 동시에 필요로 해 전체적으로 자리가 부족합니다(자리 경합). 이 경우 재시도·대기 시간을 늘려도 결과가 거의 같을 수 있습니다 — 점심 전후 시간대에 배치 가능한 교사 수를 늘리거나 시간표 구조를 조정해야 개선됩니다.";

  return {
    lunchCells,
    cells: allCells,
    targetCount,
    filledCount,
    status: "failed",
    message: `점심 전후 교시 중 ${filledCount}/${targetCount}칸만 배치했습니다. (재시도 ${attemptsUsed}회)${hint}`,
  };
}

/**
 * Among still-unfilled lunch targets, count how many have zero candidate
 * teachers even measured against just the seed busy state (SET/blocks only,
 * ignoring contention from other lunch placements). Those are impossible to
 * fill no matter how much search time or how many restarts are spent — the
 * class simply has no teacher free on both sides of lunch that day.
 */
function countStructurallyImpossibleLunchTargets(
  targets: LunchSlotTarget[],
  placedCells: TimetableCell[],
  groups: Map<string, LunchLessonGroup>,
  teacherBusySeed: Set<string>,
  lunchAfterPeriod: number,
): number {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const filled = new Set(
    placedCells.map((c) => classSlotKey(c.grade, c.classNo, c.day, c.period)),
  );
  const unfilled = targets.filter(
    (t) => !filled.has(classSlotKey(t.grade, t.classNo, t.day, t.period)),
  );
  let count = 0;
  for (const target of unfilled) {
    const partner = target.period === before ? after : before;
    let hasCandidate = false;
    for (const g of groups.values()) {
      if (g.grade !== target.grade || g.classNo !== target.classNo) continue;
      if (g.count <= 0) continue;
      if (
        teacherBusySeed.has(
          teacherSlotKey(g.teacherName, target.day, target.period),
        )
      ) {
        continue;
      }
      if (
        teacherBusySeed.has(teacherSlotKey(g.teacherName, target.day, partner))
      ) {
        continue;
      }
      hasCandidate = true;
      break;
    }
    if (!hasCandidate) count += 1;
  }
  return count;
}

/**
 * Every instance of a banned (grade, subject) landing on the same day twice
 * (or more) for the same class, across the given cells. Grouped by
 * (grade, class, day, subject) so multiple occurrences report as one entry
 * with all of that day's periods listed.
 */
export function listSameDaySubjectViolations(
  cells: TimetableCell[],
  bans: SameDaySubjectBan[],
): SameDaySubjectViolation[] {
  if (bans.length === 0) return [];
  const banKeys = new Set(
    bans.map((b) => sameDaySubjectBanKey(b.grade, b.subjectName)),
  );

  const groups = new Map<
    string,
    {
      grade: Grade;
      classNo: number;
      day: Weekday;
      subjectName: string;
      teacherName: string;
      periods: number[];
    }
  >();
  for (const cell of cells) {
    if (!banKeys.has(sameDaySubjectBanKey(cell.grade, cell.subjectName))) {
      continue;
    }
    const key = `${cell.grade}|${cell.classNo}|${cell.day}|${cell.subjectName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.periods.push(cell.period);
    } else {
      groups.set(key, {
        grade: cell.grade,
        classNo: cell.classNo,
        day: cell.day,
        subjectName: cell.subjectName,
        teacherName: cell.teacherName,
        periods: [cell.period],
      });
    }
  }

  const out: SameDaySubjectViolation[] = [];
  for (const g of groups.values()) {
    if (g.periods.length < 2) continue;
    out.push({ ...g, periods: [...g.periods].sort((a, b) => a - b) });
  }
  out.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    if (a.grade !== b.grade) return a.grade - b.grade;
    if (a.classNo !== b.classNo) return a.classNo - b.classNo;
    return a.subjectName.localeCompare(b.subjectName, "ko");
  });
  return out;
}

/**
 * Candidate slots for a banned-subject lesson: prefer days this
 * (grade, class, subject) hasn't used yet (in fixed cells or placed so far
 * this search branch). Only fall back to reusing a day when doing so is the
 * lesson's *only* option — i.e. the same-day rule is a hard constraint until
 * it would make placement impossible, at which point it degrades to "best
 * effort" for that one lesson.
 *
 * Also avoids creating a same-teacher lunch double (this teacher already
 * has a lesson — any class — on the other side of lunch that day), same
 * priority as the day-spread rule: preferred but not at the cost of leaving
 * the lesson unplaced. Without this, a later "점심시간 우선 배치" pass can only
 * work around whatever this stage already fixed, so a double created here
 * survives even when that pass reports "점심 연강 0건이 보장됩니다".
 */
function candidateSlotsForBannedLesson(
  lesson: CommonLesson,
  schedules: GradeDaySchedules,
  classBusy: Set<string>,
  teacherBusy: Set<string>,
  fixedCells: TimetableCell[],
  placed: TimetableCell[],
  avoidLunchDouble: boolean,
  lunchAfterPeriod: number,
): Slot[] {
  const raw = availableSlotsForLesson(lesson, schedules, classBusy, teacherBusy);

  let pool = raw;
  if (avoidLunchDouble) {
    const [before, after] = lunchPairPeriods(lunchAfterPeriod);
    const noLunchDouble = pool.filter((slot) => {
      if (slot.period !== before && slot.period !== after) return true;
      const partner = slot.period === before ? after : before;
      return !teacherHasLessonAt(
        lesson.teacherName,
        slot.day,
        partner,
        fixedCells,
        placed,
      );
    });
    if (noLunchDouble.length > 0) pool = noLunchDouble;
  }

  const usedDays = new Set<Weekday>();
  for (const c of fixedCells) {
    if (c.grade === lesson.grade && c.classNo === lesson.classNo && c.subjectName === lesson.subjectName) {
      usedDays.add(c.day);
    }
  }
  for (const c of placed) {
    if (c.grade === lesson.grade && c.classNo === lesson.classNo && c.subjectName === lesson.subjectName) {
      usedDays.add(c.day);
    }
  }
  const fresh = pool.filter((slot) => !usedDays.has(slot.day));
  return fresh.length > 0 ? fresh : pool;
}

/**
 * MRV backtracking over just the banned-subject lessons, restart-based like
 * `solveLunchSlots`. Each restart keeps its best partial result if it runs
 * out of time/nodes before placing everything.
 */
function solveSameDaySubjectSlots(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  fixedCells: TimetableCell[],
  timeLimitMs: number,
  restarts: number,
  avoidLunchDouble: boolean,
  lunchAfterPeriod: number,
): { cells: TimetableCell[]; attemptsUsed: number } {
  const globalDeadline = Date.now() + Math.max(0, timeLimitMs);
  const sliceMs = Math.max(
    300,
    Math.floor(timeLimitMs / Math.max(1, restarts)),
  );
  const nodeLimit = 200_000;

  let bestCells: TimetableCell[] = [];
  let attemptsUsed = 0;

  for (let restart = 0; restart < restarts; restart++) {
    if (Date.now() > globalDeadline) break;
    attemptsUsed = restart + 1;
    const restartDeadline = Math.min(globalDeadline, Date.now() + sliceMs);

    const classBusy = new Set(classBusySeed);
    const teacherBusy = new Set(teacherBusySeed);
    const placed: TimetableCell[] = [];
    const remaining = new Set(lessons.map((_, i) => i));
    let nodes = 0;
    let bestPartial: TimetableCell[] = [];

    const considerBest = () => {
      if (placed.length > bestPartial.length) bestPartial = [...placed];
    };

    const search = (): boolean => {
      nodes += 1;
      if (nodes > nodeLimit || Date.now() > restartDeadline) {
        considerBest();
        return false;
      }
      if (remaining.size === 0) return true;

      let bestIdx = -1;
      let bestSlots: Slot[] = [];
      let bestCount = Infinity;
      for (const idx of remaining) {
        const lesson = lessons[idx];
        const slots = candidateSlotsForBannedLesson(
          lesson,
          schedules,
          classBusy,
          teacherBusy,
          fixedCells,
          placed,
          avoidLunchDouble,
          lunchAfterPeriod,
        );
        if (slots.length < bestCount) {
          bestCount = slots.length;
          bestIdx = idx;
          bestSlots = slots;
          if (bestCount === 0) break;
        }
      }

      if (bestIdx < 0 || bestCount === 0) {
        considerBest();
        return false;
      }

      const lesson = lessons[bestIdx];
      remaining.delete(bestIdx);

      for (const slot of shuffle(bestSlots)) {
        classBusy.add(
          classSlotKey(lesson.grade, lesson.classNo, slot.day, slot.period),
        );
        teacherBusy.add(
          teacherSlotKey(lesson.teacherName, slot.day, slot.period),
        );
        const cell: TimetableCell = {
          grade: lesson.grade,
          classNo: lesson.classNo,
          day: slot.day,
          period: slot.period,
          subjectName: lesson.subjectName,
          teacherName: lesson.teacherName,
          kind: "common",
        };
        placed.push(cell);

        if (search()) return true;

        placed.pop();
        classBusy.delete(
          classSlotKey(lesson.grade, lesson.classNo, slot.day, slot.period),
        );
        teacherBusy.delete(
          teacherSlotKey(lesson.teacherName, slot.day, slot.period),
        );

        if (nodes > nodeLimit || Date.now() > restartDeadline) {
          remaining.add(bestIdx);
          considerBest();
          return false;
        }
      }

      remaining.add(bestIdx);
      considerBest();
      return false;
    };

    const restartCells = search() ? placed : bestPartial;
    if (restartCells.length > bestCells.length) {
      bestCells = restartCells;
    }
    if (bestCells.length === lessons.length) break;
  }

  return { cells: bestCells, attemptsUsed };
}

export type SameDaySubjectPriorityInput = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  /** Per-slot teacher resolution for multi-teacher rotating SET subjects. */
  teacherAssignments?: SetTeacherAssignment[];
  /** Already-manually-locked 교과 블록 (kept as-is, never re-filled here). */
  subjectBlocks?: SubjectBlockCell[];
  forbiddenSlots?: TeacherForbiddenSlot[];
  /** Per-grade subjects selected for the same-day-duplicate ban. */
  sameDaySubjectBans: SameDaySubjectBan[];
  /** Avoid placing a lesson that would create a same-teacher lunch double. */
  avoidLunchDouble?: boolean;
  lunchAfterPeriod?: number;
  timeLimitMs?: number;
  restarts?: number;
};

export type SameDaySubjectPriorityResult = {
  /**
   * Chosen lessons for banned-subject occurrences, in 교과 블록 cell format
   * so they can be merged into `generateTimetable`'s `subjectBlocks` as
   * fixed cells for the following "남은 시간 시간표 배치" step.
   */
  lockCells: SubjectBlockCell[];
  /** Full preview (SET + 교과 블록 + these cells) for immediate display. */
  cells: TimetableCell[];
  targetCount: number;
  filledCount: number;
  /** Placed occurrences that still ended up sharing a day (forced overlap). */
  violationCount: number;
  status: "ready" | "failed";
  message: string;
};

/**
 * Priority pass for "동일 교과 같은 날 배치 금지": place every occurrence of
 * the selected (grade, subject) pairs first, spreading each class's weekly
 * hours of that subject across distinct days wherever possible (repeatable —
 * each call restarts from scratch). The rest of the schedule is filled
 * afterwards by `generateTimetable`, fed these cells as fixed (교과
 * 블록-style) cells — mirrors `solveLunchPriority`'s two-step flow.
 */
export function solveSameDaySubjectPriority(
  input: SameDaySubjectPriorityInput,
): SameDaySubjectPriorityResult {
  const {
    teachers,
    subjects,
    classCounts,
    schedules,
    wholeCells,
    partialCells,
    teacherAssignments = [],
    subjectBlocks = [],
    forbiddenSlots = [],
    sameDaySubjectBans,
    avoidLunchDouble = false,
    lunchAfterPeriod = DEFAULT_LUNCH_AFTER_PERIOD,
    timeLimitMs = 8_000,
    restarts = 15,
  } = input;

  const { setCells, classBusySeed, teacherBusySeed, lockedBlocks } =
    prepareBusySeeds({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments,
      subjectBlocks,
      forbiddenSlots,
    });
  const blockCells = subjectBlocksToTimetableCells(lockedBlocks);
  const fixedCells = [...setCells, ...blockCells];

  if (sameDaySubjectBans.length === 0) {
    return {
      lockCells: [],
      cells: fixedCells,
      targetCount: 0,
      filledCount: 0,
      violationCount: 0,
      status: "ready",
      message: "동일 교과 같은 날 배치 금지로 선택된 교과가 없습니다.",
    };
  }

  const banKeys = new Set(
    sameDaySubjectBans.map((b) => sameDaySubjectBanKey(b.grade, b.subjectName)),
  );

  const allLessons = expandCommonLessons(teachers, subjects, classCounts);
  const { remaining: afterBlocks } = consumeLessonsForSubjectBlocks(
    allLessons,
    lockedBlocks,
  );
  const targetLessons = afterBlocks.filter((l) =>
    banKeys.has(sameDaySubjectBanKey(l.grade, l.subjectName)),
  );

  if (targetLessons.length === 0) {
    return {
      lockCells: [],
      cells: fixedCells,
      targetCount: 0,
      filledCount: 0,
      violationCount: 0,
      status: "ready",
      message:
        "선택한 교과의 남은 시수가 없습니다 (이미 교과 블록으로 모두 고정되어 있음).",
    };
  }

  const { cells: placedCells, attemptsUsed } = solveSameDaySubjectSlots(
    targetLessons,
    schedules,
    classBusySeed,
    teacherBusySeed,
    fixedCells,
    timeLimitMs,
    restarts,
    avoidLunchDouble,
    lunchAfterPeriod,
  );

  const lockCells: SubjectBlockCell[] = placedCells.map((c) => ({
    grade: c.grade,
    classNo: c.classNo,
    subjectName: c.subjectName,
    teacherName: c.teacherName,
    day: c.day,
    period: c.period,
  }));

  const targetCount = targetLessons.length;
  const filledCount = placedCells.length;
  const allCells = [...fixedCells, ...placedCells];
  const violations = listSameDaySubjectViolations(allCells, sameDaySubjectBans);

  if (filledCount === targetCount) {
    const violationNote =
      violations.length > 0
        ? `\n같은 날 중복 배치 ${violations.length}건 (남은 요일 부족으로 부득이하게 겹침)`
        : "\n같은 날 중복 배치 0건";
    return {
      lockCells,
      cells: allCells,
      targetCount,
      filledCount,
      violationCount: violations.length,
      status: "ready",
      message: `선택한 교과 ${targetCount}칸을 모두 배치했습니다. (재시도 ${attemptsUsed}회)${violationNote}`,
    };
  }

  const unfilled = targetCount - filledCount;
  return {
    lockCells,
    cells: allCells,
    targetCount,
    filledCount,
    violationCount: violations.length,
    status: "failed",
    message: `선택한 교과 중 ${filledCount}/${targetCount}칸만 배치했습니다. (재시도 ${attemptsUsed}회) 나머지 ${unfilled}칸은 "남은 시간 시간표 배치" 단계에서 규칙 없이 배치됩니다.`,
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

/** Largest period count across every grade/day — used for teacher-wide views. */
export function maxPeriodsAllGrades(schedules: GradeDaySchedules): number {
  return Math.max(0, ...GRADES.map((grade) => maxPeriods(schedules, grade)));
}

/** Whether any grade has a class scheduled at this day/period at all. */
export function anyGradeHasPeriod(
  schedules: GradeDaySchedules,
  day: Weekday,
  period: number,
): boolean {
  return GRADES.some((grade) => (schedules[grade][day] ?? 0) >= period);
}

function prepareBusySeeds(input: {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  teacherAssignments?: SetTeacherAssignment[];
  subjectBlocks?: SubjectBlockCell[];
  forbiddenSlots?: TeacherForbiddenSlot[];
}): {
  catalog: GradeSetInfo[];
  setCells: TimetableCell[];
  classBusySeed: Set<string>;
  teacherBusySeed: Set<string>;
  lockedBlocks: SubjectBlockCell[];
} {
  const catalog = catalogGradeSets(input.subjects, input.classCounts);
  const setCells = buildSetCells({
    wholeCells: input.wholeCells,
    partialCells: input.partialCells,
    subjects: input.subjects,
    classCounts: input.classCounts,
    teachers: input.teachers,
    catalog,
    teacherAssignments: input.teacherAssignments ?? [],
  });
  const lockedBlocks = filterSubjectBlocksToAssignments(
    input.subjectBlocks ?? [],
    input.teachers,
    input.subjects,
    input.classCounts,
    input.schedules,
  );
  const classBusySeed = new Set<string>();
  const teacherBusySeed = new Set<string>();
  markBusyFromSetCells(setCells, classBusySeed, teacherBusySeed);
  markTeacherBusyFromBlocks(
    input.wholeCells,
    input.partialCells,
    input.teachers,
    catalog,
    teacherBusySeed,
    input.teacherAssignments ?? [],
  );
  markBusyFromSubjectBlocks(lockedBlocks, classBusySeed, teacherBusySeed);
  markTeacherBusyFromForbidden(input.forbiddenSlots ?? [], teacherBusySeed);
  return { catalog, setCells, classBusySeed, teacherBusySeed, lockedBlocks };
}

