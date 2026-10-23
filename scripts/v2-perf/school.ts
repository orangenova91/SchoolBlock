/**
 * v2 성능 측정용 학교 데이터 생성기.
 *
 * 2022 개정 교육과정(2025~ 고교학점제) 일반고 편제를 단순화한 틀을 쓴다.
 * - 주당 수업 32시간 (월·화 7교시, 수~금 6교시)
 * - 1학년: 공통과목 (통합사회·통합과학·과학탐구실험·국영수·한국사 등)
 * - 2·3학년: 학교 지정 과목 + 선택과목 묶음(SET). 학년이 오를수록 선택 비중↑
 *   (2026학년도 입학생 편제 예: 2학년 지정 11학점·선택 18학점/학기,
 *    3학년 개별 선택 27학점 – 지역내일 2026.10.07 안산 일반고 편제 비교)
 * 교사는 교과(부서)별로 평균 시수 목표(`avgLoad`)에 맞춰 수를 정하고, 수업을
 * 가장 적게 맡은 교사부터 나눠 준다 (교사 1명 상한 `MAX_LOAD`).
 */
import {
  autoPlacePartialSets,
  autoPlaceWholeSets,
} from "@/lib/set-blocks-auto";
import {
  catalogGradeSets,
  homeRoomsForPartialSet,
  teachersForGradeSet,
} from "@/lib/set-blocks";
import type { FeasibilityInput } from "@/lib/timetable-feasibility";
import {
  GRADES,
  WEEKDAYS,
  type ElectiveSet,
  type GenerationPreferences,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type Subject,
  type SubjectBlockCell,
  type Teacher,
  type TeacherForbiddenSlot,
  type Weekday,
} from "@/lib/types";

export const MAX_LOAD = 22;
const DAYS = WEEKDAYS.map((d) => d.key) as Weekday[];
const BASE_PERIODS: Record<Weekday, number> = { mon: 7, tue: 7, wed: 6, thu: 6, fri: 6 };
const LUNCH_AFTER = 4;

export type SetProfile = "none" | "low" | "base" | "high";
export type SetPlacement =
  | "auto"
  | "spread"
  | "lunch"
  | "avoidLunch"
  | "concentrated"
  /** 무작위 (교사·반 겹침과 같은 날 중복만 피함) */
  | "random"
  /** 요일마다 교시가 한 칸씩 밀리는 대각선 순환 (실제 학교 예시와 유사) */
  | "diagonal";
export type ForbiddenRule =
  | { kind: "random"; rate: number }
  /** 교사 비율 share가 요일 하나를 통째로 못 들어옴 (시간강사·겸임 등) */
  | { kind: "dayOff"; share: number }
  /** 교사 비율 share가 이틀은 오전(1~4교시)만 가능 */
  | { kind: "halfDay"; share: number };

export type SchoolSpec = {
  id: string;
  label: string;
  axis: string;
  seed: number;
  classesPerGrade: [number, number, number];
  avgLoad: number;
  setProfile: SetProfile;
  /** 2학년 SET 하나를 반씩 나눈 부분 SET 두 개로 바꾼다. */
  partialSet?: boolean;
  setPlacement: SetPlacement;
  /** 반마다 남는 빈 칸 수 (교시를 늘린다). */
  slack?: number;
  /**
   * 학년별 요일 교시를 직접 지정한다 (예: 실제 시간표의 1단계 설정).
   * 이때 학년 수업 시수를 그 교시 수에 맞춰 공통 과목 시수로 조정한다.
   */
  schedules?: GradeDaySchedules;
  forbidden?: ForbiddenRule[];
  /** 공통 수업 중 선 수업으로 고정할 비율. */
  pinRate?: number;
  /** 동일 교과 같은 날 금지 대상. */
  bans?: "none" | "core" | "all";
};

export type BuiltSchool = {
  input: FeasibilityInput;
  preferences: GenerationPreferences;
  meta: {
    classes: number;
    teachers: number;
    loadMin: number;
    loadAvg: number;
    loadMax: number;
    commonLessons: number;
    setShare: number[];
    setCells: number;
    forbidden: number;
    pins: number;
    bans: number;
    setPlaced: boolean;
  };
};

