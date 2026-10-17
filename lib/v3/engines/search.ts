/**
 * 탐색 엔진 (담금질 탐색). docs/v3-algorithm-comparison.md 의 A 방식.
 *
 * 상태: 학년·반·칸 격자에 수업을 놓고, 세 가지 움직임으로 다듬는다.
 *   1) 한 반 안에서 두 칸 맞바꾸기 (공통 수업)
 *   2) 학년 세로줄 두 개 맞바꾸기 (SET 회차 이동: 그 시간의 학년 전체 칸이 함께 움직임)
 *   3) 같은 SET 두 회차의 순환 담당 교사 맞바꾸기 (교사별 시수 유지)
 * 비용 = 필수 위반 × 1000 + 점심 연강·3연강·동일 교과 × 중요도. 비용이 같아도 받아들이고,
 * 가끔 나빠지는 움직임도 받아들여(온도) 막다른 길을 벗어난다.
 */
import { isTripleRunWindow } from "@/lib/generation-preferences";
import type { Grade, TimetableCell, Weekday } from "@/lib/types";
import { banKey, setDayBounds, slotKey, type V3Instance } from "@/lib/v3/instance";
import type { V3Occurrence, V3Solution } from "@/lib/v3/validate";
import { Collector } from "@/lib/v3/engines/collector";
import { StopRules } from "@/lib/v3/engines/stop-rules";
import type { EngineOutcome, EngineProgress, EngineRun, StopReason } from "@/lib/v3/engines/types";

const H = 1000;
const P = 16; // 요일 안 교시 칸 (교시 1..15)
const GRADES: Grade[] = [1, 2, 3];

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Item = { kind: "common" | "pin" | "set"; grade: Grade; classNo: number; subject: string; teacher: string; occ: number };
type Subj = { name: string; rot: boolean; shares: string[]; cur: string[] };
type Occ = { k: number; grade: Grade; slot: number; fixed: boolean; subj: Subj[]; teachers: string[] };
type Slot = { day: Weekday; period: number; d: number; key: number };

class State {
  slots: Record<number, Slot[]> = {};
  grid: Record<number, Int32Array[]> = {};
  items: Item[] = [];
  occs: Occ[] = [];
  tb = new Map<string, Int16Array>();
  unplaced = 0;
  bounds: Map<number, { lo: number; hi: number }>[] = [];
  lap: number;
  w: V3Instance["weights"];

  constructor(public inst: V3Instance, public rand: () => number) {
    this.lap = inst.lunchAfter;
    this.w = inst.weights;
    for (const g of GRADES) {
      const list: Slot[] = [];
      inst.days.forEach((day, d) => { for (let p = 1; p <= (inst.periods[g][day] ?? 0); p++) list.push({ day, period: p, d, key: d * P + p }); });
      this.slots[g] = list;
      this.grid[g] = Array.from({ length: inst.classCounts[g] + 1 }, () => new Int32Array(list.length).fill(-1));
    }
    this.bounds = inst.sets.map((s) => {
      const m = new Map<number, { lo: number; hi: number }>();
      for (const [day, b] of setDayBounds(inst, s)) m.set(inst.days.indexOf(day), b);
      return m;
    });
  }

  slotIndex(g: Grade, day: Weekday, period: number) {
    return this.slots[g].findIndex((s) => s.day === day && s.period === period);
  }

  arr(t: string) {
    let a = this.tb.get(t);
    if (!a) { a = new Int16Array(5 * P); this.tb.set(t, a); }
    return a;
  }

  addItemBusy(id: number, s: number, delta: number) {
    const it = this.items[id];
    if (it.kind !== "set") this.arr(it.teacher)[this.slots[it.grade][s].key] += delta;
  }

  addOccBusy(o: Occ, delta: number) {
    const key = this.slots[o.grade][o.slot].key;
    for (const t of o.teachers) this.arr(t)[key] += delta;
  }

