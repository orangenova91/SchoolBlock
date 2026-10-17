/**
 * v3 계산 단위 (docs/v3-model-spec.md 1절의 기호를 데이터로).
 * 모델·검증기·빠른 검사·엔진이 모두 이 한 가지 구조를 읽는다.
 */
import { catalogGradeSets, findGradeSet, homeRoomsForPartialSet, setTeacherShares, teachersBusyForGradeSetAtSlot } from "@/lib/set-blocks";
import { consumeLessonsForSubjectBlocks } from "@/lib/subject-blocks";
import { expandCommonLessons } from "@/lib/timetable";
import {
  GRADES,
  WEEKDAYS,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Weekday,
} from "@/lib/types";
import { effectiveWeights, type V3Input, type V3Weights } from "@/lib/v3/input";

export const V3_DAYS = WEEKDAYS.map((d) => d.key) as Weekday[];

/** 공통 수업 묶음: (교사, 반, 과목)의 남은 시수 (선 수업으로 채운 시간은 뺌) */
export type V3Group = { teacher: string; grade: Grade; classNo: number; subject: string; hours: number };

export type V3SetSubject = {
  name: string;
  teachers: { name: string; hours: number }[];
  /** 여러 교사가 회차를 나눠 맡음 (교사별 시수 합 = SET 회차 수). 아니면 담당 교사 모두가 매 회차 바쁨 */
  rotated: boolean;
};

export type V3Set = {
  grade: Grade;
  set: ElectiveSet;
  kind: "whole" | "partial";
  units: number;
  /** 이 SET이 차지하는 반 (부분 SET의 +α는 반을 차지하지 않음) */
  rooms: number[];
  /** 반별로 그 SET 시간에 듣는 과목 (반 칸에 표시) */
  roomSubject: Record<number, string>;
  subjects: V3SetSubject[];
  /** 사용자가 칠해 고정한 회차 */
  fixed: { day: Weekday; period: number }[];
  /** 사용자가 지정한 순환 담당 (회차·과목별) */
  assigned: { day: Weekday; period: number; subject: string; teacher: string }[];
};

export type V3Pin = { teacher: string; grade: Grade; classNo: number; subject: string; day: Weekday; period: number };

export type V3Instance = {
  days: Weekday[];
  lunchAfter: number;
  periods: GradeDaySchedules;
  classCounts: GradeClassCounts;
  groups: V3Group[];
  sets: V3Set[];
  pins: V3Pin[];
  /** 배정 불가: "교사|요일|교시" */
  forbidden: Set<string>;
  /** 같은 날 중복 금지 과목: "학년|과목" */
  bans: Set<string>;
  /**
   * 고정 SET·배정 불가·다른 선 수업과 겹치는 선 수업 (입력 모순).
   * v1·v2는 이런 선 수업을 조용히 빼지만(keepNonConflictingBlocks), v3는 시간표를 정확히 완성하기 위해
   * 빼지 않고 오류로 알린다. 사용자가 데이터를 고쳐야 생성할 수 있다.
   */
  pinConflicts: (V3Pin & { reason: string })[];
  weights: V3Weights;
};

export const slotKey = (teacher: string, day: Weekday, period: number) => `${teacher}|${day}|${period}`;
export const banKey = (grade: number, subject: string) => `${grade}|${subject}`;

