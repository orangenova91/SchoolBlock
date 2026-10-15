import {
  createDefaultGenerationPreferences,
  isTripleRunWindow,
  sameDaySubjectBanKey,
} from "@/lib/generation-preferences";
import {
  catalogGradeSets,
  findGradeSet,
  teachersBusyForGradeSetAtSlot,
} from "@/lib/set-blocks";
import {
  buildSeedTimetableCells,
  generateTimetable,
  listLunchTeacherDoubles,
  listSameDaySubjectViolations,
  listTeacherTripleRuns,
  solveSameDaySubjectPriority,
  type GenerateTimetableInput,
  type GenerateTimetableResult,
} from "@/lib/timetable";
import {
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  type Grade,
  type GradeDaySchedules,
  type SubjectBlockCell,
  type TimetableCell,
  type TimetableUnplaced,
  type Weekday,
} from "@/lib/types";
import { DEFAULT_V2_WEIGHTS, type V2Weights } from "@/lib/v2-weights";

/**
 * 시간표 생성 로직 v2 (비교 검토용).
 *
 * v2는 우선 배치 버튼을 쓰지 않는다. 추가 조건에서 켠 기능은 생성 버튼 한
 * 번 안에서 자동으로 반영한다. 전체 시간 예산(`timeLimitMs`) 안에서:
 *
 * 1. (선택) 동일 교과 같은 날 금지가 켜져 있으면 해당 교과를 먼저 요일
 *    분산해 초기 배치의 출발점으로 쓴다(`sameDayFirstMs`, 기본 꺼짐).
 * 2. 기존 `generateTimetable`로 초기 배치를 만든다(`initialMs`).
 * 3. 교환 개선: SET·선 수업(사용자가 칠한 교과 블록)·배정 불가만 고정하고,
 *    나머지 공통 수업은 같은 반 안에서 서로 자리를 바꾸며 하나의 점수(교사
 *    중복·배정 불가 + 점심 연강 + 3연강 + 동일 교과 같은 날 중복)를 낮춘다.
 *    반마다 빈칸이 없는 시간표에서도 움직일 수 있도록 "빈칸으로 이동"이
 *    아니라 "두 칸 교환"을 쓴다. 담금질(점차 식히기)을 한 바퀴(`cycleMs`)
 *    돌 때마다 최저 점수가 갱신됐으면 최저 상태에서 다시 데워 한 바퀴 더
 *    돈다. 한 바퀴 내내 최저 점수가 그대로면 더 반복해도 나아지지 않는
 *    것으로 보고 끝낸다(`earlyStop`). 전체 시간은 `timeLimitMs`가 상한이다.
 * 4. 그래도 남은 교사 중복은 해당 공통 수업을 빼서 미배치로 돌려준다.
 */

/** 필수 조건(교사 중복·배정 불가) 위반 1건의 비용. 선호 조건보다 항상 크게 둔다. */
const HARD_WEIGHT = 1000;

const DEFAULT_INITIAL_MS = 2_500;
const DEFAULT_SAME_DAY_FIRST_MS = 0;
/** 담금질 한 바퀴 길이. 한 바퀴 동안 최저 점수가 그대로면 종료한다. */
const DEFAULT_CYCLE_MS = 8_000;
/** 두 번째 바퀴부터 다시 데우는 온도 (첫 바퀴는 ANNEAL_START_TEMP). */
const DEFAULT_REHEAT_TEMP = 0.8;
/** 교환 개선에 최소한으로 남겨 두는 시간. */
const MIN_SWAP_MS = 1_000;
const ANNEAL_START_TEMP = 4;
const ANNEAL_END_TEMP = 0.05;

const EMPTY = -1;
/** SET이 차지한 반 칸. 교환 대상이 아니다. */
const SET_CELL = -2;

const PERIOD_STRIDE = MAX_PERIODS + 1;
const DAY_KEYS = WEEKDAYS.map(({ key }) => key);

