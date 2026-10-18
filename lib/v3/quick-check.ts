/**
 * 빠른 검사 (docs/v3-diagnosis-design.md 3.1 ①). 세기만 해서 밀리초 안에 끝난다.
 * SET 위치는 아직 모른다고 보고, SET을 어디에 두어도 성립하는 것만 확정으로 낸다.
 *
 * - error: 확정 부족. 그만큼은 어떻게 해도 배치할 수 없다 (minUnplaced 하한).
 * - warn : 여유 없음. 지금은 가능하지만 조건을 하나 더하면 막힐 수 있다.
 */
import { GRADES, dayLabel, type Grade } from "@/lib/types";
import { gradeSlots, slotKey, type V3Instance, type V3Set } from "@/lib/v3/instance";

export type QuickRule =
  | "class" // 반 시간
  | "teacher" // 교사 시간
  | "teacherGrade" // 교사의 학년 수업 > 학년 전체 SET 밖 칸 (시간 수 문제: 배정 불가를 풀어도 못 고침)
  | "teacherGradeBlocked" // 교사의 학년 수업은 SET 밖 칸에 들어가지만, 수업할 수 없는 칸이 많아 모자람 (배정 불가·선 수업을 풀면 고칠 수 있음)
  | "wholeSetColumns" // 학년 전체 SET 회차 > 학년 전체가 비는 칸
  | "setSlots" // SET을 놓을 칸 부족
  | "setDays" // SET을 놓을 요일 부족 (하루 1회)
  | "fixedConflict" // 고정한 SET 담당 교사가 배정 불가 시간과 겹침
  | "pinConflict"; // 선 수업이 고정 SET·배정 불가·다른 선 수업과 겹침 (입력 모순: 고쳐야 생성 가능)

export type QuickWarning = {
  rule: QuickRule;
  severity: "error" | "warn";
  who: string;
  need: number;
  have: number;
  message: string;
};

export type QuickCheckResult = {
  warnings: QuickWarning[];
  /** 확정된 최소 미배치 시간 (0이면 세기로는 문제를 못 찾음) */
  minUnplaced: number;
  /** SET 자체를 놓을 수 없는 등, 수업 시간으로 셀 수 없는 확정 불가 */
  blocking: boolean;
  ms: number;
};

/** 받침이 있으면 "과", 없으면 "와" (한글이 아니면 "과": "SET과") */
function withGwa(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return `${word}${hangul && (code - 0xac00) % 28 === 0 ? "와" : "과"}`;
}

const setName = (s: V3Set) => `${s.grade}학년 ${s.set} SET`;

