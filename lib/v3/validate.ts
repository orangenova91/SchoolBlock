/**
 * v3 검증기 (docs/v3-model-spec.md 3·4절을 그대로 계산).
 * 모든 생성 결과는 저장 전에 이 검사를 통과해야 한다.
 *
 * SET 회차의 담당 교사는 과목별로 따로 센다. 한 교사가 같은 회차의 두 과목을
 * 맡으면(순환 추천에서 생길 수 있음) 교사 겹침(H3)이다.
 */
import { isTripleRunWindow } from "@/lib/generation-preferences";
import { catalogGradeSets, findGradeSet, resolveSubjectTeachersAtSlot } from "@/lib/set-blocks";
import { expandCommonLessons } from "@/lib/timetable";
import type { ElectiveSet, Grade, TimetableCell, Weekday } from "@/lib/types";
import type { V3Input } from "@/lib/v3/input";
import { banKey, setDayBounds, slotKey, type V3Instance } from "@/lib/v3/instance";
import { scoreOf, type V3Metrics } from "@/lib/v3/score";

/** SET 한 회차: 시간과 과목별 담당 교사 (+α 과목 포함) */
export type V3Occurrence = {
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
  bySubject: Record<string, string[]>;
};

/** 시간표 한 벌: 반별 칸(공통 수업·선 수업·SET 칸) + SET 회차 */
export type V3Solution = { cells: TimetableCell[]; occurrences: V3Occurrence[] };

export type V3ViolationCode = "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7" | "H8" | "H10" | "H12" | "CELL";

export type V3Violation = { code: V3ViolationCode; message: string };

export type V3Validation = {
  ok: boolean;
  violations: V3Violation[];
  /** 배치되지 않은 공통 수업 시간 수 (H1 부족분) */
  unplaced: number;
  metrics: V3Metrics;
};

const occKey = (grade: number, set: string, day: string, period: number) => `${grade}|${set}|${day}|${period}`;