type Slot = { day: Weekday; dayIndex: number; period: number; time: number };

type Lesson = {
  grade: Grade;
  classNo: number;
  subjectName: string;
  teacherName: string;
  /** 선 수업(교과 블록)으로 사용자가 고정한 칸. */
  pinned: boolean;
};

export type GenerateTimetableV2Progress = {
  phase: "sameDayFirst" | "initial" | "swap" | "done";
  /** 생성 시작부터 지난 시간. */
  elapsedMs: number;
  /** 교환 개선 중 지금까지 가장 낮은 점수 (필수 위반 1건 = 1000점). */
  bestCost?: number;
};

export type GenerateTimetableV2Options = {
  /** 초기 배치(기존 생성기)에 쓰는 시간. */
  initialMs?: number;
  /** 동일 교과 선적용에 쓰는 시간. 0이면 쓰지 않는다. */
  sameDayFirstMs?: number;
  /** 한 바퀴 내내 점수가 그대로면 예산 전에 끝낸다. */
  earlyStop?: boolean;
  cycleMs?: number;
  reheatTemp?: number;
  /** 선호 조건 가중치. 없으면 기본값. */
  weights?: V2Weights;
  /**
   * 정확 판정(MILP)이 찾은 미배치 0 배치안 (공통 수업만). 주어지면 기존
   * 생성기 대신 이것을 초기 배치로 쓰므로 처음부터 미배치가 없다.
   */
  initialCommonCells?: TimetableCell[];
  /** 측정용. 단계 전환과 최저 점수 갱신 때 호출된다. */
  onProgress?: (progress: GenerateTimetableV2Progress) => void;
};

export type GenerateTimetableV2Input = GenerateTimetableInput & {
  /** 사용자가 직접 칠한 선 수업. 교환 개선에서 움직이면 안 되는 칸이다. */
  pinnedSubjectBlocks: SubjectBlockCell[];
  v2?: GenerateTimetableV2Options;
};

function timeKey(dayIndex: number, period: number): number {
  return dayIndex * PERIOD_STRIDE + period;
}

function lessonKey(
  cell: Pick<TimetableCell, "grade" | "classNo" | "day" | "period" | "subjectName" | "teacherName">,
): string {
  return `${cell.grade}|${cell.classNo}|${cell.day}|${cell.period}|${cell.subjectName}|${cell.teacherName}`;
}