  occTeachers(o: Occ) {
    o.teachers = o.subj.flatMap((x) => x.cur);
  }

  /** 교사 t 의 d 요일 비용 */
  tdPen(t: string, d: number): number {
    const a = this.tb.get(t);
    if (!a) return 0;
    const base = d * P;
    let pen = 0;
    for (let p = 1; p < P; p++) {
      const n = a[base + p];
      if (n > 1) pen += H * (n - 1);
      if (n > 0 && this.inst.forbidden.has(slotKey(t, this.inst.days[d], p))) pen += H * n;
    }
    if (this.w.lunch && a[base + this.lap] > 0 && a[base + this.lap + 1] > 0) pen += this.w.lunch;
    if (this.w.triple) for (let s = 1; s + 2 < P; s++) if (a[base + s] > 0 && a[base + s + 1] > 0 && a[base + s + 2] > 0 && isTripleRunWindow(s, this.lap)) pen += this.w.triple;
    return pen;
  }

  /** 반 (g,c) 의 d 요일 동일 교과 비용 (반·과목·요일 묶음당 1건) */
  cdPen(g: Grade, c: number, d: number): number {
    if (!this.w.sameDay || this.inst.bans.size === 0) return 0;
    const row = this.grid[g][c];
    const seen = new Map<string, number>();
    let pen = 0;
    const slots = this.slots[g];
    for (let s = 0; s < row.length; s++) {
      if (slots[s].d !== d || row[s] < 0) continue;
      const it = this.items[row[s]];
      if (it.kind === "set" || !this.inst.bans.has(banKey(g, it.subject))) continue;
      const n = (seen.get(it.subject) ?? 0) + 1;
      seen.set(it.subject, n);
      if (n === 2) pen += this.w.sameDay;
    }
    return pen;
  }

  /** SET k 의 요일 배분(H12) 위반 */
  setPen(k: number): number {
    const counts = new Map<number, number>();
    for (const o of this.occs) if (o.k === k) { const d = this.slots[o.grade][o.slot].d; counts.set(d, (counts.get(d) ?? 0) + 1); }
    let pen = 0;
    for (const [d, b] of this.bounds[k]) {
      const n = counts.get(d) ?? 0;
      if (n > b.hi) pen += H * (n - b.hi);
      if (n < b.lo) pen += H * (b.lo - n);
    }
    return pen;
  }

  total(): number {
    let s = H * this.unplaced;
    for (const t of this.tb.keys()) for (let d = 0; d < 5; d++) s += this.tdPen(t, d);
    for (const g of GRADES) for (let c = 1; c <= this.inst.classCounts[g]; c++) for (let d = 0; d < 5; d++) s += this.cdPen(g, c, d);
    for (let k = 0; k < this.inst.sets.length; k++) s += this.setPen(k);
    return s;
  }

  snapshot() {
    return {
      grid: Object.fromEntries(GRADES.map((g) => [g, this.grid[g].map((r) => r.slice())])) as Record<number, Int32Array[]>,
      occ: this.occs.map((o) => ({ slot: o.slot, cur: o.subj.map((x) => [...x.cur]) })),
    };
  }

  restore(snap: ReturnType<State["snapshot"]>) {
    for (const g of GRADES) this.grid[g] = snap.grid[g].map((r) => r.slice());
    this.occs.forEach((o, i) => { o.slot = snap.occ[i].slot; o.subj.forEach((x, j) => (x.cur = [...snap.occ[i].cur[j]])); this.occTeachers(o); });
    this.rebuildBusy();
  }

  rebuildBusy() {
    this.tb.clear();
    for (const g of GRADES) for (let c = 1; c < this.grid[g].length; c++) this.grid[g][c].forEach((id, s) => { if (id >= 0) this.addItemBusy(id, s, 1); });
    for (const o of this.occs) this.addOccBusy(o, 1);
  }

