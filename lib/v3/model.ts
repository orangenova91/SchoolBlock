/**
 * v3 정수계획 모델 (docs/v3-model-spec.md H1~H12, S1~S3).
 * HiGHS(JS)에 그대로 넘길 수 있는 희소 행렬(CSR) 형태로 만든다.
 *
 * 변수
 *   x  공통 수업 묶음 g를 (요일, 교시)에 1시간
 *   y  SET k의 회차를 (요일, 교시)에 (고정 회차는 하한 1)
 *   z  순환 과목의 회차별 담당 교사 (지정된 것은 하한 1)
 *   u  미배치 시간 (slack 모드: 1시간 = 1000점. 불완전한 시작 해를 받아 고치거나 최소 미배치를 셀 때)
 *   L/T/S  점심 연강·3연강·동일 교과 지표
 *   R  완화 모드: 풀어야 하는 배정 불가 칸·선 수업 (1개 = 1점)
 */
import type { Grade, Weekday } from "@/lib/types";
import type { V3Weights } from "@/lib/v3/input";
import { banKey, setDayBounds, slotKey, type V3Instance } from "@/lib/v3/instance";
import type { V3Occurrence, V3Solution } from "@/lib/v3/validate";

export const UNPLACED_COST = 1000;

export type ModelOptions = {
  /** 미배치 허용 (시간당 1000점) */
  slack?: boolean;
  /** 원인 찾기: 배정 불가 칸·선 수업을 풀 수 있는 조건으로 (선호 점수는 0) */
  relax?: boolean;
  /** 점수 중요도를 바꿔 계산 (예: 배치 가능 판정은 0, 점심 연강 최소화는 lunch만) */
  weights?: V3Weights;
};

export type ColKind = "x" | "y" | "z" | "u" | "L" | "T" | "S" | "R";

export type V3Model = {
  numCols: number;
  numRows: number;
  cost: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  integrality: Int32Array;
  rowLower: Float64Array;
  rowUpper: Float64Array;
  /** CSR: 행 i 의 계수는 indices/values[starts[i] .. starts[i+1]) */
  starts: Int32Array;
  indices: Int32Array;
  values: Float64Array;
  kind: ColKind[];
  /** x: 묶음 번호 / y·z: SET 번호 / u: 묶음 번호 / R: 설명 번호 */
  ref: Int32Array;
  /** z: 과목 번호, 교사 번호 */
  ref2: Int32Array;
  ref3: Int32Array;
  day: (Weekday | null)[];
  period: Int32Array;
  grade: (Grade | null)[];
  /** R 변수 설명 (완화 모드) */
  relaxLabels: string[];
};

class Builder {
  cost: number[] = [];
  lower: number[] = [];
  upper: number[] = [];
  integ: number[] = [];
  kind: ColKind[] = [];
  ref: number[] = [];
  ref2: number[] = [];
  ref3: number[] = [];
  day: (Weekday | null)[] = [];
  period: number[] = [];
  grade: (Grade | null)[] = [];
  rows: { cols: number[]; vals: number[]; lo: number; hi: number }[] = [];

  col(k: ColKind, o: { lo?: number; hi?: number; integer?: boolean; cost?: number; ref?: number; ref2?: number; ref3?: number; day?: Weekday | null; period?: number; grade?: Grade | null }): number {
    this.cost.push(o.cost ?? 0);
    this.lower.push(o.lo ?? 0);
    this.upper.push(o.hi ?? 1);
    this.integ.push(o.integer === false ? 0 : 1);
    this.kind.push(k);
    this.ref.push(o.ref ?? -1);
    this.ref2.push(o.ref2 ?? -1);
    this.ref3.push(o.ref3 ?? -1);
    this.day.push(o.day ?? null);
    this.period.push(o.period ?? 0);
    this.grade.push(o.grade ?? null);
    return this.cost.length - 1;
  }

  row(terms: Map<number, number>, lo: number, hi: number) {
    const cols = [...terms.keys()];
    this.rows.push({ cols, vals: cols.map((c) => terms.get(c)!), lo, hi });
  }
}

const sum = (cols: number[], coef = 1) => new Map(cols.map((c) => [c, coef]));