function buildSlots(schedules: GradeDaySchedules): Record<Grade, Slot[]> {
  const out = {} as Record<Grade, Slot[]>;
  for (const grade of GRADES) {
    const slots: Slot[] = [];
    DAY_KEYS.forEach((day, dayIndex) => {
      const count = schedules[grade][day] ?? 0;
      for (let period = 1; period <= count; period++) {
        slots.push({ day, dayIndex, period, time: timeKey(dayIndex, period) });
      }
    });
    out[grade] = slots;
  }
  return out;
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * v2 생성. 반환 형식은 `generateTimetable`과 같아서 저장·화면 코드는
 * 그대로 쓴다.
 */
export function generateTimetableV2(
  input: GenerateTimetableV2Input,
): GenerateTimetableResult {
  const { timeLimitMs = 15_000, v2: options = {} } = input;
  const startedAt = Date.now();
  const deadline = startedAt + timeLimitMs;
  const elapsed = () => Date.now() - startedAt;
  const report = options.onProgress ?? (() => {});
  const preferences =
    input.preferences ?? createDefaultGenerationPreferences();

  // 1. 동일 교과 선적용 (조건이 켜져 있고 시간이 주어졌을 때만)
  let hintBlocks: SubjectBlockCell[] = [];
  const sameDayFirstMs = options.sameDayFirstMs ?? DEFAULT_SAME_DAY_FIRST_MS;
  if (
    sameDayFirstMs > 0 &&
    preferences.avoidSameDaySubject &&
    preferences.sameDaySubjectBans.length > 0
  ) {
    report({ phase: "sameDayFirst", elapsedMs: elapsed() });
    hintBlocks = solveSameDaySubjectPriority({
      ...input,
      subjectBlocks: input.pinnedSubjectBlocks,
      sameDaySubjectBans: preferences.sameDaySubjectBans,
      avoidLunchDouble: preferences.avoidLunchDouble,
      lunchAfterPeriod: preferences.lunchAfterPeriod,
      timeLimitMs: Math.min(
        sameDayFirstMs,
        Math.max(0, timeLimitMs - MIN_SWAP_MS),
      ),
      restarts: 8,
    }).lockCells;
  }

  // 2. 초기 배치: 정확 판정의 배치안이 있으면 그대로, 없으면 기존 생성기
  report({ phase: "initial", elapsedMs: elapsed() });
  let initial: Pick<GenerateTimetableResult, "cells" | "unplaced" | "attemptsUsed">;
  if (options.initialCommonCells) {
    initial = {
      cells: [
        ...buildSeedTimetableCells({
          ...input,
          subjectBlocks: input.pinnedSubjectBlocks,
        }),
        ...options.initialCommonCells,
      ],
      unplaced: [],
      attemptsUsed: 0,
    };
  } else {
    const initialMs = Math.max(
      500,
      Math.min(
        options.initialMs ?? DEFAULT_INITIAL_MS,
        deadline - Date.now() - MIN_SWAP_MS,
      ),
    );
    initial = generateTimetable({
      ...input,
      subjectBlocks: [...input.pinnedSubjectBlocks, ...hintBlocks],
      preferences,
      timeLimitMs: initialMs,
      restarts: Math.max(1, Math.round(initialMs / 500)),
    });
  }

  // 3. 교환 개선
  const result = improveBySwaps(input, initial, {
    deadline: Math.max(deadline, Date.now() + MIN_SWAP_MS),
    earlyStop: options.earlyStop ?? true,
    cycleMs: options.cycleMs ?? DEFAULT_CYCLE_MS,
    reheatTemp: options.reheatTemp ?? DEFAULT_REHEAT_TEMP,
    weights: options.weights ?? DEFAULT_V2_WEIGHTS,
    onBest: (bestCost) =>
      report({ phase: "swap", elapsedMs: elapsed(), bestCost }),
  });
  report({ phase: "done", elapsedMs: elapsed() });
  const seconds = (elapsed() / 1000).toFixed(1);
  return { ...result, message: `${result.message} · ${seconds}초` };
}

function improveBySwaps(
  input: GenerateTimetableV2Input,
  initial: Pick<GenerateTimetableResult, "cells" | "unplaced" | "attemptsUsed">,
  options: {
    deadline: number;
    earlyStop: boolean;
    cycleMs: number;
    reheatTemp: number;
    weights: V2Weights;
    onBest: (bestCost: number) => void;
  },
): GenerateTimetableResult {
  const {
    teachers,
    subjects,
    classCounts,
    schedules,
    wholeCells,
    partialCells,
    teacherAssignments = [],
    forbiddenSlots = [],
    pinnedSubjectBlocks,
  } = input;
  const preferences =
    input.preferences ?? createDefaultGenerationPreferences();
  const lunchAfterPeriod = preferences.lunchAfterPeriod;
  const lunchWeight = preferences.avoidLunchDouble ? options.weights.lunch : 0;
  const tripleWeight = preferences.avoidTriplePeriod ? options.weights.triple : 0;
  const sameDayWeight = options.weights.sameDay;
  const sameDayBans = preferences.avoidSameDaySubject
    ? new Set(
        preferences.sameDaySubjectBans.map((b) =>
          sameDaySubjectBanKey(b.grade, b.subjectName),
        ),
      )
    : new Set<string>();

  const slots = buildSlots(schedules);
  const slotIndexOf = (grade: Grade, day: Weekday, period: number) =>
    slots[grade].findIndex((s) => s.day === day && s.period === period);

  // ── 고정 점유: SET(교사 기준은 기존 생성기와 같은 규칙), 배정 불가 ──
  const catalog = catalogGradeSets(subjects, classCounts);
  const setTeacherTimes = new Set<string>();
  for (const cell of [...wholeCells, ...partialCells]) {
    const info = findGradeSet(catalog, cell.grade, cell.set);
    if (!info) continue;
    const time = timeKey(DAY_KEYS.indexOf(cell.day), cell.period);
    for (const name of teachersBusyForGradeSetAtSlot(
      teachers,
      info,
      cell.day,
      cell.period,
      teacherAssignments,
    )) {
      setTeacherTimes.add(`${name}|${time}`);
    }
  }
  const forbiddenTimes = new Set(
    forbiddenSlots.map(
      (f) => `${f.teacherName}|${timeKey(DAY_KEYS.indexOf(f.day), f.period)}`,
    ),
  );

  // ── 반별 격자 ──
  const grid = {} as Record<Grade, Int32Array[]>;
  for (const grade of GRADES) {
    grid[grade] = [];
    for (let classNo = 1; classNo <= classCounts[grade]; classNo++) {
      grid[grade][classNo] = new Int32Array(slots[grade].length).fill(EMPTY);
    }
  }

  const pinnedBag = new Map<string, number>();
  for (const block of pinnedSubjectBlocks) {
    const key = lessonKey(block);
    pinnedBag.set(key, (pinnedBag.get(key) ?? 0) + 1);
  }

  const setCells: TimetableCell[] = [];
  const lessons: Lesson[] = [];
  for (const cell of initial.cells) {
    const index = slotIndexOf(cell.grade, cell.day, cell.period);
    const row = grid[cell.grade]?.[cell.classNo];
    if (index < 0 || !row) continue;
    if (cell.kind === "set") {
      setCells.push(cell);
      row[index] = SET_CELL;
      continue;
    }
    const key = lessonKey(cell);
    const pinnedLeft = pinnedBag.get(key) ?? 0;
    if (pinnedLeft > 0) pinnedBag.set(key, pinnedLeft - 1);
    lessons.push({
      grade: cell.grade,
      classNo: cell.classNo,
      subjectName: cell.subjectName,
      teacherName: cell.teacherName.trim(),
      pinned: pinnedLeft > 0,
    });
    row[index] = lessons.length - 1;
  }

  // 초기 배치에서 못 놓은 수업은 그 반의 빈칸에 일단 넣고(교사 중복을 감수),
  // 교환 개선이 중복을 풀게 한다.
  const leftovers: Lesson[] = [];
  for (const u of initial.unplaced) {
    const row = grid[u.grade]?.[u.classNo];
    for (let i = 0; i < u.remaining; i++) {
      const lesson: Lesson = {
        grade: u.grade,
        classNo: u.classNo,
        subjectName: u.subjectName,
        teacherName: u.teacherName.trim(),
        pinned: false,
      };
      const holes: number[] = [];
      if (row) row.forEach((v, idx) => v === EMPTY && holes.push(idx));
      if (holes.length === 0) {
        leftovers.push(lesson);
        continue;
      }
      lessons.push(lesson);
      row![holes[Math.floor(Math.random() * holes.length)]] = lessons.length - 1;
    }
  }

  // ── 교사 점유 수 (공통 수업만; SET은 setTeacherTimes로 별도) ──
  const teacherLoad = new Map<string, Int16Array>();
  const loadOf = (name: string) => {
    let arr = teacherLoad.get(name);
    if (!arr) {
      arr = new Int16Array(DAY_KEYS.length * PERIOD_STRIDE);
      teacherLoad.set(name, arr);
    }
    return arr;
  };
  const addLoad = (lesson: Lesson, grade: Grade, index: number, delta: number) => {
    loadOf(lesson.teacherName)[slots[grade][index].time] += delta;
  };
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= classCounts[grade]; classNo++) {
      grid[grade][classNo].forEach((id, index) => {
        if (id >= 0) addLoad(lessons[id], grade, index, 1);
      });
    }
  }

  const occupied = (name: string, time: number, load: Int16Array | undefined) =>
    (load ? load[time] : 0) + (setTeacherTimes.has(`${name}|${time}`) ? 1 : 0);

  /** 교사 1명의 하루 비용: 중복·배정 불가 + 점심 연강 + 3연강. */
  const teacherDayCost = (name: string, dayIndex: number): number => {
    const load = teacherLoad.get(name);
    const base = dayIndex * PERIOD_STRIDE;
    let cost = 0;
    const busy: boolean[] = [];
    for (let period = 1; period <= MAX_PERIODS; period++) {
      const time = base + period;
      const own = load ? load[time] : 0;
      const total = occupied(name, time, load);
      if (total > 1) cost += HARD_WEIGHT * (total - 1);
      if (own > 0 && forbiddenTimes.has(`${name}|${time}`)) {
        cost += HARD_WEIGHT * own;
      }
      busy[period] = total > 0;
    }
    if (lunchWeight && busy[lunchAfterPeriod] && busy[lunchAfterPeriod + 1]) {
      cost += lunchWeight;
    }
    if (tripleWeight) {
      for (let start = 1; start + 2 <= MAX_PERIODS; start++) {
        if (!isTripleRunWindow(start, lunchAfterPeriod)) continue;
        if (busy[start] && busy[start + 1] && busy[start + 2]) {
          cost += tripleWeight;
        }
      }
    }
    return cost;
  };

  /** 반 1개의 하루 비용: 동일 교과 같은 날 중복. */
  const classDayCost = (grade: Grade, classNo: number, dayIndex: number): number => {
    if (sameDayBans.size === 0) return 0;
    const row = grid[grade][classNo];
    const seen = new Set<string>();
    let cost = 0;
    for (let index = 0; index < row.length; index++) {
      if (slots[grade][index].dayIndex !== dayIndex) continue;
      const id = row[index];
      if (id < 0) continue;
      const { subjectName } = lessons[id];
      if (!sameDayBans.has(sameDaySubjectBanKey(grade, subjectName))) continue;
      if (seen.has(subjectName)) cost += sameDayWeight;
      else seen.add(subjectName);
    }
    return cost;
  };

  const totalCost = (): number => {
    let cost = 0;
    const names = new Set(teacherLoad.keys());
    for (const key of setTeacherTimes) names.add(key.slice(0, key.lastIndexOf("|")));
    for (const name of names) {
      for (let d = 0; d < DAY_KEYS.length; d++) cost += teacherDayCost(name, d);
    }
    for (const grade of GRADES) {
      for (let classNo = 1; classNo <= classCounts[grade]; classNo++) {
        for (let d = 0; d < DAY_KEYS.length; d++) {
          cost += classDayCost(grade, classNo, d);
        }
      }
    }
    return cost;
  };

  const movable = (id: number) => id === EMPTY || (id >= 0 && !lessons[id].pinned);

  // ── 교환 개선 (담금질) ──
  const classes: [Grade, number][] = [];
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= classCounts[grade]; classNo++) {
      classes.push([grade, classNo]);
    }
  }

  let current = totalCost();
  let best = current;
  const snapshot = () =>
    classes.map(([grade, classNo]) => grid[grade][classNo].slice());
  let bestGrid = snapshot();
  let swaps = 0;

  /** 최저 상태를 현재 상태로 되돌린다 (다음 바퀴의 출발점). */
  const restoreBest = () => {
    classes.forEach(([grade, classNo], i) => {
      grid[grade][classNo] = bestGrid[i].slice();
    });
    teacherLoad.clear();
    for (const [grade, classNo] of classes) {
      grid[grade][classNo].forEach((id, index) => {
        if (id >= 0) addLoad(lessons[id], grade, index, 1);
      });
    }
    current = best;
  };

  const { deadline } = options;
  let cycleStartedAt = Date.now();
  let cycleMs = Math.max(1, Math.min(options.cycleMs, deadline - cycleStartedAt));
  let cycleStartTemp = ANNEAL_START_TEMP;
  let bestAtCycleStart = best;
  let cycles = 1;
  let temperature = cycleStartTemp;
  let stoppedEarly = false;
  /** 점수 0(선호 조건 위반 없음)에 도달해 더 할 일이 없어 끝났는지. */
  let reachedZero = false;
  options.onBest(best);

  for (let iter = 0; classes.length > 0; iter++) {
    if ((iter & 255) === 0) {
      const now = Date.now();
      if (now >= deadline) break;
      if (options.earlyStop && best === 0) {
        stoppedEarly = true;
        reachedZero = true;
        break;
      }
      if (now - cycleStartedAt >= cycleMs) {
        // 최저 상태에서 다시 데운 바퀴가 최저 점수를 한 번도 낮추지 못하면 더
        // 돌려도 나아지지 않는 것으로 본다. 첫 바퀴는 뜨겁게 시작해 초기
        // 배치보다 못할 수 있으므로 종료 판단에서 뺀다.
        if (options.earlyStop && cycles >= 2 && best >= bestAtCycleStart) {
          stoppedEarly = true;
          break;
        }
        restoreBest();
        cycleStartedAt = now;
        cycleMs = Math.max(1, Math.min(options.cycleMs, deadline - now));
        cycleStartTemp = options.reheatTemp;
        bestAtCycleStart = best;
        cycles += 1;
      }
      temperature =
        cycleStartTemp *
        Math.pow(ANNEAL_END_TEMP / cycleStartTemp, (now - cycleStartedAt) / cycleMs);
    }

    const [grade, classNo] = classes[Math.floor(Math.random() * classes.length)];
    const row = grid[grade][classNo];
    const a = Math.floor(Math.random() * row.length);
    const b = Math.floor(Math.random() * row.length);
    if (a === b) continue;
    const idA = row[a];
    const idB = row[b];
    if (idA === idB || !movable(idA) || !movable(idB)) continue;

    const dayA = slots[grade][a].dayIndex;
    const dayB = slots[grade][b].dayIndex;
    const names = new Set<string>();
    if (idA >= 0) names.add(lessons[idA].teacherName);
    if (idB >= 0) names.add(lessons[idB].teacherName);
    const days = dayA === dayB ? [dayA] : [dayA, dayB];
    const localCost = () => {
      let cost = 0;
      for (const name of names) for (const d of days) cost += teacherDayCost(name, d);
      for (const d of days) cost += classDayCost(grade, classNo, d);
      return cost;
    };
    const swap = () => {
      const x = row[a];
      const y = row[b];
      if (x >= 0) addLoad(lessons[x], grade, a, -1);
      if (y >= 0) addLoad(lessons[y], grade, b, -1);
      row[a] = y;
      row[b] = x;
      if (y >= 0) addLoad(lessons[y], grade, a, 1);
      if (x >= 0) addLoad(lessons[x], grade, b, 1);
    };

    const before = localCost();
    swap();
    const delta = localCost() - before;
    if (delta <= 0 || Math.random() < Math.exp(-delta / temperature)) {
      current += delta;
      if (delta < 0) swaps += 1;
      if (current < best) {
        best = current;
        bestGrid = snapshot();
        options.onBest(best);
      }
    } else {
      swap();
    }
  }

  // 가장 좋았던 배치로 되돌린다.
  restoreBest();

  // ── 남은 교사 중복·배정 불가는 공통 수업을 빼서 미배치로 ──
  const pulled: Lesson[] = [...leftovers];
  for (const [grade, classNo] of shuffleInPlace([...classes])) {
    const row = grid[grade][classNo];
    row.forEach((id, index) => {
      if (id < 0 || lessons[id].pinned) return;
      const lesson = lessons[id];
      const time = slots[grade][index].time;
      const load = teacherLoad.get(lesson.teacherName);
      const clash = occupied(lesson.teacherName, time, load) > 1;
      const forbidden = forbiddenTimes.has(`${lesson.teacherName}|${time}`);
      if (!clash && !forbidden) return;
      addLoad(lesson, grade, index, -1);
      row[index] = EMPTY;
      pulled.push(lesson);
    });
  }

  const commonCells: TimetableCell[] = [];
  for (const [grade, classNo] of classes) {
    grid[grade][classNo].forEach((id, index) => {
      if (id < 0) return;
      const lesson = lessons[id];
      const slot = slots[grade][index];
      commonCells.push({
        grade,
        classNo,
        day: slot.day,
        period: slot.period,
        subjectName: lesson.subjectName,
        teacherName: lesson.teacherName,
        kind: "common",
      });
    });
  }

  const unplaced = groupUnplaced(pulled, grid, slots, (name, time) =>
    occupied(name, time, teacherLoad.get(name)) > 0 ||
    forbiddenTimes.has(`${name}|${time}`),
  );
  const unplacedCount = pulled.length;
  const cells = [...setCells, ...commonCells];
  const lunchDoubles = listLunchTeacherDoubles(cells, lunchAfterPeriod);
  const tripleRuns = listTeacherTripleRuns(cells, lunchAfterPeriod);
  const sameDaySubjectViolations = listSameDaySubjectViolations(
    cells,
    preferences.sameDaySubjectBans,
  );

  const stopNote = reachedZero
    ? ", 선호 조건 위반 0건이라 더 개선할 것이 없어 종료"
    : stoppedEarly
      ? `, 담금질 ${cycles}회 반복 후 더 나아지지 않아 종료`
      : `, 담금질 ${cycles}회 반복, 시간 상한 도달`;
  const message =
    unplacedCount === 0
      ? `[v2] 공통 수업 배치를 완료했습니다. (교환 개선 ${swaps}회${stopNote})`
      : // 다시 시도할지 조건을 고칠지는 호출부가 사후 검사(explainUnplaced)로 덧붙인다.
        `[v2] 일부 공통 수업을 배치하지 못했습니다. (미배치 ${unplacedCount}교시)`;

  return {
    cells,
    unplaced,
    attemptsUsed: initial.attemptsUsed,
    status: unplacedCount === 0 ? "ready" : "failed",
    message,
    lunchDoubleCount: lunchDoubles.length,
    lunchDoubles,
    tripleRunCount: tripleRuns.length,
    tripleRuns,
    sameDaySubjectViolationCount: sameDaySubjectViolations.length,
    sameDaySubjectViolations,
  };
}