  /** 시간표 한 벌로. clean=true 면 교사 겹침·배정 불가를 일으키는 공통 수업을 빼서(미배치로) 필수 조건을 지킨 해로 만든다 */
  decode(clean: boolean): V3Solution {
    const cells: TimetableCell[] = [];
    const occurrences: V3Occurrence[] = this.occs.map((o) => {
      const s = this.inst.sets[o.k];
      const sl = this.slots[o.grade][o.slot];
      return { grade: o.grade, set: s.set, day: sl.day, period: sl.period, bySubject: Object.fromEntries(o.subj.map((x) => [x.name, [...x.cur]])) };
    });
    const used = new Map<string, number>();
    const mark = (t: string, day: Weekday, p: number) => { const k = slotKey(t, day, p); used.set(k, (used.get(k) ?? 0) + 1); };
    for (const o of occurrences) for (const ts of Object.values(o.bySubject)) for (const t of ts) mark(t, o.day, o.period);
    // 선 수업 먼저 (고정이므로 빼지 않음)
    const order: { g: Grade; c: number; s: number; id: number }[] = [];
    for (const g of GRADES) for (let c = 1; c < this.grid[g].length; c++) this.grid[g][c].forEach((id, s) => { if (id >= 0) order.push({ g, c, s, id }); });
    order.sort((a, b) => (this.items[a.id].kind === "pin" ? 0 : 1) - (this.items[b.id].kind === "pin" ? 0 : 1));
    for (const { g, c, s, id } of order) {
      const it = this.items[id];
      const sl = this.slots[g][s];
      if (it.kind === "set") {
        const o = this.occs[it.occ];
        const name = this.inst.sets[o.k].roomSubject[c];
        const sub = o.subj.find((x) => x.name === name);
        cells.push({ grade: g, classNo: c, day: sl.day, period: sl.period, subjectName: name, teacherName: (sub?.cur ?? []).join("·") || "—", kind: "set", set: this.inst.sets[o.k].set });
        continue;
      }
      const k = slotKey(it.teacher, sl.day, sl.period);
      if (clean && it.kind === "common" && ((used.get(k) ?? 0) >= 1 || this.inst.forbidden.has(k))) continue;
      mark(it.teacher, sl.day, sl.period);
      cells.push({ grade: g, classNo: c, day: sl.day, period: sl.period, subjectName: it.subject, teacherName: it.teacher, kind: "common" });
    }
    return { cells, occurrences };
  }
}

// ── 시작 배치 ──

function newOcc(st: State, k: number, slot: number, fixed: boolean): Occ {
  const s = st.inst.sets[k];
  const subj = s.subjects.map((x) => ({ name: x.name, rot: x.rotated, shares: x.teachers.map((t) => t.name), cur: x.rotated ? [] : x.teachers.map((t) => t.name) }));
  return { k, grade: s.grade, slot, fixed, subj, teachers: [] };
}

function putOcc(st: State, o: Occ): boolean {
  const s = st.inst.sets[o.k];
  for (const r of s.rooms) if (st.grid[o.grade][r][o.slot] >= 0) return false;
  const oi = st.occs.length;
  st.occs.push(o);
  for (const r of s.rooms) {
    st.items.push({ kind: "set", grade: o.grade, classNo: r, subject: s.roomSubject[r], teacher: "", occ: oi });
    st.grid[o.grade][r][o.slot] = st.items.length - 1;
  }
  return true;
}

