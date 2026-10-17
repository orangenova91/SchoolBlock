import assert from "node:assert/strict";
import { describe, it } from "node:test";
import loadHighs from "highs";
import type { TimetableCell } from "@/lib/types";
import { tinyInput } from "@/lib/v3/fixtures";
import { effectiveWeights, v3InputHash } from "@/lib/v3/input";
import { buildInstance, setDayBounds } from "@/lib/v3/instance";
import { buildModel, decodeSolution, encodeSolution, type V3Model } from "@/lib/v3/model";
import { quickCheck } from "@/lib/v3/quick-check";
import { cellSignature, isDistinct, TopResults } from "@/lib/v3/results";
import { judge, nearThreshold, strictThreshold } from "@/lib/v3/score";
import { validateSolution, type V3Solution } from "@/lib/v3/validate";

async function solve(m: V3Model, seconds = 30) {
  const highs = await loadHighs();
  const model = highs.createModel({
    numCols: m.numCols, numRows: m.numRows, colCost: m.cost, colLower: m.lower, colUpper: m.upper,
    rowLower: m.rowLower, rowUpper: m.rowUpper, integrality: m.integrality,
    matrix: { format: "csr", numRows: m.numRows, numCols: m.numCols, starts: m.starts, indices: m.indices, values: m.values },
  } as never);
  try {
    model.options.set({ output_flag: false, time_limit: seconds, mip_rel_gap: 0 });
    model.run();
    return { status: model.getModelStatus(), x: Float64Array.from(model.getSolution().colValue), objective: model.getObjectiveValue() };
  } finally {
    model.dispose();
  }
}

describe("v3 입력 지문", () => {
  it("선 수업·배정 불가 순서가 달라도 같은 지문", () => {
    const pins = [
      { grade: 1 as const, classNo: 1, day: "mon" as const, period: 1, subjectName: "국어", teacherName: "김국어" },
      { grade: 1 as const, classNo: 2, day: "tue" as const, period: 2, subjectName: "수학", teacherName: "이수학" },
    ];
    assert.equal(v3InputHash(tinyInput({ pins })), v3InputHash(tinyInput({ pins: [...pins].reverse() })));
  });
  it("반별 시수 순서가 바뀌면 다른 지문", () => {
    const a = tinyInput();
    const b = structuredClone(a);
    a.teachers[0].assignments[1][0].classHours = [5, 3];
    b.teachers[0].assignments[1][0].classHours = [3, 5];
    assert.notEqual(v3InputHash(a), v3InputHash(b));
  });
  it("추가 조건에서 끈 항목은 중요도 0", () => {
    const input = tinyInput();
    input.preferences.avoidTriplePeriod = false;
    assert.deepEqual(effectiveWeights(input), { lunch: 3, triple: 0, sameDay: 3 });
  });
});

describe("H12 같은 SET 요일 배분 (층층이 채우기)", () => {
  const inst = buildInstance(tinyInput());
  const bounds = (units: number, fixed: { day: "mon" | "tue" | "wed" | "thu" | "fri"; period: number }[] = []) =>
    Object.fromEntries([...setDayBounds(inst, { ...inst.sets[0], units, fixed })].map(([d, b]) => [d, [b.lo, b.hi]]));
  it("주 3회, 고정 없음 → 요일마다 0~1회", () => {
    assert.deepEqual(bounds(3), { mon: [0, 1], tue: [0, 1], wed: [0, 1], thu: [0, 1], fri: [0, 1] });
  });
  it("주 3회, 화요일 2회 고정 → 화요일은 그대로 2회, 다른 요일 0~1회", () => {
    assert.deepEqual(bounds(3, [{ day: "tue", period: 1 }, { day: "tue", period: 3 }]), { mon: [0, 1], tue: [2, 2], wed: [0, 1], thu: [0, 1], fri: [0, 1] });
  });
  it("주 7회 → 모든 요일 1회 이상 2회 이하", () => {
    assert.deepEqual(new Set(Object.values(bounds(7)).map(String)), new Set(["1,2"]));
  });
  it("주 11회 → 모든 요일 2회 이상 3회 이하", () => {
    assert.deepEqual(new Set(Object.values(bounds(11)).map(String)), new Set(["2,3"]));
  });
});