/**
 * 미배치 수업을 교사·반·교과별로 묶고, 그 반의 빈칸 중 교사가 비어 있는
 * 칸이 하나도 없으면 "impossible", 있으면 "contention"으로 표시한다.
 */
function groupUnplaced(
  pulled: Lesson[],
  grid: Record<Grade, Int32Array[]>,
  slots: Record<Grade, Slot[]>,
  teacherBusy: (name: string, time: number) => boolean,
): TimetableUnplaced[] {
  const map = new Map<string, TimetableUnplaced>();
  for (const lesson of pulled) {
    const key = `${lesson.teacherName}|${lesson.grade}|${lesson.classNo}|${lesson.subjectName}`;
    const prev = map.get(key);
    if (prev) {
      prev.remaining += 1;
      continue;
    }
    const row = grid[lesson.grade]?.[lesson.classNo];
    const hasFreeSlot =
      !!row &&
      Array.from(row).some(
        (id, index) =>
          id === EMPTY &&
          !teacherBusy(lesson.teacherName, slots[lesson.grade][index].time),
      );
    map.set(key, {
      teacherName: lesson.teacherName,
      grade: lesson.grade,
      classNo: lesson.classNo,
      subjectName: lesson.subjectName,
      remaining: 1,
      reason: hasFreeSlot ? "contention" : "impossible",
    });
  }
  return [...map.values()];
}