// ── 난수 (시드 고정) ──
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 교육과정 틀 ──
type Course = { name: string; hours: number; dept: string };
const c = (name: string, hours: number, dept: string): Course => ({ name, hours, dept });

const GRADE1: Course[] = [
  c("공통국어", 4, "국어"), c("공통수학", 4, "수학"), c("공통영어", 4, "영어"),
  c("한국사", 3, "사회"), c("통합사회", 3, "사회"), c("통합과학", 3, "과학"),
  c("과학탐구실험", 2, "과학"), c("체육", 2, "체육"), c("예술", 2, "예술"),
  c("정보", 2, "정보"), c("창체", 3, "담임"),
]; // 32

const COMMONS: Record<2 | 3, Record<SetProfile, Course[]>> = {
  2: {
    none: [c("문학", 4, "국어"), c("대수", 4, "수학"), c("영어I", 4, "영어"), c("체육2", 2, "체육"), c("기술가정", 3, "정보"), c("창체", 3, "담임"), c("물리학", 4, "과학"), c("화학", 4, "과학"), c("생명과학", 4, "과학")],
    low: [c("문학", 4, "국어"), c("대수", 4, "수학"), c("영어I", 4, "영어"), c("체육2", 2, "체육"), c("기술가정", 3, "정보"), c("창체", 3, "담임"), c("미적분I", 3, "수학"), c("독서", 3, "국어")],
    base: [c("문학", 4, "국어"), c("대수", 4, "수학"), c("영어I", 4, "영어"), c("체육2", 2, "체육"), c("기술가정", 3, "정보"), c("창체", 3, "담임")],
    high: [c("문학", 4, "국어"), c("대수", 4, "수학"), c("영어I", 3, "영어"), c("체육2", 2, "체육"), c("창체", 3, "담임")],
  },
  3: {
    none: [c("국어3", 4, "국어"), c("수학3", 4, "수학"), c("영어3", 4, "영어"), c("체육3", 2, "체육"), c("창체", 3, "담임"), c("교양", 3, "담임"), c("지구과학", 4, "과학"), c("경제", 4, "사회"), c("윤리", 4, "사회")],
    low: [c("국어3", 4, "국어"), c("수학3", 4, "수학"), c("영어3", 4, "영어"), c("체육3", 2, "체육"), c("창체", 3, "담임"), c("교양", 3, "담임")],
    base: [c("국어3", 3, "국어"), c("영어3", 3, "영어"), c("체육3", 2, "체육"), c("창체", 3, "담임"), c("교양", 1, "담임")],
    high: [c("국어3", 3, "국어"), c("체육3", 2, "체육"), c("창체", 3, "담임")],
  },
};

/** 학년별 SET 수 × 시수 (공통과 합쳐 32시간). */
const SET_LAYOUT: Record<2 | 3, Record<SetProfile, { count: number; units: number }>> = {
  2: { none: { count: 0, units: 0 }, low: { count: 2, units: 3 }, base: { count: 3, units: 4 }, high: { count: 4, units: 4 } },
  3: { none: { count: 0, units: 0 }, low: { count: 3, units: 4 }, base: { count: 5, units: 4 }, high: { count: 6, units: 4 } },
};

/** SET마다 개설 과목 후보 (분반 수만큼 돌아가며 쓴다). */
const SET_POOLS: Course[][] = [
  [c("물리학", 0, "과학"), c("화학", 0, "과학"), c("생명과학", 0, "과학"), c("지구과학", 0, "과학")],
  [c("경제", 0, "사회"), c("정치", 0, "사회"), c("윤리와사상", 0, "사회"), c("세계지리", 0, "사회")],
  [c("미적분II", 0, "수학"), c("확률과통계", 0, "수학"), c("영어II", 0, "영어"), c("주제탐구독서", 0, "국어")],
  [c("역학과에너지", 0, "과학"), c("물질과에너지", 0, "과학"), c("사회와문화", 0, "사회"), c("세계사", 0, "사회")],
  [c("영미문학읽기", 0, "영어"), c("기하", 0, "수학"), c("문학과영상", 0, "국어"), c("심화영어", 0, "영어")],
  [c("일본어", 0, "제2외국어"), c("중국어", 0, "제2외국어"), c("음악연주", 0, "예술"), c("미술창작", 0, "예술")],
];

