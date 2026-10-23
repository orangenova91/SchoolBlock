"use client";

import type {
  BoundReport,
  DataLimitReport,
  FeasibilityReport,
  FixedLossReport,
  Range,
  RelaxReport,
} from "@/lib/v3/diagnose";
import type { QuickCheckResult } from "@/lib/v3/quick-check";
import { dayLabel } from "@/lib/types";

export type V3DiagnoseKind = "feasibility" | "relax" | "fixedLoss" | "dataLimit" | "bound";

export const DIAGNOSE_LABEL: Record<V3DiagnoseKind, string> = {
  feasibility: "배치 가능 판정",
  relax: "풀어야 할 조건 찾기",
  fixedLoss: "고정의 영향",
  dataLimit: "데이터 한계",
  bound: "이론상 최선 계산",
};

export const DIAGNOSE_HINT: Record<V3DiagnoseKind, string> = {
  feasibility: "모든 수업을 빠짐없이 놓을 수 있는지 끝까지 확인합니다.",
  relax: "배치가 안 될 때, 어느 배정 불가·선 수업을 풀면 되는지 가장 적은 개수로 찾습니다.",
  fixedLoss: "직접 고정한 SET 칸 때문에 점수가 얼마나 나빠지는지 비교합니다.",
  dataLimit: "점심 연강·3연강·같은 날 교과를 입력 조건상 최소 몇 건까지 줄일 수 있는지 계산합니다.",
  bound: "어떤 방법으로도 이보다 좋을 수 없는 점수를 계산합니다. 목표 기준이 여기서 정해집니다.",
};