export function quickCheck(inst: V3Instance): QuickCheckResult {
  const t0 = performance.now();
  const out: QuickWarning[] = [];
  const push = (w: Omit<QuickWarning, "severity">, tight = false) => out.push({ ...w, severity: tight ? "warn" : "error" });

  for (const p of inst.pinConflicts) {
    push({ rule: "pinConflict", who: `${p.grade}학년 ${p.classNo}반 ${p.subject}`, need: 1, have: 0, message: `${dayLabel(p.day)}요일 ${p.period}교시 선 수업이 ${withGwa(p.reason)} 겹칩니다. 선 수업이나 SET 위치를 고쳐 주세요` });
  }

  // 공통 수업(선 수업 포함) 시간: 반별·교사별·교사×학년별
  const classLoad = new Map<string, number>();
  const teacherLoad = new Map<string, number>();
  const teacherGradeLoad = new Map<string, number>();
  const addLesson = (teacher: string, grade: Grade, classNo: number, n: number) => {
    classLoad.set(`${grade}|${classNo}`, (classLoad.get(`${grade}|${classNo}`) ?? 0) + n);
    teacherLoad.set(teacher, (teacherLoad.get(teacher) ?? 0) + n);
    teacherGradeLoad.set(`${teacher}|${grade}`, (teacherGradeLoad.get(`${teacher}|${grade}`) ?? 0) + n);
  };
  for (const g of inst.groups) addLesson(g.teacher, g.grade, g.classNo, g.hours);
  for (const p of inst.pins) addLesson(p.teacher, p.grade, p.classNo, 1);

  let classShort = 0, teacherShort = 0, gradeShort = 0, blocking = inst.pinConflicts.length > 0;

  // 1) 반 시간: 공통 수업 + 그 반을 차지하는 SET 회차 ≤ 반의 시간 칸
  for (const g of GRADES) {
    const slots = gradeSlots(inst, g).length;
    for (let c = 1; c <= inst.classCounts[g]; c++) {
      const need = (classLoad.get(`${g}|${c}`) ?? 0) + inst.sets.filter((s) => s.grade === g && s.rooms.includes(c)).reduce((a, s) => a + s.units, 0);
      if (need > slots) { classShort += need - slots; push({ rule: "class", who: `${g}학년 ${c}반`, need, have: slots, message: `수업 ${need}시간이 시간 칸 ${slots}칸보다 많습니다` }); }
    }
  }

  // 2) 교사 시간: 공통 수업 + SET 담당 ≤ 배정 가능한 시간 (요일별 가장 긴 학년 교시 기준, 배정 불가 제외)
  for (const s of inst.sets) for (const subj of s.subjects) for (const t of subj.teachers) {
    teacherLoad.set(t.name, (teacherLoad.get(t.name) ?? 0) + (subj.rotated ? t.hours : s.units));
  }
  const maxP = (day: string) => Math.max(...GRADES.map((g) => inst.periods[g][day as "mon"] ?? 0));
  for (const [t, need] of teacherLoad) {
    let have = 0;
    for (const day of inst.days) for (let p = 1; p <= maxP(day); p++) if (!inst.forbidden.has(slotKey(t, day, p))) have++;
    if (need > have) { teacherShort += need - have; push({ rule: "teacher", who: t, need, have, message: `수업 ${need}시간이 배정 가능한 시간 ${have}칸보다 많습니다` }); }
  }

  // 3) 학년 전체 SET은 그 학년 모든 반을 차지한다 → 그 학년 공통 수업은 SET 칸 밖에서만 가능 (SET 위치와 무관)
  for (const g of GRADES) {
    const whole = inst.sets.filter((s) => s.grade === g && s.kind === "whole");
    const wholeUnits = whole.reduce((a, s) => a + s.units, 0);
    const slots = gradeSlots(inst, g);
    if (whole.length) {
      const free = slots.filter((sl) => !inst.pins.some((p) => p.grade === g && p.day === sl.day && p.period === sl.period)).length;
      if (wholeUnits > free) { blocking = true; push({ rule: "wholeSetColumns", who: `${g}학년`, need: wholeUnits, have: free, message: `학년 전체 SET ${wholeUnits}회차를 놓을, 학년 전체가 비는 칸이 ${free}칸뿐입니다 (선 수업 때문)` }); }
      else if (wholeUnits > free - 2) push({ rule: "wholeSetColumns", who: `${g}학년`, need: wholeUnits, have: free, message: `학년 전체 SET을 놓을 칸 여유가 ${free - wholeUnits}칸뿐입니다` }, true);
    }
    const cap = slots.length - wholeUnits;
    for (const [k, n] of teacherGradeLoad) {
      const [t, gg] = k.split("|");
      if (Number(gg) !== g) continue;
      if (n > cap) { gradeShort += n - cap; push({ rule: "teacherGrade", who: `${t} (${g}학년)`, need: n, have: cap, message: `${g}학년 수업 ${n}시간이 학년 전체 SET이 없는 칸 ${cap}칸보다 많습니다 (${n - cap}시간 부족)` }); continue; }
      if (!wholeUnits) continue;
      // 이 교사가 이 학년 수업을 할 수 없는 칸: 배정 불가, 다른 학년 선 수업
      const blocked = slots.filter((sl) =>
        inst.forbidden.has(slotKey(t, sl.day, sl.period)) ||
        inst.pins.some((p) => p.teacher === t && p.grade !== g && p.day === sl.day && p.period === sl.period)).length;
      // 그런 칸은 여유 칸(SET이 없는 칸 중 이 교사가 안 쓰는 칸)이 되거나, 이 교사가 맡지 않는 학년 전체 SET 회차로 덮여야 한다.
      // 순환 담당은 다른 교사가 맡을 수 있으므로 "맡지 않는 회차"로 넉넉하게 센다 (필요조건)
      const slack = cap - n;
      const coverable = whole.filter((s) => !s.subjects.some((x) => !x.rotated && x.teachers.some((tt) => tt.name === t))).reduce((a, s) => a + s.units, 0);
      const allowed = slack + coverable;
      if (blocked > allowed) {
        gradeShort += blocked - allowed;
        push({ rule: "teacherGradeBlocked", who: `${t} (${g}학년)`, need: blocked, have: allowed, message: `${g}학년 수업 ${n}시간을 학년 전체 SET이 없는 칸 ${cap}칸에 놓아야 합니다(여유 ${slack}칸). 이 교사가 수업할 수 없는 칸(배정 불가·다른 학년 선 수업) ${blocked}칸은 여유 칸이나 이 교사가 맡지 않는 학년 전체 SET 회차(${coverable}회)로만 덮을 수 있어 최대 ${allowed}칸까지 가능합니다 (${blocked - allowed}시간 부족)` });
      } else if (slack <= 1 || blocked > slack) {
        push({ rule: "teacherGradeBlocked", who: `${t} (${g}학년)`, need: n, have: cap, message: `${g}학년 수업 ${n}시간이 학년 전체 SET이 없는 칸 ${cap}칸 중 ${n}칸을 씁니다(여유 ${slack}칸). 이 교사가 수업할 수 없는 칸(배정 불가·다른 학년 선 수업)은 최대 ${allowed}칸(여유 ${slack} + 이 교사가 맡지 않는 학년 전체 SET ${coverable}회)까지만 가능하고, 지금 ${blocked}칸입니다.${blocked > slack ? ` 그중 ${blocked - slack}칸에는 반드시 이 교사가 맡지 않는 학년 전체 SET이 와야 합니다.` : ""}` }, true);
      }
    }
  }

  // 4) SET마다 놓을 칸·요일: 그 SET의 반이 모두 비고(선 수업 없음), 비순환 담당이 배정 불가가 아닌 칸
  for (const s of inst.sets) {
    const fixedTeachers = s.subjects.filter((x) => !x.rotated).flatMap((x) => x.teachers.map((t) => t.name));
    const blockedBy = (day: string, period: number) => {
      if (inst.pins.some((p) => p.grade === s.grade && s.rooms.includes(p.classNo) && p.day === day && p.period === period)) return "선 수업";
      const t = fixedTeachers.find((n) => inst.forbidden.has(slotKey(n, day as "mon", period)));
      return t ? `${t} 배정 불가` : null;
    };
    for (const f of s.fixed) {
      const why = blockedBy(f.day, f.period);
      if (why) { blocking = true; push({ rule: "fixedConflict", who: setName(s), need: 1, have: 0, message: `고정한 ${dayLabel(f.day)}요일 ${f.period}교시가 ${withGwa(why)} 겹칩니다` }); }
    }
    const ok = gradeSlots(inst, s.grade).filter((sl) => !blockedBy(sl.day, sl.period));
    const days = new Set(ok.map((sl) => sl.day)).size;
    const needDays = Math.min(s.units, inst.days.filter((d) => (inst.periods[s.grade][d] ?? 0) > 0).length);
    if (ok.length < s.units) { blocking = true; push({ rule: "setSlots", who: setName(s), need: s.units, have: ok.length, message: `${s.units}회차를 놓을 칸이 ${ok.length}칸뿐입니다` }); }
    else if (days < needDays) { blocking = true; push({ rule: "setDays", who: setName(s), need: needDays, have: days, message: `하루 한 번씩 놓을 요일이 ${days}일뿐입니다 (${needDays}일 필요)` }); }
  }

  return {
    warnings: out,
    minUnplaced: Math.max(classShort, teacherShort, gradeShort),
    blocking,
    ms: Math.round((performance.now() - t0) * 100) / 100,
  };
}
