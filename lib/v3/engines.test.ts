import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import type { EngineCheckpoint, EngineRun } from "@/lib/v3/engines/types";
import { tinyInput } from "@/lib/v3/fixtures";
import { buildInstance } from "@/lib/v3/instance";
import { validateSolution } from "@/lib/v3/validate";

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

  it("사용자 중지 요청은 바로 처리한다", () => {
    const out = runSearch(base({ budgetMs: 60_000, shouldStop: () => true }));
    assert.equal(out.stopReason, "user");
    assert.ok(out.segmentMs < 5000);
  });

  it("하한을 알면 최선에 닿은 뒤 서로 다른 결과를 모으고 일찍 끝난다", () => {
    const out = runSearch(base({ budgetMs: 60_000, lowerBound: optimum }));
    assert.equal(out.stopReason, "early");
    assert.ok(out.segmentMs < 45_000, `${out.segmentMs}ms`);
  });
});