/** 순환 과목 담당: 교사별 시수만큼 회차에 나눠 주되, 지정된 것은 지키고, 같은 회차 안 겹침을 피한다 */
function assignRotations(st: State, k: number) {
  const s = st.inst.sets[k];
  const mine = st.occs.filter((o) => o.k === k);
  s.subjects.forEach((subj, j) => {
    if (!subj.rotated) return;
    const left = new Map(subj.teachers.map((t) => [t.name, t.hours]));
    for (const o of mine) {
      const sl = st.slots[o.grade][o.slot];
      const a = s.assigned.find((x) => x.day === sl.day && x.period === sl.period && x.subject === subj.name);
      if (a && (left.get(a.teacher) ?? 0) > 0) { o.subj[j].cur = [a.teacher]; left.set(a.teacher, left.get(a.teacher)! - 1); }
    }
    for (const o of mine) {
      if (o.subj[j].cur.length) continue;
      const busyHere = new Set(o.subj.filter((_, i) => i !== j).flatMap((x) => x.cur));
      const options = [...left.entries()].filter(([, n]) => n > 0).map(([t]) => t);
      const pick = options.find((t) => !busyHere.has(t)) ?? options[0];
      if (!pick) continue;
      o.subj[j].cur = [pick];
      left.set(pick, left.get(pick)! - 1);
    }
  });
  mine.forEach((o) => st.occTeachers(o));
}

function placeFresh(st: State) {
  const { inst, rand } = st;
  // 선 수업
  for (const p of inst.pins) {
    const s = st.slotIndex(p.grade, p.day, p.period);
    if (s < 0) continue;
    st.items.push({ kind: "pin", grade: p.grade, classNo: p.classNo, subject: p.subject, teacher: p.teacher, occ: -1 });
    if (st.grid[p.grade][p.classNo][s] < 0) st.grid[p.grade][p.classNo][s] = st.items.length - 1;
  }
  // 고정 SET 회차
  inst.sets.forEach((s, k) => {
    for (const f of s.fixed) { const sl = st.slotIndex(s.grade, f.day, f.period); if (sl >= 0) putOcc(st, newOcc(st, k, sl, true)); }
  });
  // 교사 점유(선 수업·고정 SET 비순환 담당)를 미리 알아 둔다
  const teacherBusy = new Set<string>();
  for (const p of inst.pins) teacherBusy.add(slotKey(p.teacher, p.day, p.period));
  const nonRot = (k: number) => inst.sets[k].subjects.filter((x) => !x.rotated).flatMap((x) => x.teachers.map((t) => t.name));
  for (const o of st.occs) { const sl = st.slots[o.grade][o.slot]; for (const t of nonRot(o.k)) teacherBusy.add(slotKey(t, sl.day, sl.period)); }
  // 나머지 SET 회차: 규칙을 지키는 빠른 시작 배치 (담당 교사가 많은 SET부터)
  const order = inst.sets.map((_, k) => k).sort((a, b) => nonRot(b).length - nonRot(a).length);
  for (const k of order) {
    const s = inst.sets[k];
    const names = nonRot(k);
    for (let n = st.occs.filter((o) => o.k === k).length; n < s.units; n++) {
      const counts = new Map<number, number>();
      for (const o of st.occs) if (o.k === k) { const d = st.slots[o.grade][o.slot].d; counts.set(d, (counts.get(d) ?? 0) + 1); }
      let best = -1, bestScore = Infinity;
      st.slots[s.grade].forEach((sl, si) => {
        if (s.rooms.some((r) => st.grid[s.grade][r][si] >= 0)) return;
        const b = st.bounds[k].get(sl.d);
        const dayFull = !b || (counts.get(sl.d) ?? 0) >= b.hi;
        const clash = names.filter((t) => teacherBusy.has(slotKey(t, sl.day, sl.period)) || inst.forbidden.has(slotKey(t, sl.day, sl.period))).length;
        let score = rand() + clash * 1000 + (dayFull ? 500 : 0);
        if (sl.period === inst.lunchAfter || sl.period === inst.lunchAfter + 1) score += 15;
        score += 10 * st.occs.filter((o) => o.grade === s.grade && st.slots[o.grade][o.slot].d === sl.d).length;
        if (sl.period === 1) score += 8;
        if (score < bestScore) { bestScore = score; best = si; }
      });
      if (best < 0) break; // 놓을 반 칸이 없음 → 회차 부족(필수 위반)으로 남는다
      putOcc(st, newOcc(st, k, best, false));
      const sl = st.slots[s.grade][best];
      for (const t of names) teacherBusy.add(slotKey(t, sl.day, sl.period));
    }
  }
  inst.sets.forEach((_, k) => assignRotations(st, k));
  // 공통 수업: 교사가 비는 칸을 우선해 반의 빈칸에
  for (const o of st.occs) { const sl = st.slots[o.grade][o.slot]; for (const t of o.teachers) teacherBusy.add(slotKey(t, sl.day, sl.period)); }
  const lessons: Item[] = [];
  for (const g of inst.groups) for (let h = 0; h < g.hours; h++) lessons.push({ kind: "common", grade: g.grade, classNo: g.classNo, subject: g.subject, teacher: g.teacher, occ: -1 });
  for (let i = lessons.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [lessons[i], lessons[j]] = [lessons[j], lessons[i]]; }
  for (const l of lessons) {
    const row = st.grid[l.grade][l.classNo];
    const holes: number[] = [];
    row.forEach((v, s) => { if (v < 0) holes.push(s); });
    if (!holes.length) { st.unplaced++; continue; }
    const good = holes.filter((s) => { const sl = st.slots[l.grade][s]; const k = slotKey(l.teacher, sl.day, sl.period); return !teacherBusy.has(k) && !inst.forbidden.has(k); });
    const pool = good.length ? good : holes;
    const s = pool[Math.floor(rand() * pool.length)];
    st.items.push(l);
    row[s] = st.items.length - 1;
    const sl = st.slots[l.grade][s];
    teacherBusy.add(slotKey(l.teacher, sl.day, sl.period));
  }
  st.rebuildBusy();
}