export function buildModel(inst: V3Instance, opts: ModelOptions = {}): V3Model {
  const b = new Builder();
  const W = opts.relax ? { lunch: 0, triple: 0, sameDay: 0 } : (opts.weights ?? inst.weights);
  const lap = inst.lunchAfter;
  const maxP = new Map(inst.days.map((d) => [d, Math.max(...([1, 2, 3] as Grade[]).map((g) => inst.periods[g][d] ?? 0))]));
  const forbidden = opts.relax ? new Set<string>() : inst.forbidden;
  const relaxLabels: string[] = [];
  const relaxCol = (label: string) => { relaxLabels.push(label); return b.col("R", { cost: 1, ref: relaxLabels.length - 1 }); };

  // 고정 점유 (선 수업: relax 모드에서는 옮길 수 있는 수업으로 바뀜)
  const classFixed = new Set<string>();
  const teachConst = new Map<string, number>();
  if (!opts.relax) {
    for (const p of inst.pins) {
      classFixed.add(`${p.grade}|${p.classNo}|${p.day}|${p.period}`);
      teachConst.set(slotKey(p.teacher, p.day, p.period), 1);
    }
  }

  // ── SET: y, z ──
  const classSet = new Map<string, number[]>();
  const setBusy = new Map<string, number[]>();
  const addTo = (m: Map<string, number[]>, k: string, c: number) => { const l = m.get(k); if (l) l.push(c); else m.set(k, [c]); };
  inst.sets.forEach((s, k) => {
    const g = s.grade;
    const ys = new Map<string, number>();
    for (const d of inst.days) for (let p = 1; p <= (inst.periods[g][d] ?? 0); p++) {
      const fixed = s.fixed.some((f) => f.day === d && f.period === p);
      ys.set(`${d}|${p}`, b.col("y", { ref: k, day: d, period: p, grade: g, lo: fixed ? 1 : 0 }));
    }
    b.row(sum([...ys.values()]), s.units, s.units); // H6
    for (const [d, bd] of setDayBounds(inst, s)) { // H12
      const cols = [...ys.entries()].filter(([key]) => key.startsWith(`${d}|`)).map(([, c]) => c);
      b.row(sum(cols), bd.lo, bd.hi);
    }
    for (const [key, c] of ys) {
      const [d, p] = key.split("|");
      if (s.rooms.some((r) => classFixed.has(`${g}|${r}|${d}|${p}`))) b.row(sum([c]), 0, 0); // 선 수업 칸
      for (const r of s.rooms) addTo(classSet, `${g}|${r}|${d}|${p}`, c);
    }
    s.subjects.forEach((subj, j) => {
      if (!subj.rotated) {
        for (const t of subj.teachers) for (const [key, c] of ys) {
          const [d, ps] = key.split("|") as [Weekday, string];
          const sk = slotKey(t.name, d, Number(ps));
          if (forbidden.has(sk)) b.row(sum([c]), 0, 0); // H4
          else if (opts.relax && inst.forbidden.has(sk)) { const r = relaxCol(`배정 불가|${t.name}|${d}|${ps}`); b.row(new Map([[c, 1], [r, -1]]), -Infinity, 0); }
          addTo(setBusy, sk, c);
        }
        return;
      }
      const zs = new Map<string, number>();
      subj.teachers.forEach((t, i) => {
        for (const [key, yc] of ys) {
          const [d, ps] = key.split("|") as [Weekday, string];
          const p = Number(ps);
          const sk = slotKey(t.name, d, p);
          const assigned = s.assigned.find((a) => a.day === d && a.period === p && a.subject === subj.name);
          const hi = forbidden.has(sk) || (assigned && assigned.teacher !== t.name) ? 0 : 1;
          const z = b.col("z", { ref: k, ref2: j, ref3: i, day: d, period: p, grade: g, hi });
          if (opts.relax && inst.forbidden.has(sk)) { const r = relaxCol(`배정 불가|${t.name}|${d}|${p}`); b.row(new Map([[z, 1], [r, -1]]), -Infinity, 0); }
          zs.set(`${i}|${key}`, z);
          b.row(new Map([[z, 1], [yc, -1]]), -Infinity, 0); // 담당은 회차가 있을 때만
          addTo(setBusy, sk, z);
        }
        b.row(sum(subj.teachers.length ? [...ys.keys()].map((key) => zs.get(`${i}|${key}`)!) : []), t.hours, t.hours); // 교사별 맡는 회차 수
      });
      for (const [key, yc] of ys) { // 회차마다 담당 1명
        const terms = new Map(subj.teachers.map((_, i) => [zs.get(`${i}|${key}`)!, 1]));
        terms.set(yc, -1);
        b.row(terms, 0, 0);
      }
    });
  });

  // ── 공통 수업: x (relax 모드에서는 선 수업을 묶음에 되돌려 옮길 수 있게) ──
  const groups = inst.groups.map((g) => ({ ...g }));
  const pinOf: { gi: number; day: Weekday; period: number; label: string }[] = [];
  if (opts.relax) {
    const gix = new Map(groups.map((g, i) => [`${g.teacher}|${g.grade}|${g.classNo}|${g.subject}`, i]));
    for (const p of inst.pins) {
      const key = `${p.teacher}|${p.grade}|${p.classNo}|${p.subject}`;
      if (!gix.has(key)) { gix.set(key, groups.length); groups.push({ teacher: p.teacher, grade: p.grade, classNo: p.classNo, subject: p.subject, hours: 0 }); }
      groups[gix.get(key)!].hours++;
      pinOf.push({ gi: gix.get(key)!, day: p.day, period: p.period, label: `선 수업|${p.teacher}|${p.grade}-${p.classNo}|${p.subject}|${p.day}|${p.period}` });
    }
  }
  const xByGroup: Map<string, number>[] = [];
  const classX = new Map<string, number[]>();
  const teachX = new Map<string, number[]>();
  groups.forEach((gr, gi) => {
    const cols = new Map<string, number>();
    for (const d of inst.days) for (let p = 1; p <= (inst.periods[gr.grade][d] ?? 0); p++) {
      const sk = slotKey(gr.teacher, d, p);
      if (classFixed.has(`${gr.grade}|${gr.classNo}|${d}|${p}`) || teachConst.has(sk) || forbidden.has(sk)) continue;
      const c = b.col("x", { ref: gi, day: d, period: p, grade: gr.grade });
      cols.set(`${d}|${p}`, c);
      addTo(classX, `${gr.grade}|${gr.classNo}|${d}|${p}`, c);
      addTo(teachX, sk, c);
      if (opts.relax && inst.forbidden.has(sk)) { const r = relaxCol(`배정 불가|${gr.teacher}|${d}|${p}`); b.row(new Map([[c, 1], [r, -1]]), -Infinity, 0); }
    }
    xByGroup.push(cols);
    const terms = sum([...cols.values()]);
    if (opts.slack) terms.set(b.col("u", { ref: gi, hi: gr.hours, cost: UNPLACED_COST, grade: gr.grade }), 1);
    b.row(terms, gr.hours, gr.hours); // H1
  });
  for (const pin of pinOf) { // 선 수업: 원래 칸에 두거나, 풀어서(1점) 옮긴다
    const c = xByGroup[pin.gi].get(`${pin.day}|${pin.period}`);
    const r = relaxCol(pin.label);
    if (c !== undefined) b.row(new Map([[c, 1], [r, 1]]), 1, Infinity);
    else b.row(sum([r]), 1, 1);
  }

  // H2 반 한 칸 한 수업
  for (const key of new Set([...classX.keys(), ...classSet.keys()])) {
    const terms = new Map<number, number>();
    for (const c of classX.get(key) ?? []) terms.set(c, (terms.get(c) ?? 0) + 1);
    for (const c of classSet.get(key) ?? []) terms.set(c, (terms.get(c) ?? 0) + 1);
    if (terms.size > 1) b.row(terms, 0, 1);
  }

  // H3 교사 한 칸 한 수업 + S1·S2
  const teachers = new Set<string>();
  for (const k of [...teachX.keys(), ...setBusy.keys(), ...teachConst.keys()]) teachers.add(k.split("|")[0]);
  const busy = (t: string, d: Weekday, p: number) => {
    const sk = slotKey(t, d, p);
    const terms = new Map<number, number>();
    for (const c of teachX.get(sk) ?? []) terms.set(c, (terms.get(c) ?? 0) + 1);
    for (const c of setBusy.get(sk) ?? []) terms.set(c, (terms.get(c) ?? 0) + 1);
    return { terms, k: teachConst.get(sk) ?? 0 };
  };
  for (const t of teachers) for (const d of inst.days) {
    for (let p = 1; p <= maxP.get(d)!; p++) {
      const { terms, k } = busy(t, d, p);
      if (terms.size) b.row(terms, -Infinity, 1 - k);
    }
    if (W.lunch > 0 && maxP.get(d)! >= lap + 1) {
      const a = busy(t, d, lap), c = busy(t, d, lap + 1);
      if (a.terms.size || c.terms.size || a.k + c.k >= 2) {
        const v = b.col("L", { integer: false, cost: W.lunch, day: d });
        const terms = new Map<number, number>([[v, -1]]);
        for (const [col, n] of [...a.terms, ...c.terms]) terms.set(col, (terms.get(col) ?? 0) + n);
        b.row(terms, -Infinity, 1 - a.k - c.k);
      }
    }
    if (W.triple > 0) {
      for (let s = 1; s <= maxP.get(d)! - 2; s++) {
        if (s === lap || s + 1 === lap) continue; // 점심을 걸치면 3연강 아님
        const parts = [busy(t, d, s), busy(t, d, s + 1), busy(t, d, s + 2)];
        const k = parts.reduce((a, x) => a + x.k, 0);
        if (!parts.some((x) => x.terms.size) && k < 3) continue;
        const v = b.col("T", { integer: false, cost: W.triple, day: d, period: s });
        const terms = new Map<number, number>([[v, -1]]);
        for (const x of parts) for (const [col, n] of x.terms) terms.set(col, (terms.get(col) ?? 0) + n);
        b.row(terms, -Infinity, 2 - k);
      }
    }
  }

  // S3 동일 교과 같은 날: (반, 과목, 요일) 묶음에서 2시간 이상이면 1건
  if (W.sameDay > 0) {
    const pinCount = new Map<string, number>();
    for (const p of inst.pins) { const k = `${p.grade}|${p.classNo}|${p.subject}|${p.day}`; pinCount.set(k, (pinCount.get(k) ?? 0) + 1); }
    const byCS = new Map<string, number[]>();
    groups.forEach((gr, gi) => { if (inst.bans.has(banKey(gr.grade, gr.subject))) addTo(byCS, `${gr.grade}|${gr.classNo}|${gr.subject}`, gi); });
    for (const [key, gis] of byCS) for (const d of inst.days) {
      const cols: number[] = [];
      for (const gi of gis) for (const [dp, c] of xByGroup[gi]) if (dp.startsWith(`${d}|`)) cols.push(c);
      const k = opts.relax ? 0 : pinCount.get(`${key}|${d}`) ?? 0;
      if (!cols.length && k < 2) continue;
      const big = cols.length + k;
      const v = b.col("S", { cost: W.sameDay, day: d });
      const terms = sum(cols);
      terms.set(v, -(big - 1));
      b.row(terms, -Infinity, 1 - k);
    }
  }

  // CSR
  const starts = new Int32Array(b.rows.length + 1);
  let nnz = 0;
  b.rows.forEach((r, i) => { starts[i] = nnz; nnz += r.cols.length; });
  starts[b.rows.length] = nnz;
  const indices = new Int32Array(nnz), values = new Float64Array(nnz);
  let at = 0;
  for (const r of b.rows) for (let j = 0; j < r.cols.length; j++) { indices[at] = r.cols[j]; values[at] = r.vals[j]; at++; }
  return {
    numCols: b.cost.length,
    numRows: b.rows.length,
    cost: Float64Array.from(b.cost),
    lower: Float64Array.from(b.lower),
    upper: Float64Array.from(b.upper),
    integrality: Int32Array.from(b.integ),
    rowLower: Float64Array.from(b.rows, (r) => r.lo),
    rowUpper: Float64Array.from(b.rows, (r) => r.hi),
    starts,
    indices,
    values,
    kind: b.kind,
    ref: Int32Array.from(b.ref),
    ref2: Int32Array.from(b.ref2),
    ref3: Int32Array.from(b.ref3),
    day: b.day,
    period: Int32Array.from(b.period),
    grade: b.grade,
    relaxLabels,
  };
}