const rangeText = (r: Range, unit: string) =>
  r.exact ? `${r.lo}${unit}` : r.hi === null ? `${r.lo}${unit} 이상` : `${r.lo}~${r.hi}${unit}`;

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`);

/** 빠른 검사(밀리초) 결과: 오류가 있으면 생성 버튼을 막는다 */
export function V3QuickCheckBox({ quick }: { quick: QuickCheckResult }) {
  const errors = quick.warnings.filter((w) => w.severity === "error");
  const warns = quick.warnings.filter((w) => w.severity === "warn");
  const blocked = quick.blocking || quick.minUnplaced > 0;
  const tone = blocked
    ? "border-red-300 bg-red-50 text-red-900"
    : warns.length
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <div className={`w-full rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-medium">
        {blocked
          ? quick.minUnplaced > 0
            ? `빠른 검사 실패: 이 조건으로는 최소 ${quick.minUnplaced}시간이 배치될 수 없습니다.`
            : "빠른 검사 실패: 입력끼리 서로 맞지 않아 시간표를 만들 수 없습니다."
          : warns.length
            ? "빠른 검사 (주의할 점이 있습니다)"
            : "빠른 검사: 세어 보는 방법으로는 문제가 없습니다."}
        <span className="ml-1.5 text-xs font-normal opacity-70">(검사 {seconds(quick.ms)})</span>
      </p>
      {errors.length + warns.length > 0 ? (
        <ul className="mt-2 max-h-48 list-inside list-disc overflow-auto text-xs">
          {[...errors, ...warns].map((w, i) => (
            <li key={`${w.rule}-${w.who}-${i}`} className={w.severity === "error" ? "font-medium" : ""}>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
      {blocked ? (
        <p className="mt-2 text-xs font-medium">
          미배치가 생기는 조건이라 시간표를 만들지 않습니다. 위 항목을 고친 뒤 다시 확인해 주세요.
          원인을 더 찾으려면 아래 진단을 실행해 보세요.
        </p>
      ) : (
        <p className="mt-2 text-xs opacity-80">
          빠른 검사는 시간을 세어 보는 검사라, 통과해도 실제 배치가 안 될 수 있습니다. 그때는 생성 결과에서 원인 찾기를 안내합니다.
        </p>
      )}
    </div>
  );
}

/** 진단 작업 보고서 보기 */
export function V3DiagnosisReport({ kind, report }: { kind: V3DiagnoseKind; report: unknown }) {
  if (!report) return null;
  if (kind === "feasibility") {
    const r = report as FeasibilityReport;
    return (
      <div className="text-sm">
        <p className="font-medium">
          {r.status === "feasible"
            ? "모든 수업을 빠짐없이 배치할 수 있습니다."
            : r.status === "infeasible" && r.quick.some((w) => w.rule === "pinConflict" || w.rule === "fixedConflict")
              ? "선 수업·고정한 SET·배정 불가가 서로 겹치는 칸이 있어 배치할 수 없습니다. 빠른 검사의 오류 항목을 고쳐 주세요."
              : r.status === "infeasible"
                ? `이 조건으로는 어떤 방법으로도 최소 ${rangeText(r.minUnplaced, "시간")}이 배치되지 않습니다.`
                : `시간 안에 판정하지 못했습니다. 지금까지 가장 적게 남는 배치: ${rangeText(r.minUnplaced, "시간")}`}
          <span className="ml-1.5 text-xs font-normal opacity-70">
            ({r.proof === "count" ? "세기로 확인" : r.proof === "example" ? "완성본을 찾아 확인" : r.proof === "exact" ? "정확 계산으로 증명" : "판정 중단"} · {seconds(r.elapsedMs)})
          </span>
        </p>
        {r.leftLessons.length ? (
          <>
            <p className="mt-2 text-xs">끝까지 남는 수업 (가장 좋은 배치 기준):</p>
            <ul className="mt-1 max-h-40 list-inside list-disc overflow-auto text-xs">
              {r.leftLessons.map((l) => (
                <li key={`${l.teacher}-${l.grade}-${l.classNo}-${l.subject}`}>
                  {l.grade}학년 {l.classNo}반 {l.subject} · {l.teacher} ({l.hours}시간)
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {r.status !== "feasible" ? (
          <p className="mt-2 text-xs">다음으로 &ldquo;{DIAGNOSE_LABEL.relax}&rdquo;를 실행하면 무엇을 풀면 되는지 알려 줍니다.</p>
        ) : null}
      </div>
    );
  }
  if (kind === "relax") {
    const r = report as RelaxReport;
    return (
      <div className="text-sm">
        <p className="font-medium">
          {r.status === "found"
            ? `아래 ${r.items.length}개만 풀면 모든 수업을 배치할 수 있습니다.${r.minimal ? " (가장 적은 개수로 증명)" : ""}`
            : r.status === "none"
              ? "배정 불가·선 수업을 모두 풀어도 배치할 수 없습니다. 수업 시간 수 자체가 맞지 않습니다."
              : "시간 안에 찾지 못했습니다."}
          <span className="ml-1.5 text-xs font-normal opacity-70">
            (후보: 배정 불가 {r.candidates.forbidden}칸 · 선 수업 {r.candidates.pins}칸 · {seconds(r.elapsedMs)})
          </span>
        </p>
        {r.items.length ? (
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
            {r.items.map((it, i) => (
              <li key={i}>
                {it.kind === "forbidden"
                  ? `${it.teacher} 교사의 배정 불가 ${dayLabel(it.day)}요일 ${it.period}교시`
                  : `선 수업 ${it.grade}학년 ${it.classNo}반 ${it.subject}(${it.teacher}) ${dayLabel(it.day)}요일 ${it.period}교시`}
              </li>
            ))}
          </ul>
        ) : null}
        {r.structural.length ? (
          <>
            <p className="mt-2 text-xs">원인 후보 (교과 시수·교사 배정을 고쳐야 합니다):</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {r.structural.map((w, i) => (
                <li key={i}>
                  {w.message}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  }
  if (kind === "fixedLoss") {
    const r = report as FixedLossReport;
    return (
      <div className="text-sm">
        {r.nothingFixed ? (
          <p className="font-medium">직접 고정한 SET 칸이 없어 비교할 것이 없습니다.</p>
        ) : (
          <>
            <p className="font-medium">
              고정 때문에 나빠지는 점수: {rangeText(r.loss, "점")}
              <span className="ml-1.5 text-xs font-normal opacity-70">({seconds(r.elapsedMs)})</span>
            </p>
            <p className="mt-1 text-xs">
              고정한 채 최선 {rangeText(r.withFixed, "점")} · 고정을 풀면 최선 {rangeText(r.withoutFixed, "점")}
            </p>
          </>
        )}
      </div>
    );
  }
  if (kind === "dataLimit") {
    const r = report as DataLimitReport;
    const row = (label: string, it: DataLimitReport["triple"]) => (
      <li>
        {label}: {it.skipped ? "꺼짐 (계산 안 함)" : `최소 ${rangeText(it.min, "건")}`}
      </li>
    );
    return (
      <div className="text-sm">
        <p className="font-medium">
          입력 조건상 피할 수 없는 건수
          <span className="ml-1.5 text-xs font-normal opacity-70">({seconds(r.elapsedMs)})</span>
        </p>
        <ul className="mt-1 list-inside list-disc text-xs">
          {row("점심시간 연강", r.lunch)}
          {row("3연강", r.triple)}
          {row("동일 교과 같은 날", r.sameDay)}
        </ul>
        {!r.lunch.skipped && r.lunch.count.bound > 0 ? (
          <p className="mt-2 text-xs">
            세어 보면: 점심 앞뒤 수업 {r.lunch.count.cells}칸을 교사 {r.lunch.count.teachers}명이 {r.lunch.count.days}일 동안
            하루 한 칸씩만 맡으면 최대 {r.lunch.count.capacity}칸이라, 적어도 {r.lunch.count.bound}건은 연강이 됩니다.
          </p>
        ) : null}
      </div>
    );
  }
  const r = report as BoundReport;
  return (
    <div className="text-sm">
      <p className="font-medium">
        {r.lowerBound === null
          ? "이론상 최선을 계산하지 못했습니다."
          : r.proven
            ? `이론상 최선: ${r.lowerBound}점 (최선임이 증명됨)`
            : `이론상 최선: ${r.lowerBound}점 이상 (어떤 방법으로도 이보다 좋을 수 없음)`}
        <span className="ml-1.5 text-xs font-normal opacity-70">({seconds(r.elapsedMs)})</span>
      </p>
      {r.items && Object.keys(r.items).length ? (
        <p className="mt-1 text-xs">
          항목별 최소:{" "}
          {(["lunch", "triple", "sameDay"] as const)
            .filter((k) => r.items?.[k])
            .map((k) => `${k === "lunch" ? "점심 연강" : k === "triple" ? "3연강" : "같은 날 교과"} ${r.items![k]!.min}건${r.items![k]!.exact ? "" : " 이상"}`)
            .join(" · ")}{" "}
          → 중요도를 곱해 더하면 {r.itemSum ?? 0}점
        </p>
      ) : null}
      {r.best !== null ? (
        <p className="mt-1 text-xs">
          계산 중 찾은 가장 좋은 점수 {r.best}점{r.proven ? " — 최선임이 증명되었습니다." : ""}
        </p>
      ) : null}
    </div>
  );
}