const SET_LETTERS: ElectiveSet[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

type WorkUnit = {
  grade: Grade;
  dept: string;
  subject: string;
  hours: number;
  /** 공통: 반 번호(1부터). SET: undefined */
  classNo?: number;
  /** SET 분반이면 같은 SET 안에서 교사가 겹치지 않도록 묶음 키. */
  setKey?: string;
};

export function buildSchool(spec: SchoolSpec): BuiltSchool {
  const rand = rng(spec.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T,>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const classCounts: GradeClassCounts = {
    1: spec.classesPerGrade[0],
    2: spec.classesPerGrade[1],
    3: spec.classesPerGrade[2],
  };
  const periods = { ...BASE_PERIODS };
  for (let extra = spec.slack ?? 0, i = 0; extra > 0; extra--, i++) {
    periods[DAYS[(i + 2) % 5]] += 1; // 수·목·금부터 1교시씩
  }
  const schedules: GradeDaySchedules = spec.schedules
    ? { 1: { ...spec.schedules[1] }, 2: { ...spec.schedules[2] }, 3: { ...spec.schedules[3] } }
    : { 1: { ...periods }, 2: { ...periods }, 3: { ...periods } };
  if (spec.schedules) {
    for (const day of DAYS) periods[day] = Math.max(...GRADES.map((g) => schedules[g][day]));
  }

  // ── 과목과 수업 단위 ──
  const subjects: GradeSubjects = { 1: [], 2: [], 3: [] };
  const units: WorkUnit[] = [];
  const setShare: number[] = [0, 0, 0];
  const commonsBase = (g: Grade): Course[] => (g === 1 ? GRADE1 : COMMONS[g][spec.setProfile]);
  const weekly = (g: Grade) => DAYS.reduce((sum, d) => sum + schedules[g][d], 0);
  const setHoursOf = (g: Grade) => (g === 1 ? 0 : SET_LAYOUT[g][spec.setProfile].count * SET_LAYOUT[g][spec.setProfile].units);
  /** 학년 주당 교시에 맞춰 공통 과목 시수를 늘리거나 줄인다. */
  const fitted = new Map<Grade, Course[]>();
  for (const g of GRADES) {
    const courses = commonsBase(g).map((x) => ({ ...x }));
    let diff = weekly(g) - setHoursOf(g) - courses.reduce((sum, x) => sum + x.hours, 0);
    // 늘릴 때: 국·수·영 → 교양 순, 줄일 때: 창체(최소 1) → 교양·정보·예술 순
    const growOrder = ["국어", "수학", "영어", "담임"];
    const shrinkOrder = ["창체", "교양", "정보", "예술", "기술가정"];
    for (let guard = 0; diff !== 0 && guard < 100; guard++) {
      if (diff > 0) {
        const target = courses.find((x) => x.dept === growOrder[guard % growOrder.length]) ?? courses[0];
        target.hours += 1;
        diff -= 1;
      } else {
        const target = shrinkOrder
          .map((name) => courses.find((x) => (x.name === name || x.name.startsWith(name)) && x.hours > 1))
          .find(Boolean);
        if (!target) break;
        target.hours -= 1;
        diff += 1;
      }
    }
    fitted.set(g, courses);
  }
  const commonsOf = (g: Grade): Course[] => fitted.get(g)!;

  for (const g of GRADES) {
    const n = classCounts[g];
    for (const course of commonsOf(g)) {
      subjects[g].push({ set: "공통", name: course.name, units: course.hours, classCount: n });
      for (let k = 1; k <= n; k++) {
        units.push({ grade: g, dept: course.dept, subject: course.name, hours: course.hours, classNo: k });
      }
    }
    if (g === 1) continue;
    const layout = SET_LAYOUT[g][spec.setProfile];
    setShare[g - 1] = (layout.count * layout.units) / 32;
    const sets: { letter: ElectiveSet; rooms: number[]; pool: Course[] }[] = [];
    let letter = 0;
    for (let s = 0; s < layout.count; s++) {
      const pool = SET_POOLS[(s + (g === 3 ? 2 : 0)) % SET_POOLS.length];
      const allRooms = Array.from({ length: n }, (_, i) => i + 1);
      if (spec.partialSet && g === 2 && s === layout.count - 1 && n >= 2) {
        const half = Math.floor(n / 2);
        sets.push({ letter: SET_LETTERS[letter++], rooms: allRooms.slice(0, half), pool });
        sets.push({ letter: SET_LETTERS[letter++], rooms: allRooms.slice(half), pool });
      } else {
        sets.push({ letter: SET_LETTERS[letter++], rooms: allRooms, pool });
      }
    }
    for (const set of sets) {
      const used = new Map<string, number>();
      set.rooms.forEach((room, i) => {
        const course = set.pool[i % set.pool.length];
        const count = (used.get(course.name) ?? 0) + 1;
        used.set(course.name, count);
        const name = `${set.letter}${course.name}${count > 1 ? count : ""}`;
        const subject: Subject = { set: set.letter, name, units: layout.units, classCount: 1, classNo: room };
        subjects[g].push(subject);
        units.push({ grade: g, dept: course.dept, subject: name, hours: layout.units, setKey: `${g}${set.letter}` });
      });
    }
  }

  // ── 교사 배정: 교과별 교사 수 = 시수 합 / 평균 목표, 적게 맡은 교사부터 ──
  type T = { name: string; dept: string; load: number; sets: Set<string>; items: Map<string, { grade: Grade; subject: string; classHours: number[]; isSet: boolean }> };
  const teachers: T[] = [];
  const byDept = new Map<string, WorkUnit[]>();
  for (const u of units) {
    if (u.dept === "담임") continue;
    (byDept.get(u.dept) ?? byDept.set(u.dept, []).get(u.dept)!).push(u);
  }
  let counter = 0;
  const newTeacher = (dept: string): T => {
    const t: T = { name: `${dept}${String(++counter).padStart(2, "0")}`, dept, load: 0, sets: new Set(), items: new Map() };
    teachers.push(t);
    return t;
  };
  const give = (t: T, u: WorkUnit) => {
    t.load += u.hours;
    if (u.setKey) t.sets.add(u.setKey);
    const key = `${u.grade}|${u.subject}`;
    let item = t.items.get(key);
    if (!item) {
      item = { grade: u.grade, subject: u.subject, classHours: u.setKey ? [0] : Array(classCounts[u.grade]).fill(0), isSet: Boolean(u.setKey) };
      t.items.set(key, item);
    }
    if (u.setKey) item.classHours[0] += u.hours;
    else item.classHours[(u.classNo ?? 1) - 1] += u.hours;
  };
  const deptTotals = [...byDept.entries()].map(([dept, list]) => [dept, list.reduce((s, u) => s + u.hours, 0)] as const);
  const flexHours = units.filter((u) => u.dept === "담임").reduce((s, u) => s + u.hours, 0);
  const totalHours = units.reduce((s, u) => s + u.hours, 0);
  const totalTeachers = Math.max(deptTotals.length, Math.round(totalHours / spec.avgLoad));
  // 담임 몫(창체·교양)을 교과 시수 비율로 나눠 교과별 교사 수를 정한다.
  for (const [dept, hours] of deptTotals) {
    const share = Math.max(1, Math.round((totalTeachers * hours) / (totalHours - flexHours)));
    for (let i = 0; i < share; i++) newTeacher(dept);
  }
  for (const [dept, list] of byDept) {
    // 같은 과목·반 묶음이 흩어지지 않도록 큰 단위부터
    for (const u of shuffle(list).sort((a, b) => b.hours - a.hours)) {
      const candidates = teachers
        .filter((t) => t.dept === dept && !(u.setKey && t.sets.has(u.setKey)) && t.load + u.hours <= MAX_LOAD)
        .sort((a, b) => a.load - b.load);
      give(candidates[0] ?? newTeacher(dept), u);
    }
  }
  for (const u of shuffle(units.filter((x) => x.dept === "담임"))) {
    const t = [...teachers].filter((x) => x.load + u.hours <= MAX_LOAD).sort((a, b) => a.load - b.load)[0] ?? newTeacher("교양");
    give(t, u);
  }

  // 수업을 하나도 못 받은 교사는 뺀다 (교과별 교사 수 반올림 여유분).
  for (let i = teachers.length - 1; i >= 0; i--) if (teachers[i].load === 0) teachers.splice(i, 1);

  const appTeachers: Teacher[] = teachers.map((t) => {
    const assignments = { 1: [], 2: [], 3: [] } as Teacher["assignments"];
    for (const item of t.items.values()) {
      assignments[item.grade].push({ name: item.subject, classHours: item.classHours, hours: item.classHours.reduce((a, b) => a + b, 0) });
    }
    return { name: t.name, assignments };
  });

  // ── SET 배치 ──
  const catalog = catalogGradeSets(subjects, classCounts);
  let wholeCells: SetBlockCell[] = [];
  let partialCells: SetBlockCell[] = [];
  let setPlaced = true;
  if (catalog.length > 0) {
    if (spec.setPlacement === "auto") {
      const whole = autoPlaceWholeSets({ cells: [], partialCells: [], catalog, teachers: appTeachers, schedules, classCounts, lunchAfterPeriod: LUNCH_AFTER });
      wholeCells = whole.cells;
      const partial = autoPlacePartialSets({ wholeCells, partialCells: [], catalog, teachers: appTeachers, schedules, classCounts, lunchAfterPeriod: LUNCH_AFTER });
      partialCells = partial.cells;
      setPlaced = whole.unplaced.length === 0 && partial.unplaced.length === 0;
    } else {
      const placed = placeSetsByStrategy(spec.setPlacement, catalog, appTeachers, schedules, classCounts, rand);
      wholeCells = placed.whole;
      partialCells = placed.partial;
      setPlaced = placed.ok;
    }
  }

  // ── 고정 점유 (배정 불가·선 수업 생성용) ──
  const teacherSetBusy = new Set<string>();
  const classBusy = new Set<string>();
  for (const cell of [...wholeCells, ...partialCells]) {
    const info = catalog.find((x) => x.grade === cell.grade && x.set === cell.set)!;
    for (const name of teachersForGradeSet(appTeachers, info)) teacherSetBusy.add(`${name}|${cell.day}|${cell.period}`);
    const rooms = info.kind === "partial" ? homeRoomsForPartialSet(info, classCounts[cell.grade]) : Array.from({ length: classCounts[cell.grade] }, (_, i) => i + 1);
    for (const r of rooms) classBusy.add(`${cell.grade}|${r}|${cell.day}|${cell.period}`);
  }
  const times: { day: Weekday; period: number }[] = [];
  for (const day of DAYS) for (let p = 1; p <= periods[day]; p++) times.push({ day, period: p });

  // ── 배정 불가 ──
  const forbiddenSlots: TeacherForbiddenSlot[] = [];
  const teacherBusy = new Set(teacherSetBusy);
  const loadOf = new Map(teachers.map((t) => [t.name, t.load]));
  const addForbidden = (name: string, day: Weekday, period: number) => {
    const key = `${name}|${day}|${period}`;
    if (teacherBusy.has(key)) return;
    teacherBusy.add(key);
    forbiddenSlots.push({ teacherName: name, day, period });
  };
  const freeCount = (name: string) => times.filter((s) => !teacherBusy.has(`${name}|${s.day}|${s.period}`)).length;
  for (const rule of spec.forbidden ?? []) {
    for (const t of shuffle(teachers)) {
      const keep = (loadOf.get(t.name) ?? 0) + 4; // 최소 여유 4칸은 남긴다
      if (rule.kind === "random") {
        let budget = Math.min(Math.round(freeCount(t.name) * rule.rate), freeCount(t.name) - keep);
        for (const s of shuffle(times)) {
          if (budget <= 0) break;
          if (teacherBusy.has(`${t.name}|${s.day}|${s.period}`)) continue;
          addForbidden(t.name, s.day, s.period);
          budget--;
        }
      } else if (rand() < rule.share) {
        const days = rule.kind === "dayOff" ? [pick(DAYS)] : shuffle(DAYS).slice(0, 2);
        const slots = times.filter((s) => days.includes(s.day) && (rule.kind === "dayOff" || s.period > LUNCH_AFTER));
        const free = slots.filter((s) => !teacherBusy.has(`${t.name}|${s.day}|${s.period}`));
        if (freeCount(t.name) - free.length >= keep) for (const s of free) addForbidden(t.name, s.day, s.period);
      }
    }
  }

  // ── 선 수업 ──
  const subjectBlocks: SubjectBlockCell[] = [];
  if (spec.pinRate) {
    const lessons: { teacher: string; grade: Grade; classNo: number; subject: string }[] = [];
    for (const t of appTeachers) for (const g of GRADES) for (const item of t.assignments[g]) {
      const subj = subjects[g].find((s) => s.name === item.name);
      if (!subj || subj.set !== "공통") continue;
      item.classHours.forEach((h, i) => { for (let k = 0; k < h; k++) lessons.push({ teacher: t.name, grade: g, classNo: i + 1, subject: item.name }); });
    }
    for (const l of shuffle(lessons)) {
      if (rand() >= spec.pinRate) continue;
      const options = times.filter((s) => s.period <= schedules[l.grade][s.day] && !classBusy.has(`${l.grade}|${l.classNo}|${s.day}|${s.period}`) && !teacherBusy.has(`${l.teacher}|${s.day}|${s.period}`));
      if (options.length === 0) continue;
      const s = pick(options);
      subjectBlocks.push({ grade: l.grade, classNo: l.classNo, subjectName: l.subject, teacherName: l.teacher, day: s.day, period: s.period });
      classBusy.add(`${l.grade}|${l.classNo}|${s.day}|${s.period}`);
      teacherBusy.add(`${l.teacher}|${s.day}|${s.period}`);
    }
  }

  // ── 동일 교과 금지 ──
  const bans: { grade: Grade; subjectName: string }[] = [];
  const core = new Set(["공통국어", "공통수학", "공통영어", "문학", "대수", "영어I", "국어3", "수학3", "영어3"]);
  for (const g of GRADES) {
    for (const course of commonsOf(g)) {
      if (spec.bans === "core" && core.has(course.name)) bans.push({ grade: g, subjectName: course.name });
      if (spec.bans === "all" && course.hours >= 2 && course.dept !== "담임") bans.push({ grade: g, subjectName: course.name });
    }
  }

  const loads = teachers.map((t) => t.load);
  return {
    input: { teachers: appTeachers, subjects, classCounts, schedules, wholeCells, partialCells, teacherAssignments: [], subjectBlocks, forbiddenSlots },
    preferences: {
      avoidLunchDouble: true,
      lunchAfterPeriod: LUNCH_AFTER,
      avoidTriplePeriod: true,
      avoidSameDaySubject: bans.length > 0,
      sameDaySubjectBans: bans,
    },
    meta: {
      classes: classCounts[1] + classCounts[2] + classCounts[3],
      teachers: teachers.length,
      loadMin: Math.min(...loads),
      loadAvg: Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 10) / 10,
      loadMax: Math.max(...loads),
      commonLessons: units.filter((u) => !u.setKey).reduce((s, u) => s + u.hours, 0),
      setShare: setShare.map((x) => Math.round(x * 100)),
      setCells: wholeCells.length + partialCells.length,
      forbidden: forbiddenSlots.length,
      pins: subjectBlocks.length,
      bans: bans.length,
      setPlaced,
    },
  };
}

/** 전략별 SET 배치 (무작위 탐욕 + 재시도). 교사 겹침·반 겹침은 항상 피한다. */
export function placeSetsByStrategy(
  strategy: Exclude<SetPlacement, "auto">,
  catalog: ReturnType<typeof catalogGradeSets>,
  teachers: Teacher[],
  schedules: GradeDaySchedules,
  classCounts: GradeClassCounts,
  rand: () => number,
): { whole: SetBlockCell[]; partial: SetBlockCell[]; ok: boolean } {
  const tasks = catalog
    .filter((x) => x.kind !== "invalid" && x.units)
    .sort((a, b) => b.grade - a.grade || (a.kind === "whole" ? -1 : 1));
  const info = tasks.map((x) => ({
    item: x,
    teachers: teachersForGradeSet(teachers, x),
    rooms: x.kind === "partial" ? homeRoomsForPartialSet(x, classCounts[x.grade]) : Array.from({ length: classCounts[x.grade] }, (_, i) => i + 1),
  }));

  for (let attempt = 0; attempt < 400; attempt++) {
    const whole: SetBlockCell[] = [];
    const partial: SetBlockCell[] = [];
    const teacherBusy = new Set<string>();
    const roomBusy = new Set<string>();
    const gradeDayCount = new Map<string, number>();
    let ok = true;
    const setIndex = new Map<string, number>();
    for (const { item, teachers: names, rooms } of info) {
      const usedDays = new Set<Weekday>();
      const indexInGrade = setIndex.get(`${item.grade}`) ?? 0;
      setIndex.set(`${item.grade}`, indexInGrade + 1);
      for (let k = 0; k < (item.units ?? 0); k++) {
        const options: { day: Weekday; period: number; score: number }[] = [];
        for (const day of DAYS) {
          for (let period = 1; period <= schedules[item.grade][day]; period++) {
            if (rooms.some((r) => roomBusy.has(`${item.grade}|${r}|${day}|${period}`))) continue;
            if (names.some((t) => teacherBusy.has(`${t}|${day}|${period}`))) continue;
            const sameDay = usedDays.has(day) ? 100 : 0;
            const dayLoad = gradeDayCount.get(`${item.grade}|${day}`) ?? 0;
            const lunch = period === LUNCH_AFTER || period === LUNCH_AFTER + 1;
            let score = sameDay + rand() * 2;
            if (strategy === "spread") score += dayLoad * 3;
            if (strategy === "lunch") score += lunch ? -6 : 0;
            if (strategy === "avoidLunch") score += lunch ? 6 : 0;
            if (strategy === "concentrated") score += -dayLoad * 3 + period * 0.5;
            if (strategy === "random") score += rand() * 20;
            if (strategy === "diagonal") {
              // SET마다 시작 요일을 하루씩 밀고, 회차마다 요일·교시를 한 칸씩 민다.
              const prefDay = (indexInGrade + k) % DAYS.length;
              const prefPeriod = 2 + (k % 3);
              score += (DAYS.indexOf(day) === prefDay ? 0 : 4) + Math.abs(period - prefPeriod) * 2;
            }
            options.push({ day, period, score });
          }
        }
        if (options.length === 0) { ok = false; break; }
        options.sort((a, b) => a.score - b.score);
        const slot = options[0];
        usedDays.add(slot.day);
        gradeDayCount.set(`${item.grade}|${slot.day}`, (gradeDayCount.get(`${item.grade}|${slot.day}`) ?? 0) + 1);
        for (const r of rooms) roomBusy.add(`${item.grade}|${r}|${slot.day}|${slot.period}`);
        for (const t of names) teacherBusy.add(`${t}|${slot.day}|${slot.period}`);
        const cell = { grade: item.grade, set: item.set, day: slot.day, period: slot.period };
        (item.kind === "partial" ? partial : whole).push(cell);
      }
      if (!ok) break;
    }
    if (ok) return { whole, partial, ok: true };
  }
  return { whole: [], partial: [], ok: false };
}