/** 중단점(시간표 한 벌)에서 상태를 다시 만든다. 빠진 회차·수업은 시작 배치 규칙으로 채운다 */
function placeFrom(st: State, sol: V3Solution) {
  const { inst } = st;
  const pinAt = new Set(inst.pins.map((p) => `${p.grade}|${p.classNo}|${p.day}|${p.period}`));
  for (const p of inst.pins) {
    const s = st.slotIndex(p.grade, p.day, p.period);
    if (s < 0) continue;
    st.items.push({ kind: "pin", grade: p.grade, classNo: p.classNo, subject: p.subject, teacher: p.teacher, occ: -1 });
    if (st.grid[p.grade][p.classNo][s] < 0) st.grid[p.grade][p.classNo][s] = st.items.length - 1;
  }
  const setIndex = new Map(inst.sets.map((s, k) => [`${s.grade}|${s.set}`, k]));
  for (const o of sol.occurrences) {
    const k = setIndex.get(`${o.grade}|${o.set}`);
    if (k === undefined) continue;
    const sl = st.slotIndex(o.grade, o.day, o.period);
    if (sl < 0) continue;
    const fixed = inst.sets[k].fixed.some((f) => f.day === o.day && f.period === o.period);
    const occ = newOcc(st, k, sl, fixed);
    occ.subj.forEach((x) => { if (x.rot) { const t = (o.bySubject[x.name] ?? [])[0]; if (t && x.shares.includes(t)) x.cur = [t]; } });
    if (putOcc(st, occ)) st.occTeachers(occ);
  }
  // 빠진 고정 회차
  inst.sets.forEach((s, k) => {
    for (const f of s.fixed) {
      const sl = st.slotIndex(s.grade, f.day, f.period);
      if (sl >= 0 && !st.occs.some((o) => o.k === k && o.slot === sl)) putOcc(st, newOcc(st, k, sl, true));
    }
  });
  // 순환 담당이 비었거나 시수가 안 맞으면 다시 나눈다
  inst.sets.forEach((s, k) => {
    const mine = st.occs.filter((o) => o.k === k);
    s.subjects.forEach((subj, j) => {
      if (!subj.rotated) return;
      const cnt = new Map<string, number>();
      for (const o of mine) for (const t of o.subj[j].cur) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      if (mine.some((o) => o.subj[j].cur.length !== 1) || subj.teachers.some((t) => (cnt.get(t.name) ?? 0) > t.hours)) for (const o of mine) o.subj[j].cur = [];
    });
    assignRotations(st, k);
  });
  // 공통 수업
  const need = new Map(inst.groups.map((g) => [`${g.teacher}|${g.grade}|${g.classNo}|${g.subject}`, g.hours]));
  for (const c of sol.cells) {
    if (c.kind === "set" || pinAt.has(`${c.grade}|${c.classNo}|${c.day}|${c.period}`)) continue;
    const key = `${c.teacherName}|${c.grade}|${c.classNo}|${c.subjectName}`;
    const left = need.get(key) ?? 0;
    const s = st.slotIndex(c.grade, c.day, c.period);
    if (left <= 0 || s < 0 || st.grid[c.grade][c.classNo][s] >= 0) continue;
    st.items.push({ kind: "common", grade: c.grade, classNo: c.classNo, subject: c.subjectName, teacher: c.teacherName, occ: -1 });
    st.grid[c.grade][c.classNo][s] = st.items.length - 1;
    need.set(key, left - 1);
  }
  for (const [key, left] of need) {
    if (left <= 0) continue;
    const [teacher, g, c, subject] = key.split("|");
    const grade = Number(g) as Grade, classNo = Number(c);
    for (let h = 0; h < left; h++) {
      const row = st.grid[grade][classNo];
      const holes: number[] = [];
      row.forEach((v, s) => { if (v < 0) holes.push(s); });
      if (!holes.length) { st.unplaced++; continue; }
      st.items.push({ kind: "common", grade, classNo, subject, teacher, occ: -1 });
      row[holes[Math.floor(st.rand() * holes.length)]] = st.items.length - 1;
    }
  }
  st.rebuildBusy();
}