export function validateSolution(input: V3Input, inst: V3Instance, sol: V3Solution): V3Validation {
  const v: V3Violation[] = [];
  const add = (code: V3ViolationCode, message: string) => v.push({ code, message });
  const commons = sol.cells.filter((c) => c.kind !== "set");
  const setCells = sol.cells.filter((c) => c.kind === "set");

  // H1 시수
  const need = new Map<string, number>();
  for (const l of expandCommonLessons(input.teachers, input.subjects, input.classCounts)) {
    const k = `${l.teacherName}|${l.grade}|${l.classNo}|${l.subjectName}`;
    need.set(k, (need.get(k) ?? 0) + 1);
  }
  const have = new Map<string, number>();
  for (const c of commons) {
    const k = `${c.teacherName}|${c.grade}|${c.classNo}|${c.subjectName}`;
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  let unplaced = 0;
  for (const [k, n] of need) {
    const h = have.get(k) ?? 0;
    if (h < n) unplaced += n - h;
    if (h > n) add("H1", `${k} 수업이 ${h - n}시간 많음`);
  }
  for (const [k, h] of have) if (!need.has(k)) add("H1", `${k} 수업은 배정에 없음 (${h}시간)`);

  // H2 반 한 칸 한 수업
  const byClassSlot = new Map<string, number>();
  for (const c of sol.cells) {
    const k = `${c.grade}|${c.classNo}|${c.day}|${c.period}`;
    byClassSlot.set(k, (byClassSlot.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byClassSlot) if (n > 1) add("H2", `${k} 칸에 수업 ${n}개`);
  for (const c of sol.cells) {
    if (c.period < 1 || c.period > (inst.periods[c.grade][c.day] ?? 0)) add("CELL", `${c.grade}-${c.classNo} ${c.day} ${c.period}교시는 수업 시간이 아님`);
  }

  // SET 회차와 SET 칸이 서로 맞는지
  const setOf = new Map(inst.sets.map((s) => [`${s.grade}|${s.set}`, s]));
  const occByKey = new Map<string, V3Occurrence>();
  for (const o of sol.occurrences) {
    const k = occKey(o.grade, o.set, o.day, o.period);
    if (occByKey.has(k)) add("H6", `${o.grade}학년 ${o.set} SET이 ${o.day} ${o.period}교시에 두 번`);
    occByKey.set(k, o);
    const s = setOf.get(`${o.grade}|${o.set}`);
    if (!s) { add("H6", `${o.grade}학년 ${o.set} SET은 교과 설정에 없음`); continue; }
    for (const room of s.rooms) {
      const cell = setCells.find((c) => c.grade === o.grade && c.classNo === room && c.day === o.day && c.period === o.period && c.set === o.set);
      if (!cell) add("CELL", `${o.grade}학년 ${room}반 ${o.day} ${o.period}교시에 ${o.set} SET 칸이 없음`);
    }
  }
  for (const c of setCells) {
    if (!occByKey.has(occKey(c.grade, c.set ?? "", c.day, c.period))) add("CELL", `${c.grade}-${c.classNo} ${c.day} ${c.period}교시 SET 칸에 해당 회차가 없음`);
  }

  // 교사 점유 (공통 수업 + SET 회차 과목별 담당). 이름 중복을 지우지 않는다.
  const busy = new Map<string, number>();
  const mark = (t: string, day: Weekday, period: number) => { const k = slotKey(t, day, period); busy.set(k, (busy.get(k) ?? 0) + 1); };
  for (const c of commons) mark(c.teacherName, c.day, c.period);
  for (const o of sol.occurrences) for (const ts of Object.values(o.bySubject)) for (const t of ts) mark(t, o.day, o.period);
  // H3, H4
  for (const [k, n] of busy) {
    if (n > 1) add("H3", `${k.replaceAll("|", " ")}: 수업 ${n}개가 겹침`);
    if (inst.forbidden.has(k)) add("H4", `${k.replaceAll("|", " ")}: 배정 불가 시간에 수업`);
  }

  // H5 선 수업 유지
  for (const p of inst.pins) {
    const ok = commons.some((c) => c.grade === p.grade && c.classNo === p.classNo && c.day === p.day && c.period === p.period && c.subjectName === p.subject && c.teacherName === p.teacher);
    if (!ok) add("H5", `선 수업 ${p.grade}-${p.classNo} ${p.subject} ${p.day} ${p.period}교시가 옮겨짐`);
  }

  for (const s of inst.sets) {
    const mine = sol.occurrences.filter((o) => o.grade === s.grade && o.set === s.set);
    // H6 회차 수
    if (mine.length !== s.units) add("H6", `${s.grade}학년 ${s.set} SET 회차 ${mine.length} / ${s.units}`);
    // H7 고정 회차
    for (const f of s.fixed) if (!mine.some((o) => o.day === f.day && o.period === f.period)) add("H7", `고정한 ${s.grade}학년 ${s.set} SET ${f.day} ${f.period}교시가 없음`);
    // H12 요일 배분
    for (const [day, b] of setDayBounds(inst, s)) {
      const n = mine.filter((o) => o.day === day).length;
      if (n < b.lo || n > b.hi) add("H12", `${s.grade}학년 ${s.set} SET ${day}요일 ${n}회 (허용 ${b.lo}~${b.hi})`);
    }
    // H10 담당 교사
    for (const subj of s.subjects) {
      const count = new Map<string, number>();
      for (const o of mine) {
        const ts = o.bySubject[subj.name] ?? [];
        if (subj.rotated) {
          if (ts.length !== 1 || !subj.teachers.some((t) => t.name === ts[0])) { add("H10", `${s.grade}학년 ${s.set} ${subj.name} ${o.day} ${o.period}교시 담당이 한 명이 아님`); continue; }
          count.set(ts[0], (count.get(ts[0]) ?? 0) + 1);
          const a = s.assigned.find((x) => x.day === o.day && x.period === o.period && x.subject === subj.name);
          if (a && a.teacher !== ts[0]) add("H10", `${s.grade}학년 ${s.set} ${subj.name} ${o.day} ${o.period}교시 지정 담당(${a.teacher})이 바뀜`);
        } else {
          const want = subj.teachers.map((t) => t.name).sort().join(",");
          if ([...ts].sort().join(",") !== want) add("H10", `${s.grade}학년 ${s.set} ${subj.name} ${o.day} ${o.period}교시 담당 교사가 맞지 않음`);
        }
      }
      if (subj.rotated && mine.length === s.units) {
        for (const t of subj.teachers) if ((count.get(t.name) ?? 0) !== t.hours) add("H10", `${s.grade}학년 ${s.set} ${subj.name} ${t.name} 담당 ${count.get(t.name) ?? 0} / ${t.hours}회`);
      }
    }
  }

  // H8 같은 학년 전체 SET과 부분 SET은 같은 칸 불가
  for (const o of sol.occurrences) {
    const s = setOf.get(`${o.grade}|${o.set}`);
    if (s?.kind !== "whole") continue;
    for (const p of sol.occurrences) {
      if (p.grade === o.grade && p.day === o.day && p.period === o.period && setOf.get(`${p.grade}|${p.set}`)?.kind === "partial") {
        add("H8", `${o.grade}학년 ${o.day} ${o.period}교시: 전체 SET ${o.set}과 부분 SET ${p.set}이 함께 있음`);
      }
    }
  }

  const metrics = measure(inst, sol, busy);
  return { ok: v.length === 0 && unplaced === 0, violations: v, unplaced, metrics: { ...metrics, unplaced } };
}

/** S1·S2는 바쁜 교사 전체(+α 과목 교사 포함), S3는 반·과목·요일 묶음당 1건 */
function measure(inst: V3Instance, sol: V3Solution, busy: Map<string, number>): Omit<V3Metrics, "unplaced"> {
  const lap = inst.lunchAfter;
  const byTeacherDay = new Map<string, Set<number>>();
  for (const k of busy.keys()) {
    const [t, day, p] = k.split("|");
    const key = `${t}|${day}`;
    const set = byTeacherDay.get(key) ?? new Set<number>();
    set.add(Number(p));
    byTeacherDay.set(key, set);
  }
  let lunch = 0, triple = 0;
  for (const ps of byTeacherDay.values()) {
    if (ps.has(lap) && ps.has(lap + 1)) lunch++;
    for (const s of ps) if (isTripleRunWindow(s, lap) && ps.has(s + 1) && ps.has(s + 2)) triple++;
  }
  const groups = new Map<string, number>();
  for (const c of sol.cells) {
    if (c.kind === "set" || !inst.bans.has(banKey(c.grade, c.subjectName))) continue;
    const k = `${c.grade}|${c.classNo}|${c.day}|${c.subjectName}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const sameDay = [...groups.values()].filter((n) => n >= 2).length;
  return { lunch, triple, sameDay, score: scoreOf({ lunch, triple, sameDay }, inst.weights) };
}

/**
 * 저장된 시간표 칸(v1·v2·v3 공통 형식)에서 SET 회차를 다시 만든다.
 * 반 칸이 없는 +α 과목 담당은 순환 지정(없으면 담당 전체)으로 채운다.
 */
export function occurrencesFromCells(input: V3Input, cells: TimetableCell[], opts: { fillAlpha?: boolean } = {}): V3Occurrence[] {
  const catalog = catalogGradeSets(input.subjects, input.classCounts);
  const map = new Map<string, V3Occurrence>();
  for (const c of cells) {
    if (c.kind !== "set" || !c.set) continue;
    const k = occKey(c.grade, c.set, c.day, c.period);
    const o = map.get(k) ?? { grade: c.grade, set: c.set, day: c.day, period: c.period, bySubject: {} };
    o.bySubject[c.subjectName] = c.teacherName.split("·").map((x) => x.trim()).filter(Boolean);
    map.set(k, o);
  }
  if (opts.fillAlpha === false) return [...map.values()];
  for (const o of map.values()) {
    const info = findGradeSet(catalog, o.grade, o.set);
    if (!info) continue;
    for (const name of new Set(info.subjects.map((s) => s.name))) {
      if (!(name in o.bySubject)) o.bySubject[name] = resolveSubjectTeachersAtSlot(input.teachers, info, name, o.day, o.period, input.teacherAssignments);
    }
  }
  return [...map.values()];
}