/** 모델 해(0/1 벡터)를 시간표 한 벌로 바꾼다 (relax 모드 해는 지원하지 않음). */
export function decodeSolution(inst: V3Instance, m: V3Model, x: ArrayLike<number>): V3Solution {
  const cells: V3Solution["cells"] = [];
  for (const p of inst.pins) cells.push({ grade: p.grade, classNo: p.classNo, day: p.day, period: p.period, subjectName: p.subject, teacherName: p.teacher, kind: "common" });
  const occ = new Map<string, V3Occurrence>();
  const zPick = new Map<string, string>();
  for (let c = 0; c < m.numCols; c++) {
    if (x[c] < 0.5) continue;
    const kind = m.kind[c];
    if (kind === "x") {
      const g = inst.groups[m.ref[c]];
      cells.push({ grade: g.grade, classNo: g.classNo, day: m.day[c]!, period: m.period[c], subjectName: g.subject, teacherName: g.teacher, kind: "common" });
    } else if (kind === "y") {
      const s = inst.sets[m.ref[c]];
      occ.set(`${m.ref[c]}|${m.day[c]}|${m.period[c]}`, { grade: s.grade, set: s.set, day: m.day[c]!, period: m.period[c], bySubject: {} });
    } else if (kind === "z") {
      const s = inst.sets[m.ref[c]];
      const subj = s.subjects[m.ref2[c]];
      zPick.set(`${m.ref[c]}|${m.day[c]}|${m.period[c]}|${subj.name}`, subj.teachers[m.ref3[c]].name);
    }
  }
  for (const [key, o] of occ) {
    const k = Number(key.split("|")[0]);
    const s = inst.sets[k];
    for (const subj of s.subjects) {
      o.bySubject[subj.name] = subj.rotated
        ? [zPick.get(`${k}|${o.day}|${o.period}|${subj.name}`) ?? ""].filter(Boolean)
        : subj.teachers.map((t) => t.name);
    }
    for (const room of s.rooms) {
      const name = s.roomSubject[room];
      cells.push({ grade: s.grade, classNo: room, day: o.day, period: o.period, subjectName: name, teacherName: (o.bySubject[name] ?? []).join("·") || "—", kind: "set", set: s.set });
    }
  }
  return { cells, occurrences: [...occ.values()] };
}

