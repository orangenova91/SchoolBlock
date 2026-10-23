import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goalAfterApproval, isBoundJob, jobFinishedForGood, nextStatusAfterSegment } from "@/lib/v3/jobs";

describe("v3 작업 상태 전이 (구간이 끝난 뒤)", () => {
  const job = (o: Partial<{ kind: "search" | "milp" | "hybrid" | "diagnose"; autoContinue: boolean; stopRequested: boolean }> = {}) =>
    ({ kind: "hybrid" as const, autoContinue: false, maxMs: 30 * 60_000, stopRequested: false, ...o });
  it("사전 승인이 꺼져 있으면 승인 대기", () => assert.equal(nextStatusAfterSegment(job(), 5 * 60_000, "budget"), "awaiting"));
  it("사전 승인이 켜져 있으면 다시 대기열로 (차례 돌리기)", () => assert.equal(nextStatusAfterSegment(job({ autoContinue: true }), 5 * 60_000, "budget"), "queued"));
  it("최대 시간을 다 쓰면 완료", () => assert.equal(nextStatusAfterSegment(job({ autoContinue: true }), 30 * 60_000, "budget"), "done"));
  it("조기 종료면 완료", () => assert.equal(nextStatusAfterSegment(job({ autoContinue: true }), 60_000, "early"), "done"));
  it("사용자 중지면 중지됨", () => assert.equal(nextStatusAfterSegment(job({ autoContinue: true }), 60_000, "user"), "stopped"));
  it("구간 중 중지 요청이 들어왔으면 중지됨", () => assert.equal(nextStatusAfterSegment(job({ stopRequested: true }), 60_000, "budget"), "stopped"));
  it("메모리 상한으로 끝난 구간은 이어 가기 대상", () => assert.equal(nextStatusAfterSegment(job({ autoContinue: true }), 60_000, "memory"), "queued"));
  it("불가 증명이면 불가", () => assert.equal(nextStatusAfterSegment(job(), 60_000, "infeasible"), "infeasible"));
  it("최선을 증명했으면 미리 승인이 켜져 있어도 완료 (다시 돌리지 않음)", () =>
    assert.equal(nextStatusAfterSegment(job({ kind: "milp", autoContinue: true }), 20_000, "optimal"), "done"));
});

describe("하한 계산 작업은 따로 센다 (같은 학기의 생성 작업과 동시에 돌 수 있음)", () => {
  it("하한 계산만 따로", () => {
    assert.equal(isBoundJob({ kind: "diagnose", diagnose: "bound" }), true);
    assert.equal(isBoundJob({ kind: "diagnose", diagnose: "feasibility" }), false);
    assert.equal(isBoundJob({ kind: "hybrid" }), false);
  });
});

describe("추가 탐색 목표 (2026-10-18 정책)", () => {
  const j = (status: string, stopReason: string | null, goal?: "strict" | "optimal") =>
    ({ status, goal, summary: { results: [], bestUnplaced: 0, stopReason } }) as never;
  it("엄격 기준 3개로 끝난 뒤 추가 탐색하면 최적해 3개가 목표", () => assert.equal(goalAfterApproval(j("done", "early")), "optimal"));
  it("5분 안에 엄격 기준 3개를 못 찾았으면 계속 엄격 기준이 목표", () => assert.equal(goalAfterApproval(j("awaiting", "budget")), "strict"));
  it("최적해 목표에서 5분이 끝나면 목표 유지", () => assert.equal(goalAfterApproval(j("awaiting", "budget", "optimal")), "optimal"));
  it("최적해 3개를 찾았거나 최선을 증명했으면 더 계산하지 않음", () => {
    assert.equal(jobFinishedForGood(j("done", "early", "optimal")), true);
    assert.equal(jobFinishedForGood(j("done", "optimal")), true);
    assert.equal(jobFinishedForGood(j("done", "early")), false);
  });
});