export function buildInstance(input: V3Input): V3Instance {
  const catalog = catalogGradeSets(input.subjects, input.classCounts);
  const fixedCells = [...input.fixedWholeCells, ...input.fixedPartialCells];

  // 선 수업 모순 찾기: 고정 SET 반·교사, 배정 불가, 앞선 선 수업과 겹치면 기록 (빼지 않음)
  const classBusy = new Map<string, string>();
  const teacherBusy = new Map<string, string>();
  for (const c of fixedCells) {
    const info = findGradeSet(catalog, c.grade, c.set);
    if (!info || info.kind === "invalid") continue;
    const rooms = info.kind === "partial" ? homeRoomsForPartialSet(info, input.classCounts[c.grade]) : Array.from({ length: input.classCounts[c.grade] }, (_, i) => i + 1);
    for (const r of rooms) classBusy.set(`${c.grade}|${r}|${c.day}|${c.period}`, `고정 ${c.grade}학년 ${c.set} SET`);
    for (const t of teachersBusyForGradeSetAtSlot(input.teachers, info, c.day, c.period, input.teacherAssignments)) teacherBusy.set(slotKey(t, c.day, c.period), `고정 ${c.grade}학년 ${c.set} SET 담당`);
  }
  for (const f of input.forbiddenSlots) if (!teacherBusy.has(slotKey(f.teacherName, f.day, f.period))) teacherBusy.set(slotKey(f.teacherName, f.day, f.period), "배정 불가");
  const pinConflicts: (V3Pin & { reason: string })[] = [];
  for (const p of input.pins) {
    const ck = `${p.grade}|${p.classNo}|${p.day}|${p.period}`, tk = slotKey(p.teacherName, p.day, p.period);
    const why = classBusy.get(ck) ?? teacherBusy.get(tk);
    if (why) pinConflicts.push({ teacher: p.teacherName, grade: p.grade, classNo: p.classNo, subject: p.subjectName, day: p.day, period: p.period, reason: why });
    classBusy.set(ck, classBusy.get(ck) ?? "선 수업");
    teacherBusy.set(tk, teacherBusy.get(tk) ?? "선 수업");
  }

  const lessons = expandCommonLessons(input.teachers, input.subjects, input.classCounts);
  const { remaining } = consumeLessonsForSubjectBlocks(lessons, input.pins);
  const groupMap = new Map<string, V3Group>();
  for (const l of remaining) {
    const k = `${l.teacherName}|${l.grade}|${l.classNo}|${l.subjectName}`;
    const g = groupMap.get(k);
    if (g) g.hours++;
    else groupMap.set(k, { teacher: l.teacherName, grade: l.grade, classNo: l.classNo, subject: l.subjectName, hours: 1 });
  }

  const sets: V3Set[] = [];
  for (const info of catalog) {
    if (info.kind === "invalid" || !info.units) continue;
    const rooms = info.kind === "partial"
      ? homeRoomsForPartialSet(info, input.classCounts[info.grade])
      : Array.from({ length: input.classCounts[info.grade] }, (_, i) => i + 1);
    const shares = setTeacherShares(input.teachers, info);
    const names = [...new Set(shares.map((s) => s.subjectName))];
    const units = info.units;
    const subjects = names.map((name) => {
      const ts = shares.filter((s) => s.subjectName === name).map((s) => ({ name: s.teacherName, hours: s.hours }));
      return { name, teachers: ts, rotated: ts.length > 1 && ts.reduce((a, t) => a + t.hours, 0) === units };
    });
    const mine = (c: { grade: number; set: string }) => c.grade === info.grade && c.set === info.set;
    sets.push({
      grade: info.grade,
      set: info.set,
      kind: info.kind,
      units,
      rooms,
      roomSubject: Object.fromEntries(rooms.map((r) => [r, info.subjects.find((x) => x.classNo === r)?.name ?? `SET ${info.set}`])),
      subjects,
      fixed: fixedCells.filter(mine).map((c) => ({ day: c.day, period: c.period })),
      assigned: input.teacherAssignments.filter(mine).map((a) => ({ day: a.day, period: a.period, subject: a.subjectName, teacher: a.teacherName })),
    });
  }

  const banOn = input.preferences.avoidSameDaySubject;
  return {
    days: V3_DAYS,
    lunchAfter: input.preferences.lunchAfterPeriod,
    periods: input.schedules,
    classCounts: input.classCounts,
    groups: [...groupMap.values()],
    sets,
    pins: input.pins.map((p) => ({ teacher: p.teacherName, grade: p.grade, classNo: p.classNo, subject: p.subjectName, day: p.day, period: p.period })),
    forbidden: new Set(input.forbiddenSlots.map((f) => slotKey(f.teacherName, f.day, f.period))),
    bans: new Set(banOn ? input.preferences.sameDaySubjectBans.map((b) => banKey(b.grade, b.subjectName)) : []),
    weights: effectiveWeights(input),
    pinConflicts,
  };
}

/** 학년 g의 (요일, 교시) 칸 목록 */
export function gradeSlots(inst: V3Instance, grade: Grade): { day: Weekday; period: number }[] {
  const out: { day: Weekday; period: number }[] = [];
  for (const day of inst.days) for (let period = 1; period <= (inst.periods[grade][day] ?? 0); period++) out.push({ day, period });
  return out;
}

/**
 * H12 같은 SET 요일 배분: 층 높이 L(Σ_d max(F_d, L) ≥ u 인 최소 정수)에 대해
 * 요일별 회차 수는 max(F_d, L−1) 이상 max(F_d, L) 이하.
 */
export function setDayBounds(inst: V3Instance, s: V3Set): Map<Weekday, { lo: number; hi: number }> {
  const days = inst.days.filter((d) => (inst.periods[s.grade][d] ?? 0) > 0);
  const F = new Map(days.map((d) => [d, s.fixed.filter((f) => f.day === d).length]));
  let L = 0;
  while (days.reduce((a, d) => a + Math.max(F.get(d)!, L), 0) < s.units) L++;
  return new Map(days.map((d) => [d, { lo: Math.max(F.get(d)!, L - 1), hi: Math.max(F.get(d)!, L) }]));
}

export { GRADES };
