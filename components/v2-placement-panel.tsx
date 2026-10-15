"use client";

import { useEffect, useState } from "react";
import type { PlacementCheckReport } from "@/lib/timetable-exact-check";
import {
  formatPowerOfTen,
  type FeasibilityReport,
} from "@/lib/timetable-feasibility";
import { V2_WEIGHT_LEVELS, type V2Weights } from "@/lib/v2-weights";

/** 정확 판정 결과가 있으면 그 값, 없으면(시간 초과) 매칭 하한. */
export function minUnplacedOf(report: PlacementCheckReport): number {
  return report.exact.minUnplaced ?? report.minUnplaced;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

/** v2 전용: 사전 검사(정확 판정) 결과 표시. */
export function V2PlacementCheckPanel({ report }: { report: PlacementCheckReport }) {
  const min = minUnplacedOf(report);
  const { exact } = report;
  const blocked = min > 0;
  const tone = blocked
    ? "border-red-300 bg-red-50 text-red-900"
    : exact.status === "feasible"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-medium">
        {exact.status === "feasible"
          ? "사전 검사 통과: 모든 수업을 미배치 없이 배치할 수 있습니다. (정확 판정으로 증명)"
          : exact.status === "infeasible"
            ? `사전 검사 실패: 현재 조건에서는 어떤 방법으로도 최소 ${min}교시가 배치될 수 없습니다. (정확 판정으로 증명)`
            : min > 0
              ? `사전 검사 실패: 현재 조건에서는 최소 ${min}교시가 배치될 수 없습니다.`
              : exact.unknownReason === "error"
                ? "사전 검사: 정확 판정을 실행하지 못했습니다. 빠른 검사로는 배치할 자리가 있어 배치는 진행할 수 있습니다."
                : "사전 검사: 정확 판정이 시간 안에 끝나지 않았습니다. 빠른 검사로는 배치할 자리가 있어 배치는 진행할 수 있습니다."}
        <span className="ml-1.5 text-xs font-normal opacity-70">
          (공통 수업 {report.lessonCount}시수 · 검사 {seconds(report.elapsedMs)}
          {report.checkedAt
            ? ` · ${new Date(report.checkedAt).toLocaleString("ko-KR")}${
                report.cached ? " 검사 결과 (조건 변경 없음)" : ""
              }`
            : ""}
          )
        </span>
      </p>

      {exact.status === "infeasible" && exact.unplacedLessons.length > 0 ? (
        <>
          <p className="mt-2 text-xs">
            최소한으로 남는 수업의 한 예 (이 중 하나 이상의 조건을 풀어야 합니다):
          </p>
          <ul className="mt-1 max-h-40 list-inside list-disc overflow-auto text-xs">
            {exact.unplacedLessons.map((u) => (
              <li key={`${u.teacherName}-${u.grade}-${u.classNo}-${u.subjectName}`}>
                {u.grade}학년 {u.classNo}반 {u.subjectName} · {u.teacherName} ({u.count}
                시간)
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.classes.length > 0 || report.teachers.length > 0 ? (
        <p className="mt-2 text-xs">반·교사별로 자리가 부족한 곳:</p>
      ) : null}
      {report.classes.length > 0 || report.teachers.length > 0 ? (
        <ul className="mt-1 max-h-40 list-inside list-disc overflow-auto text-xs">
          {report.classes.map((c) => (
            <li key={`c-${c.label}`}>
              {c.label}: 수업 {c.lessons}시수 중 {c.assignable}시수만 들어갈 자리가
              있음 (부족 {c.lessons - c.assignable})
            </li>
          ))}
          {report.teachers.map((t) => (
            <li key={`t-${t.label}`}>
              {t.label} 교사: 수업 {t.lessons}시수 중 {t.assignable}시수만 들어갈
              시간이 있음 (부족 {t.lessons - t.assignable})
            </li>
          ))}
        </ul>
      ) : null}

      {!blocked && report.estimate ? (
        <p className="mt-1 text-xs">
          배치 자유도 (미배치 없는 배치 방법 수, 추정):{" "}
          <span className="font-semibold">
            {formatPowerOfTen(report.estimate.log10Estimate)}
          </span>
          <span className="opacity-70">
            {" "}
            · 반별 상한 {formatPowerOfTen(report.estimate.log10Upper)}
          </span>
        </p>
      ) : null}

      {blocked ? (
        <p className="mt-2 text-xs font-medium">
          모든 수업이 배치될 수 없는 조건이라 시간표 배치를 진행하지 않습니다.
          선 수업·배정 불가·SET 배치를 조정한 뒤 &ldquo;사전 검사&rdquo;를 다시
          눌러 주세요.
        </p>
      ) : null}
    </div>
  );
}

/** v2 전용: 선호 조건 가중치 선택. 꺼진 조건은 선택할 수 없다. */
export function V2WeightsPanel({
  weights,
  enabled,
  saving,
  disabled,
  onChange,
}: {
  weights: V2Weights;
  enabled: { lunch: boolean; triple: boolean; sameDay: boolean };
  saving: boolean;
  disabled: boolean;
  onChange: (next: V2Weights) => void;
}) {
  const rows: { key: keyof V2Weights; label: string }[] = [
    { key: "lunch", label: "점심시간 연강" },
    { key: "triple", label: "3연강" },
    { key: "sameDay", label: "동일 교과 같은 날" },
  ];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
      <p className="font-medium">
        선호 조건 가중치 (v2)
        <span className="ml-1.5 text-xs font-normal text-zinc-500">
          {saving ? "저장 중…" : "높을수록 그 조건을 먼저 지킵니다. 다음 배치부터 반영됩니다."}
        </span>
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <label key={row.key} className="flex items-center justify-between gap-2">
            <span className={enabled[row.key] ? "" : "text-zinc-400"}>
              {row.label}
              {enabled[row.key] ? "" : " (꺼짐)"}
            </span>
            <select
              value={weights[row.key]}
              disabled={disabled || !enabled[row.key]}
              onChange={(e) =>
                onChange({ ...weights, [row.key]: Number(e.target.value) })
              }
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {V2_WEIGHT_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        조건을 켜고 끄는 것은 &ldquo;추가 조건 설정&rdquo;에서 합니다. 교사 중복·배정
        불가 같은 필수 조건은 가중치와 관계없이 항상 먼저 지켜집니다.
      </p>
    </div>
  );
}

export type CheckPhase = "idle" | "quick" | "exact";

type CheckSetters = {
  setPhase: (phase: CheckPhase) => void;
  setQuick: (report: FeasibilityReport | null) => void;
  setReport: (report: PlacementCheckReport | null) => void;
  setStartedAt: (ms: number) => void;
  setError: (message: string) => void;
};

/**
 * v2 사전 검사 실행: 빠른 검사(수 ms) 결과를 먼저 보여준 뒤 정확 판정을 한다.
 * - 자동(화면 진입 후): `reuseIfUnchanged`로 호출해, 조건이 그대로면 저장된
 *   결과를 바로 보여주고 다시 판정하지 않는다.
 * - 수동("사전 검사" 버튼): 항상 새로 판정한다.
 */
export async function runPlacementCheckFlow(
  termId: string,
  s: CheckSetters,
  isCancelled: () => boolean = () => false,
  options: { reuseIfUnchanged?: boolean } = {},
): Promise<void> {
  const url = `/api/terms/${termId}/timetable/feasibility`;
  if (options.reuseIfUnchanged) {
    try {
      const cachedRes = await fetch(`${url}?mode=cached`, { method: "POST" });
      const cachedData = (await cachedRes.json()) as {
        feasibility?: PlacementCheckReport | null;
      };
      if (isCancelled()) return;
      if (cachedRes.ok && cachedData.feasibility) {
        s.setReport(cachedData.feasibility);
        return;
      }
    } catch {
      // 저장값을 못 읽으면 새로 검사한다.
    }
    if (isCancelled()) return;
  }
  s.setStartedAt(Date.now());
  s.setQuick(null);
  s.setReport(null);
  s.setPhase("quick");
  try {
    const quickRes = await fetch(`${url}?mode=quick`, { method: "POST" });
    const quickData = (await quickRes.json()) as {
      quick?: FeasibilityReport;
      error?: string;
    };
    if (isCancelled()) return;
    if (!quickRes.ok || !quickData.quick) {
      s.setError(quickData.error ?? "사전 검사에 실패했습니다.");
      s.setPhase("idle");
      return;
    }
    s.setQuick(quickData.quick);
    s.setPhase("exact");

    const fullRes = await fetch(url, { method: "POST" });
    const fullData = (await fullRes.json()) as {
      feasibility?: PlacementCheckReport;
      error?: string;
    };
    if (isCancelled()) return;
    if (!fullRes.ok || !fullData.feasibility) {
      s.setError(fullData.error ?? "사전 검사에 실패했습니다.");
    } else {
      s.setReport(fullData.feasibility);
    }
  } catch {
    if (!isCancelled()) s.setError("서버에 연결할 수 없습니다.");
  } finally {
    if (!isCancelled()) s.setPhase("idle");
  }
}

function StepRow({
  state,
  title,
  detail,
}: {
  state: "done" | "running" | "waiting";
  title: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          state === "done"
            ? "bg-emerald-600 text-white"
            : state === "running"
              ? "animate-pulse bg-sky-500 text-white"
              : "bg-zinc-200 text-zinc-500"
        }`}
        aria-hidden
      >
        {state === "done" ? "✓" : state === "running" ? "…" : ""}
      </span>
      <span>
        <span className="font-medium">{title}</span>
        <span className="ml-1.5 text-zinc-600">{detail}</span>
      </span>
    </li>
  );
}

/** v2 사전 검사 진행 상태: 단계별 표시와 경과 시간. */
export function V2CheckProgress({
  phase,
  quick,
  startedAt,
}: {
  phase: Exclude<CheckPhase, "idle">;
  quick: FeasibilityReport | null;
  startedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const exactElapsed = quick ? Math.max(0, elapsed - quick.elapsedMs) : 0;
  // 정확 판정 상한(20초)에 대한 대략적 진행 막대. 대부분 수 초 안에 끝난다.
  const percent = phase === "exact" ? Math.min(95, (exactElapsed / 20_000) * 100) : 5;

  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
      role="status"
      aria-live="polite"
    >
      <p className="font-medium">
        사전 검사 진행 중… <span className="font-normal">{seconds(elapsed)}</span>
      </p>
      <ol className="mt-2 flex flex-col gap-1.5 text-xs">
        <StepRow
          state={quick ? "done" : "running"}
          title="1. 빠른 검사"
          detail={
            quick
              ? quick.minUnplaced > 0
                ? `반·교사별로 자리가 부족한 곳이 있습니다 (최소 ${quick.minUnplaced}교시) · ${quick.elapsedMs}ms`
                : `반·교사별로는 모두 자리가 있습니다 · ${quick.elapsedMs}ms`
              : "반·교사별로 들어갈 자리가 있는지 확인하고 있습니다."
          }
        />
        <StepRow
          state={phase === "exact" ? "running" : "waiting"}
          title="2. 정확 판정"
          detail={
            phase === "exact"
              ? `모든 수업을 동시에 배치할 수 있는지 증명하고 있습니다 · ${seconds(exactElapsed)} (최대 20초)`
              : "빠른 검사가 끝나면 시작합니다."
          }
        />
      </ol>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
        <div
          className="h-full rounded-full bg-sky-500 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
