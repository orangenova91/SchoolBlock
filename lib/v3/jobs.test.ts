import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextStatusAfterSegment } from "@/lib/v3/jobs";

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
});