describe("점수와 목표 판정", () => {
  it("근접 기준: 10%와 6점 중 너그러운 쪽", () => {
    assert.equal(nearThreshold(24), 30);
    assert.equal(nearThreshold(52), 58);
    assert.equal(nearThreshold(100), 110);
    assert.equal(strictThreshold(24), 27);
    assert.equal(strictThreshold(100), 105);
  });
  it("판정", () => {
    const m = (score: number, unplaced = 0) => ({ unplaced, lunch: 0, triple: 0, sameDay: 0, score });
    assert.deepEqual(judge(m(30), { lower: 24, proven: true }), { complete: true, near: true, strict: false, optimal: false, gapToNear: 0, threshold: 30 });
    assert.equal(judge(m(34), { lower: 24, proven: true }).gapToNear, 4);
    assert.equal(judge(m(24), { lower: 24, proven: false }).optimal, true);
    assert.equal(judge(m(24, 1), { lower: 24, proven: true }).near, false);
    assert.equal(judge(m(24), { lower: null, proven: false }).near, null);
  });
});

describe("상위 3개 결과", () => {
  const base = new Map(Array.from({ length: 200 }, (_, i) => [`c${i}`, "x"]));
  const variant = (n: number, tag: string) => new Map([...base].map(([k, v], i) => [k, i < n ? `${tag}${i}` : v]));
  it("30칸·5% 이상 달라야 다른 결과", () => {
    assert.equal(isDistinct(base, variant(10, "a")), false);
    assert.equal(isDistinct(base, variant(40, "a")), true);
  });
  it("비슷하면 같거나 좋을 때만 대신하고, 더 좋은 결과는 잃지 않는다", () => {
    const top = new TopResults<string>();
    top.offer({ score: 30, signature: base, foundAtMs: 1, payload: "A" });
    assert.equal(top.offer({ score: 31, signature: variant(10, "a"), foundAtMs: 2, payload: "A-worse" }), false);
    // 같은 점수의 비슷한 결과는 바꿔 끼우지만 "나아짐"은 아니다
    assert.equal(top.offer({ score: 30, signature: variant(10, "b"), foundAtMs: 3, payload: "A-same" }), false);
    assert.deepEqual(top.list.map((r) => r.payload), ["A-same"]);
    top.offer({ score: 35, signature: variant(60, "c"), foundAtMs: 4, payload: "B" });
    top.offer({ score: 40, signature: variant(120, "d"), foundAtMs: 5, payload: "C" });
    top.offer({ score: 45, signature: variant(200, "e"), foundAtMs: 6, payload: "D" });
    assert.deepEqual(top.list.map((r) => r.payload), ["A-same", "B", "C"]);
    assert.equal(top.fullAtOrBelow(40), true);
  });
  it("시간표 칸 서명", () => {
    const cells: TimetableCell[] = [{ grade: 1, classNo: 1, day: "mon", period: 1, subjectName: "국어", teacherName: "김국어", kind: "common" }];
    assert.equal(cellSignature(cells).get("1|1|mon|1"), "국어|김국어");
  });
});

