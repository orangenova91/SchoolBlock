"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { shortSubjectName, subjectSetBadgeClass } from "@/lib/subjects";
import { hasTeacherGroupSections, teacherSections } from "@/lib/teachers";
import {
  isSameClassSwapTarget,
  swapSameClassCommonCells,
  type TimetableCellRef,
} from "@/lib/timetable-swap";
import {
  anyGradeHasPeriod,
  cellsForTeacher,
  maxPeriodsAllGrades,
} from "@/lib/timetable";
import {
  WEEKDAYS,
  type GradeDaySchedules,
  type Teacher,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

type TimetableAllTeachersViewProps = {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  teachers: Teacher[];
  /** v3 교사 그룹 순서. 있으면 그룹별로 머리줄을 넣어 나눈다 (없으면 가나다순) */
  groups?: string[];
  swapEnabled?: boolean;
  swapping?: boolean;
  onSwap?: (from: TimetableCellRef, to: TimetableCellRef) => void;
};

const EDGE_PX = 48;
const MAX_SCROLL_PER_FRAME = 3;

/** Fixed column widths: without a width cap, `truncate` can't kick in and
 * long subject names stretch the 35 period columns to ~3x the screen. */
const TEACHER_COL_REM = 4.5;
const PERIOD_COL_REM = 2.75;

function cellsAt(
  cells: TimetableCell[],
  day: Weekday,
  period: number,
): TimetableCell[] {
  return cells.filter((c) => c.day === day && c.period === period);
}

function toRef(cell: TimetableCell): TimetableCellRef {
  return {
    grade: cell.grade,
    classNo: cell.classNo,
    day: cell.day,
    period: cell.period,
    subjectName: cell.subjectName,
    teacherName: cell.teacherName,
  };
}

function refKey(ref: TimetableCellRef): string {
  return `${ref.grade}|${ref.classNo}|${ref.day}|${ref.period}|${ref.subjectName}|${ref.teacherName}`;
}

function sameRef(a: TimetableCellRef, b: TimetableCellRef): boolean {
  return (
    a.grade === b.grade &&
    a.classNo === b.classNo &&
    a.day === b.day &&
    a.period === b.period &&
    a.subjectName === b.subjectName &&
    a.teacherName === b.teacherName
  );
}

function dayStartBorder(isDayStart: boolean): string {
  return isDayStart ? "border-l-2 border-l-zinc-500" : "";
}

function edgeDelta(position: number, start: number, end: number): number {
  if (position < start || position > end) return 0;
  if (position <= start + EDGE_PX) {
    const t = (start + EDGE_PX - position) / EDGE_PX;
    return -MAX_SCROLL_PER_FRAME * t;
  }
  if (position >= end - EDGE_PX) {
    const t = (position - (end - EDGE_PX)) / EDGE_PX;
    return MAX_SCROLL_PER_FRAME * t;
  }
  return 0;
}

export function TimetableAllTeachersView({
  cells,
  schedules,
  teachers,
  groups,
  swapEnabled = false,
  swapping = false,
  onSwap,
}: TimetableAllTeachersViewProps) {
  const [picked, setPicked] = useState<TimetableCellRef | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const sections = useMemo(() => teacherSections(teachers, groups), [teachers, groups]);
  const showGroupHeaders = hasTeacherGroupSections(sections);
  const teacherNames = useMemo(() => sections.flatMap((s) => s.names), [sections]);

  const periodCols = useMemo(() => maxPeriodsAllGrades(schedules), [schedules]);
  const periods = useMemo(
    () => Array.from({ length: periodCols }, (_, i) => i + 1),
    [periodCols],
  );

  const cellsByTeacher = useMemo(() => {
    const map = new Map<string, TimetableCell[]>();
    for (const name of teacherNames) {
      map.set(name, cellsForTeacher(cells, name));
    }
    return map;
  }, [cells, teacherNames]);

  const swapHints = useMemo(() => {
    const valid = new Set<string>();
    const blocked = new Map<string, string>();
    if (!picked) return { valid, blocked };

    const seen = new Set<string>();
    for (const cell of cells) {
      if (!isSameClassSwapTarget(picked, cell)) continue;
      const ref = toRef(cell);
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = swapSameClassCommonCells(cells, picked, ref, {
        forbiddenSlots: [],
        schedules,
      });
      if ("error" in result) blocked.set(key, result.error);
      else valid.add(key);
    }
    return { valid, blocked };
  }, [picked, cells, schedules]);

  useEffect(() => {
    if (!swapEnabled || swapping) setPicked(null);
  }, [swapEnabled, swapping]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (picked) {
        setPicked(null);
        return;
      }
      if (fullscreen) setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picked, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!picked) return;

    function onPointerMove(event: PointerEvent) {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    }

    let frame = 0;
    function tick() {
      const box = scrollRef.current;
      if (box) {
        const rect = box.getBoundingClientRect();
        const { x, y } = pointerRef.current;
        const dx = edgeDelta(x, rect.left, rect.right);
        const dy = edgeDelta(y, rect.top, rect.bottom);
        if (dx) box.scrollLeft += dx;
        if (dy) box.scrollTop += dy;
      }
      frame = window.requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", onPointerMove);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.cancelAnimationFrame(frame);
    };
  }, [picked]);

  function handlePick(cell: TimetableCell) {
    if (!swapEnabled || swapping || cell.kind !== "common") return;
    const ref = toRef(cell);
    if (!picked) {
      setPicked(ref);
      return;
    }
    if (sameRef(picked, ref)) {
      setPicked(null);
      return;
    }
    if (swapHints.valid.has(refKey(ref))) {
      onSwap?.(picked, ref);
      setPicked(null);
      return;
    }
    if (swapHints.blocked.has(refKey(ref))) {
      return;
    }
    setPicked(ref);
  }

  return (
    <section
      className={
        fullscreen
          ? "fixed inset-0 z-[60] flex flex-col bg-white p-4 text-zinc-900"
          : "rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-sm"
      }
    >
      <div className="mb-3 flex items-start justify-end gap-3">
        {swapEnabled && cells.length > 0 && teacherNames.length > 0 ? (
          <p className="min-w-0 flex-1 text-center text-xs text-zinc-500">
            {picked
              ? `${picked.grade}-${picked.classNo} ${picked.subjectName}을 집었습니다. 초록 칸은 맞바꿀 수 있고, 주황 칸은 그 시간에 다른 수업이 있어 조정할 수 없습니다. Esc 또는 같은 칸을 다시 누르면 취소합니다.`
              : "공통 수업을 클릭해 집고, 같은 학반의 다른 칸을 클릭하면 시간을 맞바꿉니다. SET 수업은 이동할 수 없습니다."}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <button
          type="button"
          onClick={() => setFullscreen((open) => !open)}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          {fullscreen ? "닫기" : "전체화면"}
        </button>
      </div>
      {cells.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          시간표 생성을 누르면 결과가 표시됩니다.
        </p>
      ) : teacherNames.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          등록된 교사가 없습니다.
        </p>
      ) : (
        <>
          <h3 className="mb-3 text-center text-sm font-semibold text-zinc-800">
            전체 교사 시간표
          </h3>
          <div
            ref={scrollRef}
            className={
              fullscreen
                ? "min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200"
                : "max-h-[75vh] overflow-auto rounded-lg border border-zinc-200"
            }
          >
            <table
              className="min-w-full table-fixed border-collapse text-center"
              style={{
                width: `${TEACHER_COL_REM + PERIOD_COL_REM * periodCols * WEEKDAYS.length}rem`,
              }}
            >
              <colgroup>
                <col style={{ width: `${TEACHER_COL_REM}rem` }} />
                {WEEKDAYS.map(({ key }) =>
                  periods.map((period) => (
                    <col
                      key={`${key}-${period}`}
                      style={{ width: `${PERIOD_COL_REM}rem` }}
                    />
                  )),
                )}
              </colgroup>
              <thead className="sticky top-0 z-20 bg-white">
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-30 border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700"
                  >
                    교사
                  </th>
                  {WEEKDAYS.map(({ key, label }, dayIndex) => (
                    <th
                      key={key}
                      colSpan={periodCols}
                      className={`border border-zinc-200 px-1 py-1 text-xs font-medium text-zinc-700 ${
                        dayIndex % 2 === 0 ? "bg-zinc-100" : "bg-zinc-50"
                      } ${dayStartBorder(true)}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {WEEKDAYS.map(({ key }, dayIndex) =>
                    periods.map((period) => (
                      <th
                        key={`${key}-${period}`}
                        className={`border border-zinc-200 px-1 py-0.5 text-[10px] font-normal text-zinc-500 ${
                          dayIndex % 2 === 0 ? "bg-zinc-100" : "bg-zinc-50"
                        } ${dayStartBorder(period === periods[0])}`}
                      >
                        {period}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.group ?? "__none__"}>
                {showGroupHeaders ? (
                  <tr>
                    <td
                      colSpan={1 + periodCols * WEEKDAYS.length}
                      className="border border-zinc-300 bg-zinc-100 p-0 text-left"
                    >
                      <span className="sticky left-0 inline-block px-2 py-1 text-xs font-semibold text-zinc-900">
                        {section.group ?? "그룹 없음"}
                        <span className="ml-1.5 font-normal text-zinc-500">{section.names.length}명</span>
                      </span>
                    </td>
                  </tr>
                ) : null}
                {section.names.map((name) => {
                  const teacherCells = cellsByTeacher.get(name) ?? [];
                  return (
                    <tr key={name}>
                      <td
                        title={name}
                        className="sticky left-0 z-10 truncate whitespace-nowrap border border-zinc-200 bg-white px-2 py-1 text-left text-xs font-medium text-zinc-800"
                      >
                        {name}
                      </td>
                      {WEEKDAYS.map(({ key: day }, dayIndex) =>
                        periods.map((period) => {
                          const active = anyGradeHasPeriod(schedules, day, period);
                          const matches = active
                            ? cellsAt(teacherCells, day, period)
                            : [];
                          const conflict = matches.length > 1;
                          const title = matches
                            .map(
                              (c) =>
                                `${c.grade}학년 ${c.classNo}반 ${c.subjectName}`,
                            )
                            .join(", ");
                          return (
                            <td
                              key={`${day}-${period}`}
                              title={title || undefined}
                              className={`border border-zinc-200 px-0.5 py-0.5 align-middle text-[9px] leading-tight ${
                                !active
                                  ? dayIndex % 2 === 0
                                    ? "bg-zinc-200/70"
                                    : "bg-zinc-100"
                                  : conflict
                                    ? "bg-red-100"
                                    : matches[0]?.kind === "set"
                                      ? subjectSetBadgeClass(matches[0].set)
                                      : matches[0]
                                        ? dayIndex % 2 === 0
                                          ? "bg-zinc-100"
                                          : "bg-zinc-50"
                                        : dayIndex % 2 === 0
                                          ? "bg-zinc-50"
                                          : "bg-white"
                              } ${dayStartBorder(period === periods[0])}`}
                            >
                              {matches.map((c, i) => {
                                const ref = toRef(c);
                                const key = refKey(ref);
                                const isSource =
                                  picked !== null && sameRef(picked, ref);
                                const isTarget = swapHints.valid.has(key);
                                const isBlocked = swapHints.blocked.has(key);
                                const blockedReason = swapHints.blocked.get(key);
                                return (
                                  <div
                                    key={i}
                                    role={
                                      swapEnabled && c.kind === "common"
                                        ? "button"
                                        : undefined
                                    }
                                    tabIndex={
                                      swapEnabled && c.kind === "common"
                                        ? 0
                                        : undefined
                                    }
                                    title={
                                      blockedReason
                                        ? `조정 불가 · ${blockedReason}`
                                        : `${c.grade}학년 ${c.classNo}반 ${c.subjectName} · ${name}`
                                    }
                                    onClick={() => handlePick(c)}
                                    onKeyDown={(event) => {
                                      if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                      ) {
                                        event.preventDefault();
                                        handlePick(c);
                                      }
                                    }}
                                    className={`truncate ${
                                      swapEnabled && c.kind === "common"
                                        ? "cursor-pointer select-none rounded-sm px-0.5"
                                        : ""
                                    } ${isSource ? "bg-zinc-900 text-white" : ""} ${
                                      isTarget
                                        ? "bg-emerald-100 ring-1 ring-emerald-500"
                                        : ""
                                    } ${
                                      isBlocked
                                        ? "cursor-not-allowed bg-amber-200 text-amber-950 ring-1 ring-amber-600"
                                        : ""
                                    }`}
                                  >
                                    <span className="block font-medium">
                                      {c.grade}-{c.classNo}
                                    </span>
                                    <span className="block truncate">
                                      {shortSubjectName(c.subjectName)}
                                    </span>
                                  </div>
                                );
                              })}
                            </td>
                          );
                        }),
                      )}
                    </tr>
                  );
                })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500">
            교사 {teacherNames.length}명
            {swapping ? " · 맞바꾸는 중…" : ""}
          </p>
        </>
      )}
    </section>
  );
}