// ── 탐색 ──

export function runSearch(run: EngineRun): EngineOutcome {
  const { input, inst } = run;
  const t0 = Date.now();
  const baseMs = run.checkpoint?.elapsedMs ?? 0;
  const now = () => baseMs + (Date.now() - t0);
  const seed = run.seed ?? run.checkpoint?.seed ?? 1;
  const st = new State(inst, rng(seed));
  if (run.checkpoint?.best) placeFrom(st, run.checkpoint.best);
  else placeFresh(st);

  const collector = new Collector(input, inst, run.checkpoint?.results ?? []);
  const lowerBound = run.lowerBound ?? run.checkpoint?.lowerBound ?? null;
  const stop = new StopRules(false);
  let cur = st.total();
  let best = cur;
  let bestSnap = st.snapshot();
  let bestDirty = true;
  let lastOffer = 0, lastAlt = 0, lastProgress = 0;
  const progressEvery = run.progressEveryMs ?? 2000;
  let it = 0;
  let reason: StopReason = "budget";
  const T0 = 4, T1 = 0.05;
  const classList: [Grade, number][] = [];
  for (const g of GRADES) for (let c = 1; c <= inst.classCounts[g]; c++) classList.push([g, c]);
  const movableOcc = () => st.occs.map((o, i) => (o.fixed ? -1 : i)).filter((i) => i >= 0);
  const hasMovable = movableOcc().length > 0;
  const hasRot = st.occs.some((o) => !o.fixed && o.subj.some((x) => x.rot));
  const locked = (id: number) => id >= 0 && (st.items[id].kind === "pin" || (st.items[id].kind === "set" && st.occs[st.items[id].occ].fixed));

  const report = (phase: EngineProgress["phase"]) => {
    run.onProgress?.({
      phase, elapsedMs: now(), segmentMs: Date.now() - t0,
      bestScore: collector.bestScore(), bestUnplaced: collector.bestScore() !== null ? 0 : (collector.bestIncomplete?.unplaced ?? null),
      lowerBound, results: collector.results.length, iterations: it,
    });
  };
  const offerBest = () => {
    if (!bestDirty) return;
    bestDirty = false;
    const keep = st.snapshot();
    st.restore(bestSnap);
    const sol = st.decode(best >= H);
    collector.offer(sol, now());
    st.restore(keep);
  };

  report("start");
  for (;;) {
    if ((it & 255) === 0) {
      const t = Date.now();
      if (t - t0 >= run.budgetMs) break;
      if (run.shouldStop?.()) { reason = "user"; break; }
      if (t - lastOffer > 300) { offerBest(); lastOffer = t; }
      // 다른 좋은 결과도 모은다: 지금 상태가 필수 위반이 없고 상위 3개에 들 만하면
      if (t - lastAlt > 500 && cur < H && cur <= collector.admissionScore()) { collector.offer(st.decode(false), now()); lastAlt = t; }
      if (stop.shouldStop(now(), lowerBound, collector, it)) { reason = "early"; break; }
      if (t - lastProgress > progressEvery) { report(stop.collecting ? "collect" : best >= H ? "repair" : "improve"); lastProgress = t; }
    }
    it++;
    const frac = (Date.now() - t0) / run.budgetMs;
    const T = T0 * Math.pow(T1 / T0, Math.min(1, frac));
    const u = st.rand();
    let delta = 0, undo: (() => void) | null = null;

    if (hasRot && u < 0.05) {
      // 3) 순환 담당 맞바꾸기
      const cand = st.occs.filter((o) => !o.fixed && o.subj.some((x) => x.rot));
      const A = cand[Math.floor(st.rand() * cand.length)];
      const peers = st.occs.filter((o) => o !== A && o.k === A.k);
      if (!peers.length) continue;
      const B = peers[Math.floor(st.rand() * peers.length)];
      const js = A.subj.map((x, j) => (x.rot ? j : -1)).filter((j) => j >= 0);
      const j = js[Math.floor(st.rand() * js.length)];
      // 사용자가 지정한 담당은 바꾸지 않는다
      const assignedAt = (o: Occ) => { const sl = st.slots[o.grade][o.slot]; return st.inst.sets[o.k].assigned.some((a) => a.day === sl.day && a.period === sl.period && a.subject === o.subj[j].name); };
      if (assignedAt(A) || assignedAt(B) || A.subj[j].cur[0] === B.subj[j].cur[0]) continue;
      const ts = new Set([...A.subj[j].cur, ...B.subj[j].cur]);
      const days = new Set([st.slots[A.grade][A.slot].d, st.slots[B.grade][B.slot].d]);
      const measure = () => { let s = 0; for (const t of ts) for (const d of days) s += st.tdPen(t, d); return s; };
      const before = measure();
      const swap = () => { st.addOccBusy(A, -1); st.addOccBusy(B, -1); const a = A.subj[j].cur; A.subj[j].cur = B.subj[j].cur; B.subj[j].cur = a; st.occTeachers(A); st.occTeachers(B); st.addOccBusy(A, 1); st.addOccBusy(B, 1); };
      swap();
      delta = measure() - before;
      undo = swap;
    } else if (hasMovable && u < 0.13) {
      // 2) 학년 세로줄 맞바꾸기 (SET 회차 이동)
      const mv = movableOcc();
      const o = st.occs[mv[Math.floor(st.rand() * mv.length)]];
      const g = o.grade;
      const a = o.slot, b = Math.floor(st.rand() * st.slots[g].length);
      if (a === b) continue;
      let ok = true;
      const ts = new Set<string>();
      const occIds = new Set<number>();
      for (let c = 1; c < st.grid[g].length && ok; c++) for (const s of [a, b]) {
        const id = st.grid[g][c][s];
        if (id < 0) continue;
        if (locked(id)) { ok = false; break; }
        const x = st.items[id];
        if (x.kind === "set") occIds.add(x.occ); else ts.add(x.teacher);
      }
      if (!ok) continue;
      for (const oi of occIds) st.occs[oi].teachers.forEach((t) => ts.add(t));
      const ks = new Set([...occIds].map((oi) => st.occs[oi].k));
      const days = new Set([st.slots[g][a].d, st.slots[g][b].d]);
      const measure = () => {
        let s = 0;
        for (const t of ts) for (const d of days) s += st.tdPen(t, d);
        for (let c = 1; c < st.grid[g].length; c++) for (const d of days) s += st.cdPen(g, c, d);
        for (const k of ks) s += st.setPen(k);
        return s;
      };
      const before = measure();
      const apply = () => {
        for (const oi of occIds) st.addOccBusy(st.occs[oi], -1);
        for (let c = 1; c < st.grid[g].length; c++) {
          const row = st.grid[g][c];
          const ia = row[a], ib = row[b];
          if (ia >= 0) st.addItemBusy(ia, a, -1);
          if (ib >= 0) st.addItemBusy(ib, b, -1);
          row[a] = ib; row[b] = ia;
          if (ib >= 0) st.addItemBusy(ib, a, 1);
          if (ia >= 0) st.addItemBusy(ia, b, 1);
        }
        for (const oi of occIds) { const x = st.occs[oi]; x.slot = x.slot === a ? b : a; st.addOccBusy(x, 1); }
      };
      apply();
      delta = measure() - before;
      undo = apply;
    } else {
      // 1) 한 반 안 두 칸 맞바꾸기
      const [g, c] = classList[Math.floor(st.rand() * classList.length)];
      const row = st.grid[g][c];
      const n = row.length;
      if (n < 2) continue;
      const a = Math.floor(st.rand() * n), b = Math.floor(st.rand() * n);
      if (a === b) continue;
      const ia = row[a], ib = row[b];
      if ((ia >= 0 && st.items[ia].kind !== "common") || (ib >= 0 && st.items[ib].kind !== "common") || (ia < 0 && ib < 0)) continue;
      const ts = new Set<string>();
      if (ia >= 0) ts.add(st.items[ia].teacher);
      if (ib >= 0) ts.add(st.items[ib].teacher);
      const days = new Set([st.slots[g][a].d, st.slots[g][b].d]);
      const measure = () => { let s = 0; for (const t of ts) for (const d of days) s += st.tdPen(t, d); for (const d of days) s += st.cdPen(g, c, d); return s; };
      const before = measure();
      const swap = () => {
        const x = row[a], y = row[b];
        if (x >= 0) st.addItemBusy(x, a, -1);
        if (y >= 0) st.addItemBusy(y, b, -1);
        row[a] = y; row[b] = x;
        if (y >= 0) st.addItemBusy(y, a, 1);
        if (x >= 0) st.addItemBusy(x, b, 1);
      };
      swap();
      delta = measure() - before;
      undo = swap;
    }

    if (delta <= 0 || st.rand() < Math.exp(-delta / T)) {
      cur += delta;
      if (cur < best) { best = cur; bestSnap = st.snapshot(); bestDirty = true; }
    } else undo?.();
  }

  bestDirty = true;
  offerBest();
  st.restore(bestSnap);
  const bestSolution = st.decode(best >= H);
  report("improve");
  const results = collector.results;
  return {
    stopReason: reason,
    results,
    bestIncomplete: results.length ? null : collector.bestIncomplete,
    lowerBound,
    checkpoint: { kind: "search", best: bestSolution, results, elapsedMs: now(), lowerBound, seed: Math.floor(st.rand() * 2 ** 31) },
    iterations: it,
    segmentMs: Date.now() - t0,
  };
}