describe("빠른 검사", () => {
  it("학년 전체 SET 밖 칸보다 많은 교사 수업 → 확정 부족", () => {
    // 1학년 칸 15, SET 2회 → SET 밖 13칸. 국어 교사는 두 반 7시간씩 = 14시간
    const r = quickCheck(buildInstance(tinyInput({ koreanHours: 7 })));
    const w = r.warnings.find((x) => x.rule === "teacherGrade" && x.severity === "error");
    assert.ok(w, JSON.stringify(r.warnings));
    assert.equal(w.need - w.have, 1);
    assert.ok(r.minUnplaced >= 1);
  });
  it("고정 SET과 겹친 선 수업은 빼지 않고 오류로 막는다 (v1·v2와 다름: 정확한 완성)", async () => {
    const inst = buildInstance(tinyInput({
      fixed: [{ day: "mon", period: 1 }],
      pins: [{ grade: 1, classNo: 1, day: "mon", period: 1, subjectName: "국어", teacherName: "김국어" }],
    }));
    assert.equal(inst.pinConflicts.length, 1);
    assert.equal(inst.pins.length, 1);
    const r = quickCheck(inst);
    assert.ok(r.blocking);
    assert.ok(r.warnings.some((w) => w.rule === "pinConflict" && w.severity === "error"));
    assert.equal((await solve(buildModel(inst))).status, 8);
  });
  it("문제없는 입력은 확정 부족 없음", () => {
    const r = quickCheck(buildInstance(tinyInput()));
    assert.equal(r.minUnplaced, 0);
    assert.equal(r.blocking, false);
  });
});

describe("모델과 검증기", () => {
  it("정수계획 해를 시간표로 바꾸면 검증기를 통과하고, 모델 목적값 = 검증기 점수", async () => {
    const input = tinyInput({ rotated: true, fixed: [{ day: "wed", period: 3 }] });
    const inst = buildInstance(input);
    const m = buildModel(inst);
    const r = await solve(m);
    assert.equal(r.status, 7);
    const sol = decodeSolution(inst, m, r.x);
    const v = validateSolution(input, inst, sol);
    assert.equal(v.ok, true, JSON.stringify(v.violations));
    assert.ok(Math.abs(v.metrics.score - r.objective) < 1e-6, `${v.metrics.score} vs ${r.objective}`);
    assert.ok(sol.occurrences.some((o) => o.day === "wed" && o.period === 3), "고정 회차 유지");
    // 순환: 두 교사가 1회씩
    const phys = sol.occurrences.map((o) => o.bySubject["A물리"][0]).sort();
    assert.deepEqual(phys, ["정물리", "최물리"].sort());
    // 해 → 변수 → 해 왕복
    const x2 = encodeSolution(inst, m, sol);
    assert.deepEqual(decodeSolution(inst, m, x2).cells.length, sol.cells.length);
  });

  it("같은 회차에서 한 교사가 두 과목을 맡으면 교사 겹침(H3)·담당 오류(H10)", async () => {
    const input = tinyInput({ rotated: true });
    const inst = buildInstance(input);
    const m = buildModel(inst);
    const sol: V3Solution = decodeSolution(inst, m, (await solve(m)).x);
    sol.occurrences[0].bySubject["A물리"] = ["한화학"];
    const codes = new Set(validateSolution(input, inst, sol).violations.map((x) => x.code));
    assert.ok(codes.has("H3") && codes.has("H10"), [...codes].join(","));
  });

  it("같은 SET을 같은 날 두 번 두면 H12, 수업을 빼면 미배치", async () => {
    const input = tinyInput();
    const inst = buildInstance(input);
    const m = buildModel(inst);
    const sol = decodeSolution(inst, m, (await solve(m)).x);
    const [a, b] = sol.occurrences;
    const moveTo = a.day;
    for (const c of sol.cells) if (c.kind === "set" && c.day === b.day && c.period === b.period) c.day = moveTo;
    b.day = moveTo;
    const removed = sol.cells.findIndex((c) => c.kind === "common");
    sol.cells.splice(removed, 1);
    const v = validateSolution(input, inst, sol);
    assert.ok(v.violations.some((x) => x.code === "H12"), JSON.stringify(v.violations));
    assert.equal(v.unplaced, 1);
    assert.equal(v.ok, false);
  });

  it("배정 불가를 지키지 못하는 고정 SET은 모델이 불가로 판정", async () => {
    const input = tinyInput({ fixed: [{ day: "mon", period: 1 }], forbidden: [{ teacherName: "한화학", day: "mon", period: 1 }] });
    const inst = buildInstance(input);
    assert.ok(quickCheck(inst).warnings.some((w) => w.rule === "fixedConflict"));
    assert.equal((await solve(buildModel(inst))).status, 8);
  });
});