/** 시간표 한 벌을 모델 변수 값으로 (시작 해·중단점용). 모델에 없는 배치는 빠지고, 그만큼 미배치(u)로 채운다. */
export function encodeSolution(inst: V3Instance, m: V3Model, sol: V3Solution): Float64Array {
  const x = new Float64Array(m.numCols);
  const index = new Map<string, number>();
  for (let c = 0; c < m.numCols; c++) {
    const kind = m.kind[c];
    if (kind === "x") index.set(`x|${m.ref[c]}|${m.day[c]}|${m.period[c]}`, c);
    else if (kind === "y") index.set(`y|${m.ref[c]}|${m.day[c]}|${m.period[c]}`, c);
    else if (kind === "z") index.set(`z|${m.ref[c]}|${m.ref2[c]}|${m.ref3[c]}|${m.day[c]}|${m.period[c]}`, c);
    else if (kind === "u") index.set(`u|${m.ref[c]}`, c);
  }
  const gix = new Map(inst.groups.map((g, i) => [`${g.teacher}|${g.grade}|${g.classNo}|${g.subject}`, i]));
  const placed = new Map<number, number>();
  const pinKeys = new Set(inst.pins.map((p) => `${p.grade}|${p.classNo}|${p.day}|${p.period}`));
  for (const c of sol.cells) {
    if (c.kind === "set" || pinKeys.has(`${c.grade}|${c.classNo}|${c.day}|${c.period}`)) continue;
    const gi = gix.get(`${c.teacherName}|${c.grade}|${c.classNo}|${c.subjectName}`);
    if (gi === undefined) continue;
    const col = index.get(`x|${gi}|${c.day}|${c.period}`);
    if (col === undefined || placed.get(gi) === inst.groups[gi].hours) continue;
    x[col] = 1;
    placed.set(gi, (placed.get(gi) ?? 0) + 1);
  }
  inst.groups.forEach((g, gi) => { const u = index.get(`u|${gi}`); if (u !== undefined) x[u] = g.hours - (placed.get(gi) ?? 0); });
  const sk = new Map(inst.sets.map((s, k) => [`${s.grade}|${s.set}`, k]));
  for (const o of sol.occurrences) {
    const k = sk.get(`${o.grade}|${o.set}`);
    if (k === undefined) continue;
    const y = index.get(`y|${k}|${o.day}|${o.period}`);
    if (y !== undefined) x[y] = 1;
    inst.sets[k].subjects.forEach((subj, j) => {
      if (!subj.rotated) return;
      const t = (o.bySubject[subj.name] ?? [])[0];
      const i = subj.teachers.findIndex((tt) => tt.name === t);
      const z = index.get(`z|${k}|${j}|${i}|${o.day}|${o.period}`);
      if (z !== undefined) x[z] = 1;
    });
  }
  return x;
}
