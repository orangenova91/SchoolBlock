import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TeacherForbiddenSlot, Weekday } from "@/lib/types";
import { diagnoseBound, diagnoseDataLimit, diagnoseFeasibility, diagnoseFixedLoss, diagnoseRelax } from "@/lib/v3/diagnose";
import { tinyInput } from "@/lib/v3/fixtures";
import { buildInstance } from "@/lib/v3/instance";
import { quickCheck } from "@/lib/v3/quick-check";

/**
 * 세기로는 못 잡는 배치 불가:
 * 국어·수학 교사가 1반만 4시간씩 맡고, 둘 다 같은 4칸(월 1~3, 화 1)에만 수업할 수 있다.
 * 교사마다 보면 4시간 = 4칸이라 괜찮아 보이지만, 같은 반이라 둘이 같은 4칸을 나눠야 해서 4시간이 남는다.
 */
function crowdedInput() {
  const open = new Set(["mon|1", "mon|2", "mon|3", "tue|1"]);
  const forbidden: TeacherForbiddenSlot[] = [];
  for (const t of ["김국어", "이수학"]) for (const day of ["mon", "tue", "wed", "thu", "fri"] as Weekday[]) for (let p = 1; p <= 3; p++) {
    if (!open.has(`${day}|${p}`)) forbidden.push({ teacherName: t, day, period: p });
  }
  const input = tinyInput({ forbidden });
  input.teachers[0].assignments[1][0] = { name: "국어", classHours: [4, 0], hours: 4 };
  input.teachers[1].assignments[1][0] = { name: "수학", classHours: [4, 0], hours: 4 };
  return input;
}

describe("v3 진단", () => {
  it("배치 가능: 탐색이 찾은 완성본으로 증명", async () => {
    const input = tinyInput({ rotated: true });
    const r = await diagnoseFeasibility({ input, inst: buildInstance(input), budgetMs: 20_000 });
    assert.equal(r.status, "feasible");
    assert.equal(r.proof, "example");
    assert.ok(r.solution);
  });

  it("세기로 확정되는 배치 불가는 바로 답한다", async () => {
    const input = tinyInput({ koreanHours: 7 });
    const r = await diagnoseFeasibility({ input, inst: buildInstance(input), budgetMs: 20_000 });
    assert.equal(r.status, "infeasible");
    assert.equal(r.proof, "count");
    assert.ok(r.elapsedMs < 1000);
  });

  it("세기로 못 잡는 배치 불가는 정확 계산으로 최소 미배치를 증명한다", async () => {
    const input = crowdedInput();
    const inst = buildInstance(input);
    const q = quickCheck(inst);
    assert.equal(q.minUnplaced, 0);
    assert.equal(q.blocking, false);
    const r = await diagnoseFeasibility({ input, inst, budgetMs: 20_000 });
    assert.equal(r.status, "infeasible");
    assert.equal(r.proof, "exact");
    assert.deepEqual(r.minUnplaced, { lo: 4, hi: 4, exact: true });
    assert.equal(r.leftLessons.reduce((a, x) => a + x.hours, 0), 4);
  });

  it("원인 찾기: 가장 적게 풀어야 하는 배정 불가 칸을 낸다", async () => {
    const input = crowdedInput();
    const r = await diagnoseRelax({ input, inst: buildInstance(input), budgetMs: 20_000 });
    assert.equal(r.status, "found");
    assert.equal(r.minimal, true);
    assert.equal(r.items.length, 4);
    assert.ok(r.items.every((x) => x.kind === "forbidden"));
  });

  it("원인 찾기: 배정 불가·선 수업을 풀어도 안 되면 교사·반 부족을 알려 준다", async () => {
    const input = tinyInput({ koreanHours: 7 });
    const r = await diagnoseRelax({ input, inst: buildInstance(input), budgetMs: 20_000 });
    assert.equal(r.status, "none");
    assert.ok(r.structural.length > 0);
  });

  it("고정의 영향: 고정 조건의 최선은 고정 없는 최선보다 나쁠 수 없다", async () => {
    const input = tinyInput({ rotated: true, fixed: [{ day: "mon", period: 3 }, { day: "tue", period: 3 }] });
    const r = await diagnoseFixedLoss({ input, inst: buildInstance(input), budgetMs: 30_000 });
    assert.equal(r.nothingFixed, false);
    assert.ok(r.withFixed.hi !== null && r.withoutFixed.hi !== null);
    assert.ok(r.withFixed.hi! >= r.withoutFixed.lo);
    assert.ok(r.loss.lo >= 0);
  });

  it("데이터 한계: 항목별 최소값과 점심 연강 세기 하한 (세기 ≤ 정확 최소)", async () => {
    const input = tinyInput({ rotated: true });
    const r = await diagnoseDataLimit({ input, inst: buildInstance(input), budgetMs: 30_000 });
    assert.equal(r.lunch.skipped, false);
    assert.ok(r.lunch.min.exact);
    assert.ok(r.lunch.count.bound <= r.lunch.min.lo);
  });

  it("이론상 최선: 항목별 최소의 합을 먼저 하한으로 쓰고, 전체 계산과 합쳐 최선을 증명한다", async () => {
    const input = tinyInput({ rotated: true });
    const inst = buildInstance(input);
    const seen: number[] = [];
    const r = await diagnoseBound({ input, inst, budgetMs: 30_000, onBound: (lb) => seen.push(lb) });
    assert.ok(r.items?.lunch, JSON.stringify(r));
    const sum = (["lunch", "triple", "sameDay"] as const).reduce((a, k) => a + (r.items?.[k]?.min ?? 0) * inst.weights[k], 0);
    assert.equal(r.itemSum, sum);
    assert.ok(r.lowerBound !== null && r.lowerBound >= sum);
    assert.equal(r.proven, true);
    // 알린 하한은 늘 오르기만 한다
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  });
});
