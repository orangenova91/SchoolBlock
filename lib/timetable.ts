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
  sameDaySubjectWeight,
} from "@/lib/generation-preferences";
import {
  consumeLessonsForSubjectBlocks,
  filterSubjectBlocksToAssignments,
  subjectBlocksToTimetableCells,
} from "@/lib/subject-blocks";
import { isSetSubject } from "@/lib/teachers";
import {
  GRADES,
  WEEKDAYS,
  dayLabel,
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

/** Mon→Fri order; day keys sorted as strings would give 금·월·목·화·수. */
function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.findIndex((w) => w.key === day);
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

/** Index of `teacherSlotKey -> present` for O(1) "does this teacher already
 * have a lesson here" checks, instead of scanning a cell array per query. */
function buildTeacherLessonSet(cells: TimetableCell[]): Set<string> {
  const set = new Set<string>();
  for (const cell of cells) {
    for (const name of teacherNamesOnCell(cell)) {
      set.add(teacherSlotKey(name, cell.day, cell.period));
    }
  }
  return set;
}

function teacherHasLessonAt(
  teacherName: string,
  day: Weekday,
  period: number,
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
): boolean {
  const name = teacherName.trim();
  if (!name) return false;
  const key = teacherSlotKey(name, day, period);
  return fixedTeacherLessons.has(key) || placedTeacherLessons.has(key);
}

/** Same teacher assigned on both sides of lunch. */
function lunchDoublePenaltyForSlot(
  lesson: CommonLesson,
  slot: Slot,
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
  lunchAfterPeriod: number,
): number {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  if (slot.period !== before && slot.period !== after) return 0;
  const partner = slot.period === before ? after : before;
  return teacherHasLessonAt(
    lesson.teacherName,
    slot.day,
    partner,
    fixedTeacherLessons,
    placedTeacherLessons,
  )
    ? 1
    : 0;
}

/** Same teacher would end up with 3 consecutive taught periods (any class/subject). */
function triplePeriodPenaltyForSlot(
  lesson: CommonLesson,
  slot: Slot,
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
  lunchAfterPeriod: number,
): number {
  const teacherHasPeriod = (period: number) =>
    period === slot.period ||
    teacherHasLessonAt(
      lesson.teacherName,
      slot.day,
      period,
      fixedTeacherLessons,
      placedTeacherLessons,
    );

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

function classDaySubjectKey(
  grade: Grade,
  classNo: number,
  day: Weekday,
  subjectName: string,
): string {
  return `${grade}|${classNo}|${day}|${subjectName}`;
}

/** Fixed + placed lesson counts per (class, day, subject), for 동일 교과 checks. */
type ClassDaySubjectCounts = Map<string, number>;

function bumpClassDaySubject(
  counts: ClassDaySubjectCounts,
  cell: Pick<TimetableCell, "grade" | "classNo" | "day" | "subjectName">,
  delta: number,
) {
  const key = classDaySubjectKey(cell.grade, cell.classNo, cell.day, cell.subjectName);
  const next = (counts.get(key) ?? 0) + delta;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
}

function sameDayBanKeys(preferences: GenerationPreferences): Set<string> {
  if (sameDaySubjectWeight(preferences) === 0) return new Set();
  return new Set(
    preferences.sameDaySubjectBans.map((b) =>
      sameDaySubjectBanKey(b.grade, b.subjectName),
    ),
  );
}

function softSlotPenalty(
  lesson: CommonLesson,
  slot: Slot,
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
  classDaySubjects: ClassDaySubjectCounts,
  banKeys: Set<string>,
  preferences: GenerationPreferences,
): number {
  let penalty = 0;
  if (
    banKeys.has(sameDaySubjectBanKey(lesson.grade, lesson.subjectName)) &&
    classDaySubjects.has(
      classDaySubjectKey(lesson.grade, lesson.classNo, slot.day, lesson.subjectName),
    )
  ) {
    penalty += sameDaySubjectWeight(preferences);
  }
  if (preferences.avoidLunchDouble) {
    penalty +=
      lunchDoublePenaltyForSlot(
        lesson,
        slot,
        fixedTeacherLessons,
        placedTeacherLessons,
        preferences.lunchAfterPeriod,
      ) * lunchDoubleWeight(preferences);
  }
  if (preferences.avoidTriplePeriod) {
    penalty += triplePeriodPenaltyForSlot(
      lesson,
      slot,
      fixedTeacherLessons,
      placedTeacherLessons,
      preferences.lunchAfterPeriod,
    );
  }
  return penalty;
}

/** Prefer slots with lower soft penalty; shuffle ties. */
function orderSlotsForLesson(
  lesson: CommonLesson,
  slots: Slot[],
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
  classDaySubjects: ClassDaySubjectCounts,
  banKeys: Set<string>,
  preferences: GenerationPreferences,
): Slot[] {
  if (!hasSoftPreferences(preferences) || slots.length <= 1) {
    return shuffle(slots);
  }
  const scored = slots.map((slot) => ({
    slot,
    penalty: softSlotPenalty(
      lesson,
      slot,
      fixedTeacherLessons,
      placedTeacherLessons,
      classDaySubjects,
      banKeys,
      preferences,
    ),
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
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
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
      fixedTeacherLessons,
      placedTeacherLessons,
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
    if (a.day !== b.day) return weekdayIndex(a.day) - weekdayIndex(b.day);
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

/**
 * Local search over the soft preferences (점심 연강, 3연강, 동일 교과 같은 날
 * 중복) after a complete solve. Only common cells produced by the search move;
 * SET, 선 수업 and 우선 배치 잠금 cells stay fixed.
 *
 * Moves are within one class: swap two of its common lessons, or move one to
 * a free slot of that class. Swaps matter because a full timetable often has
 * no free slot at all, where single moves can't do anything. A move must keep
 * every teacher clear of fixed lessons, SET duty and 배정 불가 (all in
 * `teacherBusySeed`) and of other common lessons.
 *
 * Every penalty is local to a (teacher, day) or a (class, day), so a move is
 * scored by re-evaluating only the teacher-days and class-days it touches.
 */
function improveSoftPreferences(args: {
  fixedCells: TimetableCell[];
  commonCells: TimetableCell[];
  schedules: GradeDaySchedules;
  classBusySeed: Set<string>;
  teacherBusySeed: Set<string>;
  preferences: GenerationPreferences;
  timeLimitMs: number;
}): TimetableCell[] {
  const { fixedCells, schedules, classBusySeed, teacherBusySeed, preferences } =
    args;
  const deadline = Date.now() + Math.max(0, args.timeLimitMs);
  const lunchWeight = lunchDoubleWeight(preferences);
  const tripleWeight = preferences.avoidTriplePeriod ? 1 : 0;
  const sameDayWeight = sameDaySubjectWeight(preferences);
  const banKeys = sameDayBanKeys(preferences);
  const lunchAfter = preferences.lunchAfterPeriod;
  const [beforeLunch, afterLunch] = lunchPairPeriods(lunchAfter);

  const cells = args.commonCells.map((c) => ({ ...c }));

  // teacher|day -> period -> lesson count (fixed + common)
  const teacherDays = new Map<string, Map<number, number>>();
  // grade|classNo|day -> subject -> lesson count (fixed + common)
  const classDays = new Map<string, Map<string, number>>();
  // classSlotKey / teacherSlotKey -> index into `cells`
  const commonByClassSlot = new Map<string, number>();
  const commonByTeacherSlot = new Map<string, number>();

  const teacherDayKey = (name: string, day: Weekday) => `${name}|${day}`;
  const classDayKey = (c: Pick<TimetableCell, "grade" | "classNo">, day: Weekday) =>
    `${c.grade}|${c.classNo}|${day}`;

  const bump = <K>(map: Map<string, Map<K, number>>, key: string, inner: K, delta: number) => {
    let m = map.get(key);
    if (!m) {
      m = new Map();
      map.set(key, m);
    }
    const next = (m.get(inner) ?? 0) + delta;
    if (next > 0) m.set(inner, next);
    else m.delete(inner);
  };

  const index = (cell: TimetableCell, delta: number) => {
    for (const name of teacherNamesOnCell(cell)) {
      if (name === "—") continue;
      bump(teacherDays, teacherDayKey(name, cell.day), cell.period, delta);
    }
    bump(classDays, classDayKey(cell, cell.day), cell.subjectName, delta);
  };
  const indexCommon = (i: number, delta: number) => {
    const cell = cells[i];
    index(cell, delta);
    const classKey = classSlotKey(cell.grade, cell.classNo, cell.day, cell.period);
    const teacherKey = teacherSlotKey(cell.teacherName, cell.day, cell.period);
    if (delta > 0) {
      commonByClassSlot.set(classKey, i);
      commonByTeacherSlot.set(teacherKey, i);
    } else {
      commonByClassSlot.delete(classKey);
      commonByTeacherSlot.delete(teacherKey);
    }
  };
  for (const cell of fixedCells) index(cell, 1);
  cells.forEach((_, i) => indexCommon(i, 1));

  const teacherDayPenalty = (key: string): number => {
    const periods = teacherDays.get(key);
    if (!periods || periods.size === 0) return 0;
    let penalty = 0;
    if (lunchWeight > 0 && periods.has(beforeLunch) && periods.has(afterLunch)) {
      penalty += lunchWeight;
    }
    if (tripleWeight > 0) {
      const last = Math.max(...periods.keys());
      for (let start = 1; start + 2 <= last; start++) {
        if (
          isTripleRunWindow(start, lunchAfter) &&
          periods.has(start) &&
          periods.has(start + 1) &&
          periods.has(start + 2)
        ) {
          penalty += tripleWeight;
        }
      }
    }
    return penalty;
  };

  const classDayPenalty = (grade: Grade, key: string): number => {
    if (sameDayWeight === 0) return 0;
    const subjects = classDays.get(key);
    if (!subjects) return 0;
    let penalty = 0;
    for (const [subject, count] of subjects) {
      if (count >= 2 && banKeys.has(sameDaySubjectBanKey(grade, subject))) {
        penalty += sameDayWeight;
      }
    }
    return penalty;
  };

  const isHot = (i: number): boolean => {
    const cell = cells[i];
    if (teacherDayPenalty(teacherDayKey(cell.teacherName, cell.day)) > 0) return true;
    if (!banKeys.has(sameDaySubjectBanKey(cell.grade, cell.subjectName))) return false;
    return (classDays.get(classDayKey(cell, cell.day))?.get(cell.subjectName) ?? 0) >= 2;
  };

  /** Can `teacherName` take `slot`, ignoring the common lesson at index `vacating`? */
  const teacherFree = (teacherName: string, slot: Slot, vacating: number | null) => {
    const key = teacherSlotKey(teacherName, slot.day, slot.period);
    if (teacherBusySeed.has(key)) return false;
    const occupant = commonByTeacherSlot.get(key);
    return occupant === undefined || occupant === vacating;
  };

  /**
   * Try moving cells[i] to `slot`; if `j` is given, cells[j] (same class,
   * currently at `slot`) goes to cells[i]'s old slot. The move is kept when
   * `accept(delta)` says so (delta = change in total penalty), and the delta
   * is returned; otherwise it is undone and null is returned.
   */
  const attemptMove = (
    i: number,
    slot: Slot,
    j: number | null,
    accept: (delta: number) => boolean,
  ): number | null => {
    const a = cells[i];
    const from: Slot = { day: a.day, period: a.period };
    if (!teacherFree(a.teacherName, slot, j)) return null;
    if (j !== null && !teacherFree(cells[j].teacherName, from, i)) return null;

    const teacherKeys = new Set<string>();
    const classKeys = new Set<string>([classDayKey(a, from.day), classDayKey(a, slot.day)]);
    for (const name of [a.teacherName, ...(j !== null ? [cells[j].teacherName] : [])]) {
      teacherKeys.add(teacherDayKey(name, from.day));
      teacherKeys.add(teacherDayKey(name, slot.day));
    }
    const score = () => {
      let total = 0;
      for (const key of teacherKeys) total += teacherDayPenalty(key);
      for (const key of classKeys) total += classDayPenalty(a.grade, key);
      return total;
    };

    const before = score();
    const relocate = (to: Slot, other: Slot | null) => {
      indexCommon(i, -1);
      if (j !== null) indexCommon(j, -1);
      cells[i] = { ...cells[i], day: to.day, period: to.period };
      if (j !== null && other) cells[j] = { ...cells[j], day: other.day, period: other.period };
      indexCommon(i, 1);
      if (j !== null) indexCommon(j, 1);
    };
    relocate(slot, from);
    const delta = score() - before;
    if (accept(delta)) return delta;
    relocate(from, slot);
    return null;
  };

  const classIndices = new Map<string, number[]>();
  cells.forEach((cell, i) => {
    const key = `${cell.grade}:${cell.classNo}`;
    const list = classIndices.get(key);
    if (list) list.push(i);
    else classIndices.set(key, [i]);
  });

  const freeSlotsOf = (cell: TimetableCell): Slot[] => {
    const slots: Slot[] = [];
    for (const { key: day } of WEEKDAYS) {
      const count = schedules[cell.grade][day] ?? 0;
      for (let period = 1; period <= count; period++) {
        const key = classSlotKey(cell.grade, cell.classNo, day, period);
        if (!classBusySeed.has(key) && !commonByClassSlot.has(key)) {
          slots.push({ day, period });
        }
      }
    }
    return slots;
  };

  /** Same-class partner (swap) or free slot (move) for cells[i]. */
  const moveOptions = (i: number): { slot: Slot; j: number | null }[] => {
    const cell = cells[i];
    const options: { slot: Slot; j: number | null }[] = [];
    for (const j of classIndices.get(`${cell.grade}:${cell.classNo}`) ?? []) {
      if (j === i) continue;
      options.push({ slot: { day: cells[j].day, period: cells[j].period }, j });
    }
    for (const slot of freeSlotsOf(cell)) options.push({ slot, j: null });
    return options;
  };

  // Phase 1: steepest-first descent — take any improving move until none is left.
  const improving = (delta: number) => delta < 0;
  while (Date.now() < deadline) {
    let improved = false;
    for (const i of shuffle(cells.map((_, k) => k).filter(isHot))) {
      if (Date.now() >= deadline) break;
      if (!isHot(i)) continue; // an earlier move this pass may have fixed it
      for (const { slot, j } of shuffle(moveOptions(i))) {
        if (attemptMove(i, slot, j, improving) !== null) {
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  // Phase 2: simulated annealing for the rest of the budget, to climb out of
  // the local optimum phase 1 stops in. Sideways and mildly worse moves are
  // accepted with a probability that cools over time; the best arrangement
  // seen is what gets returned.
  let current = 0;
  for (const key of teacherDays.keys()) current += teacherDayPenalty(key);
  for (const key of classDays.keys()) {
    current += classDayPenalty(Number(key.split("|")[0]) as Grade, key);
  }
  let best = current;
  let bestCells = cells.map((c) => ({ ...c }));
  const start = Date.now();
  const span = Math.max(1, deadline - start);
  let hot: number[] = [];
  for (let iter = 0; current > 0 && Date.now() < deadline; iter++) {
    if (iter % 200 === 0) hot = cells.map((_, k) => k).filter(isHot);
    if (hot.length === 0) break;
    // Mostly work on cells involved in a penalty, sometimes on any cell so
    // the search can rearrange around them.
    const i =
      Math.random() < 0.8
        ? hot[Math.floor(Math.random() * hot.length)]
        : Math.floor(Math.random() * cells.length);
    const options = moveOptions(i);
    if (options.length === 0) continue;
    const { slot, j } = options[Math.floor(Math.random() * options.length)];
    const temperature = 2.5 * (1 - (Date.now() - start) / span) + 0.05;
    const delta = attemptMove(
      i,
      slot,
      j,
      (d) => d <= 0 || Math.random() < Math.exp(-d / temperature),
    );
    if (delta === null) continue;
    current += delta;
    if (current < best) {
      best = current;
      bestCells = cells.map((c) => ({ ...c }));
    }
  }

  return bestCells;
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
    if (a.day !== b.day) return weekdayIndex(a.day) - weekdayIndex(b.day);
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
  const sameDayWeight = sameDaySubjectWeight(preferences);
  if (sameDayWeight > 0) {
    score +=
      listSameDaySubjectViolations(cells, preferences.sameDaySubjectBans).length *
      sameDayWeight;
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
  /**
   * lessonId -> placed cell. Keyed by id (instead of a plain array) so
   * placeLesson/unplaceLesson are O(1) — unplaceLesson in particular is not
   * always undoing the most recently placed cell (repairUnplaced displaces
   * arbitrary earlier placements), so a stack/pop shortcut isn't safe and a
   * findIndex+splice scan would otherwise be O(placed count) per undo.
   */
  cellsByLessonId: Map<number, TimetableCell>;
  /** teacherSlotKey set for placed cells, for O(1) teacherHasLessonAt checks. */
  teacherLessons: Set<string>;
  /** Fixed + placed (class, day, subject) counts for the 동일 교과 penalty. */
  classDaySubjects: ClassDaySubjectCounts;
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
  state.teacherLessons.add(
    teacherSlotKey(lesson.teacherName.trim(), slot.day, slot.period),
  );
  state.assignment.set(lesson.id, slot);
  bumpClassDaySubject(state.classDaySubjects, { ...lesson, ...slot }, 1);
  state.cellsByLessonId.set(lesson.id, {
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
  state.teacherLessons.delete(
    teacherSlotKey(lesson.teacherName.trim(), slot.day, slot.period),
  );
  state.assignment.delete(lesson.id);
  bumpClassDaySubject(state.classDaySubjects, { ...lesson, ...slot }, -1);
  state.cellsByLessonId.delete(lesson.id);
}

function placedCellsArray(state: PlaceState): TimetableCell[] {
  return [...state.cellsByLessonId.values()];
}

/**
 * Per-class view of the remaining lessons: how many still need a slot, and
 * the union of slots any of them could take. Lessons of the same
 * (teacher, class, subject) share one domain, so each such group's slots are
 * added once.
 */
type ClassCoverage = Map<
  string,
  { need: number; slots: Set<string>; groups: Set<string> }
>;

function addToClassCoverage(
  coverage: ClassCoverage,
  lesson: CommonLesson,
  slots: Slot[],
) {
  const classKey = `${lesson.grade}:${lesson.classNo}`;
  let entry = coverage.get(classKey);
  if (!entry) {
    entry = { need: 0, slots: new Set(), groups: new Set() };
    coverage.set(classKey, entry);
  }
  entry.need += 1;
  const group = unplacedKey(lesson);
  if (entry.groups.has(group)) return;
  entry.groups.add(group);
  for (const slot of slots) entry.slots.add(`${slot.day}:${slot.period}`);
}

/**
 * Each lesson needs its own class slot, so a class whose candidate slots are
 * fewer than its pending lessons can't be completed. This catches what the
 * per-lesson MRV check never sees: in a tight timetable (as many lessons as
 * free slots) a single class slot that no remaining lesson can take — e.g. a
 * lunch-adjacent slot under the hard lunch rule — dooms the whole branch.
 */
function classCoverageShort(coverage: ClassCoverage): boolean {
  for (const entry of coverage.values()) {
    if (entry.slots.size < entry.need) return true;
  }
  return false;
}

/**
 * True when the hard lunch rule leaves some class unable to place all its
 * lessons even before anything is placed — the hard pass can then never
 * succeed and its budget is better spent on the soft pass.
 */
function hardLunchInfeasibleAtRoot(
  lessons: CommonLesson[],
  schedules: GradeDaySchedules,
  classBusySeed: Set<string>,
  teacherBusySeed: Set<string>,
  fixedCells: TimetableCell[],
  lunchAfterPeriod: number,
): boolean {
  const fixedTeacherLessons = buildTeacherLessonSet(fixedCells);
  const placed = new Set<string>();
  const coverage: ClassCoverage = new Map();
  for (const lesson of lessons) {
    const slots = slotsForLessonSearch(
      lesson,
      schedules,
      classBusySeed,
      teacherBusySeed,
      true,
      lunchAfterPeriod,
      fixedTeacherLessons,
      placed,
    );
    if (slots.length === 0) return true;
    addToClassCoverage(coverage, lesson, slots);
  }
  return classCoverageShort(coverage);
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

  // Fixed cells never change across restarts/nodes, so index them once
  // instead of letting every slot check scan the fixedCells array.
  const fixedTeacherLessons = buildTeacherLessonSet(fixedCells);
  const fixedClassDaySubjects: ClassDaySubjectCounts = new Map();
  for (const cell of fixedCells) bumpClassDaySubject(fixedClassDaySubjects, cell, 1);
  const banKeys = sameDayBanKeys(preferences);

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
      bestCells = placedCellsArray(state);
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
      cellsByLessonId: new Map(),
      teacherLessons: new Set(),
      classDaySubjects: new Map(fixedClassDaySubjects),
    };
    const remaining = new Set(lessons.map((l) => l.id));
    const byId = new Map(lessons.map((l) => [l.id, l]));
    // Per-restart budget, like the lunch/same-day solvers — a shared counter
    // would make every restart after the first exhaustion abort immediately.
    let restartNodes = 0;
    const outOfBudget = () =>
      restartNodes > options.nodeLimit || Date.now() > restartDeadline;

    const search = (): boolean => {
      nodes += 1;
      restartNodes += 1;
      if (outOfBudget()) {
        considerBest(state, remaining, byId);
        return false;
      }
      if (remaining.size === 0) return true;

      let bestId: number | null = null;
      let bestSlots: Slot[] = [];
      let bestCount = Infinity;
      let bestDeg = -1;
      const coverage: ClassCoverage = new Map();

      for (const id of remaining) {
        const lesson = byId.get(id)!;
        const slots = slotsForLessonSearch(
          lesson,
          schedules,
          state.classBusy,
          state.teacherBusy,
          options.hardAvoidLunch,
          preferences.lunchAfterPeriod,
          fixedTeacherLessons,
          state.teacherLessons,
        );
        addToClassCoverage(coverage, lesson, slots);
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

      if (bestId === null || bestCount === 0 || classCoverageShort(coverage)) {
        considerBest(state, remaining, byId);
        return false;
      }

      const lesson = byId.get(bestId)!;
      remaining.delete(bestId);

      const ordered = orderSlotsForLesson(
        lesson,
        bestSlots,
        fixedTeacherLessons,
        state.teacherLessons,
        state.classDaySubjects,
        banKeys,
        preferences,
      );

      for (const slot of ordered) {
        placeLesson(state, lesson, slot);
        if (search()) return true;
        unplaceLesson(state, lesson, slot);
        if (outOfBudget()) {
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
      const finalCells = placedCellsArray(state);
      if (!keepSearchingAfterComplete()) {
        return {
          commonCells: finalCells,
          unplaced: [],
          attemptsUsed,
          nodes,
        };
      }
      const penalty = scoreComplete(finalCells);
      if (penalty < bestCompletePenalty) {
        bestCompletePenalty = penalty;
        bestComplete = finalCells;
      }
      if (penalty === 0) {
        return {
          commonCells: finalCells,
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
    cellsByLessonId: new Map(),
    teacherLessons: new Set(),
    classDaySubjects: new Map(),
  };

  // Rebuild state from initial common cells (approximate: match lessons
  // greedily). Both this loop and the "pending" loop below draw from the
  // *same* `byKey` pool and consume it sequentially, so together they
  // partition each key's lessons with no overlap and no gap — drawing from
  // two independent copies here previously let both loops pop the same
  // trailing lesson objects (double-placing them, silently losing others).
  for (const cell of initialCells) {
    if (cell.kind !== "common") continue;
    const key = `${cell.teacherName}|${cell.grade}|${cell.classNo}|${cell.subjectName}`;
    const list = byKey.get(key);
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
        const blockers = placedCellsArray(state).filter((c) => {
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
    commonCells: placedCellsArray(state),
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
  // induced or otherwise unavoidable doubles. When the hard rule already
  // leaves some class short of slots before anything is placed (typically a
  // lunch slot 점심시간 우선 배치 had to leave empty), the hard pass can never
  // succeed, so skip it and give the whole budget to the soft pass.
  const tryHardLunchPass =
    preferences.avoidLunchDouble &&
    !hardLunchInfeasibleAtRoot(
      lessons,
      schedules,
      classBusySeed,
      teacherBusySeed,
      fixedCells,
      preferences.lunchAfterPeriod,
    );
  let solved: ReturnType<typeof solveBacktracking>;
  if (tryHardLunchPass) {
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
    if (hasSoftPreferences(preferences)) {
      // Repair budget is unused on complete solves — spend it on local
      // search over the soft preferences. The results show up in the
      // dedicated diagnostic panels, so no separate message note is needed.
      finalCommon = improveSoftPreferences({
        fixedCells,
        commonCells: finalCommon,
        schedules,
        classBusySeed,
        teacherBusySeed,
        preferences,
        timeLimitMs: Math.max(1500, repairBudget),
      });
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
 * Group keys whose teacher can fill `target` without creating a lunch
 * double: still has hours for that class, is free at the target period (not
 * teaching and not 배정 불가), and is not *teaching* at the partner period.
 * 배정 불가 on the partner period is fine — the teacher simply won't teach
 * then, so no double can form.
 */
function lunchCandidateKeys(
  target: LunchSlotTarget,
  classGroupKeys: Map<string, string[]>,
  groups: Map<string, LunchLessonGroup>,
  teacherBusySeed: Set<string>,
  teacherLessonSeed: Set<string>,
  lunchAfterPeriod: number,
): string[] {
  const [before, after] = lunchPairPeriods(lunchAfterPeriod);
  const partner = target.period === before ? after : before;
  const out: string[] = [];
  for (const key of classGroupKeys.get(`${target.grade}|${target.classNo}`) ?? []) {
    const g = groups.get(key)!;
    if (g.count <= 0) continue;
    if (teacherBusySeed.has(teacherSlotKey(g.teacherName, target.day, target.period))) {
      continue;
    }
    if (teacherLessonSeed.has(teacherSlotKey(g.teacherName, target.day, partner))) {
      continue;
    }
    out.push(key);
  }
  return out;
}

/**
 * Maximum bipartite matching (Kuhn's augmenting paths) of one day's lunch
 * targets to teachers. A teacher can take at most one lunch-adjacent slot per
 * day — two slots would either straddle lunch (a double) or overlap in the
 * same period — so per day this is exactly a matching problem, and augmenting
 * paths re-route earlier choices instead of getting stuck on them the way
 * chronological backtracking does. Returns the chosen group key per target.
 */
function matchLunchDay(
  candidates: string[][],
  groups: Map<string, LunchLessonGroup>,
): (string | null)[] {
  const owner = new Map<string, { target: number; key: string }>();
  const tryAssign = (i: number, seen: Set<string>): boolean => {
    for (const key of candidates[i]) {
      const teacher = groups.get(key)!.teacherName;
      if (seen.has(teacher)) continue;
      seen.add(teacher);
      const current = owner.get(teacher);
      if (!current || tryAssign(current.target, seen)) {
        owner.set(teacher, { target: i, key });
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < candidates.length; i++) tryAssign(i, new Set());

  const chosen: (string | null)[] = candidates.map(() => null);
  for (const { target, key } of owner.values()) chosen[target] = key;
  return chosen;
}

type LunchDayBound = { day: Weekday; targets: number; max: number };

/**
 * Fills lunch-adjacent targets day by day with a maximum matching per day.
 * Days only interact through each (teacher, class, subject)'s remaining
 * hours, so the tightest days (least spare teachers) go first and later
 * attempts perturb the day/candidate order, keeping the best total.
 *
 * Also returns each day's matching size with full hours available — an
 * upper bound no placement can beat, used to tell structural shortfalls
 * (not enough teachers that day) apart from cross-day hour contention.
 */
function solveLunchSlots(
  targets: LunchSlotTarget[],
  groupsSeed: Map<string, LunchLessonGroup>,
  teacherBusySeed: Set<string>,
  teacherLessonSeed: Set<string>,
  lunchAfterPeriod: number,
  timeLimitMs: number,
  restarts: number,
): { cells: TimetableCell[]; attemptsUsed: number; dayBounds: LunchDayBound[] } {
  const deadline = Date.now() + Math.max(0, timeLimitMs);

  const classGroupKeys = new Map<string, string[]>();
  for (const [key, g] of groupsSeed) {
    const classKey = `${g.grade}|${g.classNo}`;
    const list = classGroupKeys.get(classKey);
    if (list) list.push(key);
    else classGroupKeys.set(classKey, [key]);
  }

  const byDay = new Map<Weekday, number[]>();
  targets.forEach((t, i) => {
    const list = byDay.get(t.day);
    if (list) list.push(i);
    else byDay.set(t.day, [i]);
  });

  const candidatesFor = (idx: number[], groups: Map<string, LunchLessonGroup>) =>
    idx.map((i) =>
      lunchCandidateKeys(
        targets[i],
        classGroupKeys,
        groups,
        teacherBusySeed,
        teacherLessonSeed,
        lunchAfterPeriod,
      ),
    );

  const dayBounds: LunchDayBound[] = [];
  const slack = new Map<Weekday, number>();
  for (const [day, idx] of byDay) {
    const candidates = candidatesFor(idx, groupsSeed);
    const max = matchLunchDay(candidates, groupsSeed).filter(Boolean).length;
    dayBounds.push({ day, targets: idx.length, max });
    const pool = new Set(
      candidates.flat().map((key) => groupsSeed.get(key)!.teacherName),
    );
    slack.set(day, pool.size - idx.length);
  }
  const upperBound = dayBounds.reduce((s, d) => s + d.max, 0);

  let bestCells: TimetableCell[] = [];
  let attemptsUsed = 0;

  for (let attempt = 0; attempt < Math.max(1, restarts); attempt++) {
    if (attempt > 0 && Date.now() > deadline) break;
    attemptsUsed = attempt + 1;
    // Every attempt (including the first) shuffles target and candidate
    // order, so pressing 점심시간 우선 배치 again yields a different — equally
    // full — arrangement. The first attempt keeps the strict tightest-day-
    // first order (noise < 1 only breaks ties); later attempts perturb it so
    // a different day gets first pick of shared hours.
    const dayNoise = attempt === 0 ? 0.9 : 3;
    const days = [...byDay.keys()]
      .map((day) => ({
        day,
        score: slack.get(day)! + Math.random() * dayNoise,
      }))
      .sort((a, b) => a.score - b.score)
      .map((d) => d.day);

    const groups = new Map<string, LunchLessonGroup>();
    for (const [key, g] of groupsSeed) groups.set(key, { ...g });
    const cells: TimetableCell[] = [];

    for (const day of days) {
      const idx = shuffle(byDay.get(day)!);
      const candidates = candidatesFor(idx, groups).map((c) => shuffle(c));
      const chosen = matchLunchDay(candidates, groups);
      chosen.forEach((key, j) => {
        if (!key) return;
        const g = groups.get(key)!;
        g.count -= 1;
        const target = targets[idx[j]];
        cells.push({
          grade: target.grade,
          classNo: target.classNo,
          day: target.day,
          period: target.period,
          subjectName: g.subjectName,
          teacherName: g.teacherName,
          kind: "common",
        });
      });
    }

    if (cells.length > bestCells.length) bestCells = cells;
    if (bestCells.length >= upperBound) break;
  }

  dayBounds.sort((a, b) => weekdayIndex(a.day) - weekdayIndex(b.day));
  return { cells: bestCells, attemptsUsed, dayBounds };
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
  /** Previous run's lunch cells, so the message can say what changed. */
  previousLunchCells?: SubjectBlockCell[];
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
    previousLunchCells = [],
  } = input;

  const {
    setCells,
    classBusySeed,
    teacherBusySeed,
    teacherLessonSeed,
    lockedBlocks,
  } = prepareBusySeeds({
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

  const {
    cells: placedCells,
    attemptsUsed,
    dayBounds,
  } = solveLunchSlots(
    targets,
    groups,
    teacherBusySeed,
    teacherLessonSeed,
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
  const changeNote = describeLunchChange(targets, previousLunchCells, lunchCells);

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
      message: `점심 전후 교시 ${targetCount}칸을 모두 배치했습니다. (시도 ${attemptsUsed}회)${guaranteeNote}${changeNote}`,
    };
  }

  const unfilled = targetCount - filledCount;
  // Per-day matching size is an exact upper bound: a teacher can take only
  // one lunch-adjacent slot per day, so any gap below it is structural.
  const shortDays = dayBounds.filter((d) => d.max < d.targets);
  const structuralGap = shortDays.reduce((s, d) => s + d.targets - d.max, 0);
  const contentionGap = unfilled - structuralGap;
  let hint = "";
  if (structuralGap > 0) {
    const detail = shortDays
      .map((d) => `${dayLabel(d.day)}요일은 ${d.targets}칸 중 최대 ${d.max}칸`)
      .join(", ");
    hint += `\n${detail}까지만 채울 수 있습니다. 교사 한 명은 하루에 점심 전후 중 한 칸만 맡을 수 있는데, 그날 점심 전후 수업을 맡을 수 있는 교사가 부족하기 때문입니다. 이 ${structuralGap}칸은 다시 시도해도 채워지지 않으니, 해당 요일 점심 전후에 SET·선 수업을 배치하거나 교사 배정을 조정해 주세요.`;
  }
  if (contentionGap > 0) {
    hint += `\n${structuralGap > 0 ? "나머지 " : ""}${contentionGap}칸은 같은 반·교사의 남은 시수를 여러 요일이 나눠 써야 해서 함께 채울 수 없는 칸입니다. 여러 번 시도한 결과 중 가장 많이 채운 배치라 다시 눌러도 거의 줄지 않습니다. 선택한 교과의 우선 배치(동일 교과 우선 배치 등)가 시수를 많이 차지했다면 그 범위를 줄이면 나아질 수 있습니다.`;
  }

  return {
    lunchCells,
    cells: allCells,
    targetCount,
    filledCount,
    status: "failed",
    message: `점심 전후 교시 중 ${filledCount}/${targetCount}칸만 배치했습니다. (시도 ${attemptsUsed}회)${changeNote}${describeEmptyLunchTargets(targets, lunchCells)}${hint}`,
  };
}

function lunchTargetLabel(t: Pick<LunchSlotTarget, "grade" | "classNo" | "day" | "period">): string {
  return `${dayLabel(t.day)} ${t.grade}-${t.classNo}반 ${t.period}교시`;
}

/**
 * Re-running lunch priority usually yields the same counts, so without this
 * the result message reads identically every press even though the
 * arrangement changed. Compare slot by slot against the previous run.
 */
function describeLunchChange(
  targets: LunchSlotTarget[],
  previous: SubjectBlockCell[],
  next: SubjectBlockCell[],
): string {
  if (previous.length === 0) return "";
  const assigned = (cells: SubjectBlockCell[]) =>
    new Map(
      cells.map((c) => [
        classSlotKey(c.grade, c.classNo, c.day, c.period),
        `${c.teacherName}|${c.subjectName}`,
      ]),
    );
  const before = assigned(previous);
  const after = assigned(next);
  let changed = 0;
  for (const t of targets) {
    const key = classSlotKey(t.grade, t.classNo, t.day, t.period);
    if (before.get(key) !== after.get(key)) changed += 1;
  }
  return changed === 0
    ? "\n이전 배치와 같은 결과입니다. 이 조건에서 가능한 배치가 매우 적은 것으로 보입니다."
    : `\n이전 배치와 비교해 ${changed}칸이 바뀌었습니다.`;
}

const EMPTY_LUNCH_LIST_LIMIT = 15;

/** Which lunch targets stayed empty — these differ from run to run. */
function describeEmptyLunchTargets(
  targets: LunchSlotTarget[],
  lunchCells: SubjectBlockCell[],
): string {
  const filled = new Set(
    lunchCells.map((c) => classSlotKey(c.grade, c.classNo, c.day, c.period)),
  );
  const empty = targets
    .filter((t) => !filled.has(classSlotKey(t.grade, t.classNo, t.day, t.period)))
    .sort(
      (a, b) =>
        weekdayIndex(a.day) - weekdayIndex(b.day) ||
        a.grade - b.grade ||
        a.classNo - b.classNo ||
        a.period - b.period,
    );
  if (empty.length === 0) return "";
  const shown = empty.slice(0, EMPTY_LUNCH_LIST_LIMIT).map(lunchTargetLabel);
  const more =
    empty.length > EMPTY_LUNCH_LIST_LIMIT
      ? ` 외 ${empty.length - EMPTY_LUNCH_LIST_LIMIT}칸`
      : "";
  return `\n비어 있는 칸: ${shown.join(", ")}${more}`;
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
    if (a.day !== b.day) return weekdayIndex(a.day) - weekdayIndex(b.day);
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
  fixedTeacherLessons: Set<string>,
  placedTeacherLessons: Set<string>,
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
        fixedTeacherLessons,
        placedTeacherLessons,
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

  // Fixed cells never change across restarts/nodes, so index them once
  // instead of letting every slot check scan the fixedCells array.
  const fixedTeacherLessons = buildTeacherLessonSet(fixedCells);

  let bestCells: TimetableCell[] = [];
  let attemptsUsed = 0;

  for (let restart = 0; restart < restarts; restart++) {
    if (Date.now() > globalDeadline) break;
    attemptsUsed = restart + 1;
    const restartDeadline = Math.min(globalDeadline, Date.now() + sliceMs);

    const classBusy = new Set(classBusySeed);
    const teacherBusy = new Set(teacherBusySeed);
    const placed: TimetableCell[] = [];
    const placedTeacherLessons = new Set<string>();
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
          fixedTeacherLessons,
          placedTeacherLessons,
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
        placedTeacherLessons.add(
          teacherSlotKey(lesson.teacherName.trim(), slot.day, slot.period),
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
        placedTeacherLessons.delete(
          teacherSlotKey(lesson.teacherName.trim(), slot.day, slot.period),
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

/**
 * Fields that reset the working full-generation result to "not generated".
 * Used when a priority stage re-locks cells, since any previously generated
 * full timetable was built on the old locks and must not be confirmed.
 */
export function clearedWorkingResult() {
  return {
    status: "idle" as const,
    cells: [] as TimetableCell[],
    unplaced: [] as TimetableUnplaced[],
    message: "",
    lunchDoubleCount: 0,
    lunchDoubles: [] as SoftRunDetail[],
    tripleRunCount: 0,
    tripleRuns: [] as SoftRunDetail[],
    sameDaySubjectViolationCount: 0,
    sameDaySubjectViolations: [] as SameDaySubjectViolation[],
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

/**
 * Fixed common cells (교과 블록 + 우선 배치 잠금) are merged from several
 * independently saved sources, so they can collide with SET cells or with
 * each other (e.g. 동일 교과 우선 배치 re-run after 점심시간 우선 배치, or SET
 * blocks moved after locking). Keep them in input order — earlier sources win
 * — and drop any cell whose class or teacher slot is already taken, marking
 * the kept ones busy as we go. Dropped cells' lessons fall back to the normal
 * search since `consumeLessonsForSubjectBlocks` only consumes kept blocks.
 */
function keepNonConflictingBlocks(
  blocks: SubjectBlockCell[],
  classBusy: Set<string>,
  teacherBusy: Set<string>,
): SubjectBlockCell[] {
  const kept: SubjectBlockCell[] = [];
  for (const cell of blocks) {
    const classKey = classSlotKey(cell.grade, cell.classNo, cell.day, cell.period);
    const teacherKey = teacherSlotKey(cell.teacherName, cell.day, cell.period);
    if (classBusy.has(classKey) || teacherBusy.has(teacherKey)) continue;
    classBusy.add(classKey);
    teacherBusy.add(teacherKey);
    kept.push(cell);
  }
  return kept;
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
  /** Teacher slots with an actual fixed lesson (teacherBusySeed minus 배정 불가). */
  teacherLessonSeed: Set<string>;
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
  const lockedBlocks = keepNonConflictingBlocks(
    filterSubjectBlocksToAssignments(
      input.subjectBlocks ?? [],
      input.teachers,
      input.subjects,
      input.classCounts,
      input.schedules,
    ),
    classBusySeed,
    teacherBusySeed,
  );
  const teacherLessonSeed = new Set(teacherBusySeed);
  markTeacherBusyFromForbidden(input.forbiddenSlots ?? [], teacherBusySeed);
  return {
    catalog,
    setCells,
    classBusySeed,
    teacherBusySeed,
    teacherLessonSeed,
    lockedBlocks,
  };
}

/** SET + 선 수업만으로 만든 미리보기 칸. 생성 결과 DB에는 쓰지 않는다. */
export function buildSeedTimetableCells(input: {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  teacherAssignments?: SetTeacherAssignment[];
  subjectBlocks?: SubjectBlockCell[];
}): TimetableCell[] {
  const { setCells, lockedBlocks } = prepareBusySeeds({
    ...input,
    forbiddenSlots: [],
  });
  return [...setCells, ...subjectBlocksToTimetableCells(lockedBlocks)];
}

