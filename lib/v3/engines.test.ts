import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import { StopRules } from "@/lib/v3/engines/stop-rules";
import type { Collector } from "@/lib/v3/engines/collector";
import type { EngineCheckpoint, EngineRun } from "@/lib/v3/engines/types";
import { tinyInput } from "@/lib/v3/fixtures";
import { buildInstance } from "@/lib/v3/instance";
import { scoreDetails, validateSolution } from "@/lib/v3/validate";

const input = tinyInput({ rotated: true, fixed: [{ day: "wed", period: 3 }] });
const inst = buildInstance(input);
const base = (over: Partial<EngineRun> = {}): EngineRun => ({ input, inst, budgetMs: 1500, seed: 7, ...over });
const allValid = (rs: { solution: Parameters<typeof validateSolution>[2] }[]) => rs.every((r) => validateSolution(input, inst, r.solution).ok);

describe("v3 엔진", () => {
  let optimum = Infinity;

  it("정수계획: 작은 학교는 최적과 하한을 함께 낸다", async () => {
    const out = await runMilp(base({ budgetMs: 20_000 }));
    assert.ok(out.results.length >= 1);
    assert.ok(allValid(out.results));
    optimum = out.results[0].metrics.score;
    assert.ok(out.lowerBound !== null && Math.ceil(out.lowerBound - 1e-6) === optimum, `lb ${out.lowerBound} vs ${optimum}`);
  });

  it("탐색: 결과는 모두 검증기를 통과하고, 작은 학교에서는 최적에 닿는다", () => {
    const out = runSearch(base({ budgetMs: 3000 }));
    assert.ok(out.results.length >= 1);
    assert.ok(allValid(out.results));
    assert.equal(out.results[0].metrics.score, optimum);
    // 고정 회차 유지
    assert.ok(out.results[0].solution.occurrences.some((o) => o.day === "wed" && o.period === 3));
  });

  it("점수 내역(어느 수업 때문인지)은 점수 계산과 건수가 같다", () => {
    const out = runSearch(base({ budgetMs: 1500 }));
    for (const r of out.results) {
      const d = scoreDetails(inst, r.solution);
      assert.deepEqual([d.lunch.length, d.triple.length, d.sameDay.length], [r.metrics.lunch, r.metrics.triple, r.metrics.sameDay]);
      for (const x of [...d.lunch, ...d.triple]) assert.ok(x.lessons.every((l) => /교시 .+/.test(l)), JSON.stringify(x));
    }
  });

  it("혼합: 결과는 모두 검증기를 통과한다", async () => {
    const out = await runHybrid(base({ budgetMs: 15_000 }));
    assert.ok(out.results.length >= 1);
    assert.ok(allValid(out.results));
    assert.ok(out.results[0].metrics.score <= optimum + 6);
  });

  it("중단점(JSON 저장 후 다시 읽기)에서 이어 가면 멈춘 점수에서 시작한다", () => {
    const first = runSearch(base({ budgetMs: 800 }));
    const saved: EngineCheckpoint = JSON.parse(JSON.stringify(first.checkpoint));
    const second = runSearch(base({ budgetMs: 800, checkpoint: saved, seed: 99 }));
    assert.ok(second.results[0].metrics.score <= first.results[0].metrics.score);
    assert.ok(second.checkpoint.elapsedMs >= first.checkpoint.elapsedMs + 700, "누적 시간 이어 감");
  });

  it("정수계획이 최선을 증명하면 '최선 증명'으로 끝나고, 중단점에서 다시 돌려도 바로 끝난다", async () => {
    const first = await runMilp(base({ budgetMs: 20_000 }));
    assert.ok(first.stopReason === "optimal" || first.stopReason === "early", first.stopReason);
    const saved: EngineCheckpoint = JSON.parse(JSON.stringify(first.checkpoint));
    const again = await runMilp(base({ budgetMs: 20_000, checkpoint: saved, assumeZeroBound: true }));
    assert.ok(again.stopReason === "optimal" || again.stopReason === "early", again.stopReason);
    assert.ok(again.segmentMs < 10_000, `${again.segmentMs}ms`);
  });

  it("조기 종료 규칙: 목표 안의 결과 3개가 모여야 끝나고, 진단은 끝내지 않는다", () => {
    const fake = (best: number | null, full: boolean) =>
      ({ bestScore: () => best, top: { fullAtOrBelow: () => full }, lastChangeMs: 0 }) as unknown as Collector;
    // 생성 작업: 하한을 모르면 0 기준(엄격 3점). 진단(하한 모름)은 끝내지 않음
    assert.equal(new StopRules().shouldStop(null, fake(0, true)), false);
    assert.equal(new StopRules({ assumeZero: true }).shouldStop(null, fake(0, true)), true);
    assert.equal(new StopRules({ assumeZero: true }).shouldStop(null, fake(10, true)), false);
    // 결과가 3개 모이지 않으면 오래 조용해도 끝내지 않음 (하나만 찾았다고 멈추지 않음)
    assert.equal(new StopRules({ assumeZero: true }).shouldStop(24, fake(24, false)), false);
    // 엄격 기준: 하한 24 → 27점 이하 3개면 끝
    assert.equal(new StopRules({ assumeZero: true }).shouldStop(24, fake(27, true)), true);
    // 최적해 목표: 하한과 같은 점수여야 함
    const optimal = new StopRules({ assumeZero: true, goal: "optimal" });
    assert.equal(optimal.target(24), 24);
    assert.equal(optimal.shouldStop(24, fake(27, true)), false);
    assert.equal(optimal.shouldStop(24, fake(24, true)), true);
    // 진단(exact)은 어떤 경우에도 일찍 끝내지 않음
    assert.equal(new StopRules({ exact: true }).shouldStop(24, fake(24, true)), false);
  });

  it("사용자 중지 요청은 바로 처리한다", () => {
    const out = runSearch(base({ budgetMs: 60_000, shouldStop: () => true }));
    assert.equal(out.stopReason, "user");
    assert.ok(out.segmentMs < 5000);
  });

  it("하한을 알아도 목표 안의 서로 다른 결과가 3개 모일 때만 일찍 끝나고, 아니면 구간 끝까지 계산한다", () => {
    const out = runSearch(base({ budgetMs: 4000, lowerBound: optimum, assumeZeroBound: true }));
    const inTarget = out.results.filter((r) => r.metrics.score <= optimum + 3).length;
    if (inTarget === 3) assert.equal(out.stopReason, "early");
    else {
      // 작은 학교는 서로 30칸 이상 다른 좋은 시간표가 3개 없을 수 있다 → 결과 1~2개로는 멈추지 않음
      assert.equal(out.stopReason, "budget");
      assert.ok(out.segmentMs >= 3500, `${out.segmentMs}ms`);
    }
  });
});
