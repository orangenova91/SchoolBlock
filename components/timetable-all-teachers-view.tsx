"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { shortSubjectName, subjectSetBadgeClass } from "@/lib/subjects";
import {
  fixedLessonKeys,
  isFixedLesson,
  isSameClassSwapTarget,
  swapSameClassCommonCells,
  swapWholeSlots,
  type TimetableCellRef,
  type TimetableSlotRef,
} from "@/lib/timetable-swap";
import {
  anyGradeHasPeriod,
  cellsForTeacher,
  maxPeriodsAllGrades,
} from "@/lib/timetable";
import {
  WEEKDAYS,
  dayLabel,
  type GradeDaySchedules,
  type SubjectBlockCell,
  type Teacher,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

type TimetableAllTeachersViewProps = {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  teachers: Teacher[];
  /** 선 수업(교과 블록) placements, used to mark lessons still at their fixed slot. */
  subjectBlocks?: SubjectBlockCell[];
  swapEnabled?: boolean;
  swapping?: boolean;
  onSwap?: (from: TimetableCellRef, to: TimetableCellRef) => void;
  /** Swap every lesson of one weekday+period column with another column. */
  onSwapSlots?: (from: TimetableSlotRef, to: TimetableSlotRef) => void;
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

function slotKey(day: Weekday, period: number): string {
  return `${day}-${period}`;
}

/** Marks a 선 수업(고정) lesson, or a period column that contains one. */
function FixedDot() {
  return (
    <span
      aria-label="선 수업"
      className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-500 align-middle"
    />
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
  subjectBlocks = [],
  swapEnabled = false,
  swapping = false,
  onSwap,
  onSwapSlots,
}: TimetableAllTeachersViewProps) {
  const [picked, setPicked] = useState<TimetableCellRef | null>(null);
  const [pickedSlot, setPickedSlot] = useState<TimetableSlotRef | null>(null);
  const picking = picked !== null || pickedSlot !== null;
  const slotSwapEnabled = swapEnabled && onSwapSlots !== undefined;
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const teacherNames = useMemo(
    () =>
      [...new Set(teachers.map((t) => t.name).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [teachers],
  );

  const periodCols = useMemo(() => maxPeriodsAllGrades(schedules), [schedules]);
  const periods = useMemo(
    () => Array.from({ length: periodCols }, (_, i) => i + 1),
    [periodCols],
  );

  const fixedKeys = useMemo(() => fixedLessonKeys(subjectBlocks), [subjectBlocks]);

  /** Number of fixed 선 수업 lessons per weekday+period column. */
  const fixedCountBySlot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of cells) {
      if (!isFixedLesson(cell, fixedKeys)) continue;
      const key = slotKey(cell.day, cell.period);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [cells, fixedKeys]);

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

  // Teacher forbidden slots are only checked by the server, as for cell swaps.
  const slotHints = useMemo(() => {
    const valid = new Set<string>();
    const blocked = new Map<string, string>();
    if (!pickedSlot) return { valid, blocked };

    for (const { key: day } of WEEKDAYS) {
      for (let period = 1; period <= periodCols; period++) {
        if (!anyGradeHasPeriod(schedules, day, period)) continue;
        if (day === pickedSlot.day && period === pickedSlot.period) continue;
        const result = swapWholeSlots(cells, pickedSlot, { day, period }, {
          forbiddenSlots: [],
          schedules,
        });
        if ("error" in result) blocked.set(slotKey(day, period), result.error);
        else valid.add(slotKey(day, period));
      }
    }
    return { valid, blocked };
  }, [pickedSlot, cells, schedules, periodCols]);

  useEffect(() => {
    if (!swapEnabled || swapping) {
      setPicked(null);
      setPickedSlot(null);
    }
  }, [swapEnabled, swapping]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (picked || pickedSlot) {
        setPicked(null);
        setPickedSlot(null);
        return;
      }
      if (fullscreen) setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picked, pickedSlot, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!picking) return;

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
  }, [picking]);

  function handlePickSlot(day: Weekday, period: number) {
    if (!slotSwapEnabled || swapping) return;
    if (!anyGradeHasPeriod(schedules, day, period)) return;
    setPicked(null);
    if (!pickedSlot) {
      setPickedSlot({ day, period });
      return;
    }
    if (pickedSlot.day === day && pickedSlot.period === period) {
      setPickedSlot(null);
      return;
    }
    const key = slotKey(day, period);
    if (slotHints.valid.has(key)) {
      onSwapSlots?.(pickedSlot, { day, period });
      setPickedSlot(null);
      return;
    }
    if (slotHints.blocked.has(key)) return;
    setPickedSlot({ day, period });
  }

  function handlePick(cell: TimetableCell) {
    if (!swapEnabled || swapping || cell.kind !== "common") return;
    setPickedSlot(null);
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
            {pickedSlot
              ? `${dayLabel(pickedSlot.day)}${pickedSlot.period}교시 전체를 집었습니다.${
                  fixedCountBySlot.get(slotKey(pickedSlot.day, pickedSlot.period))
                    ? ` 이 교시에는 선 수업(고정) ${fixedCountBySlot.get(slotKey(pickedSlot.day, pickedSlot.period))}건이 있어 함께 옮겨집니다.`
                    : ""
                } 초록 교시 번호를 누르면 두 교시의 모든 수업(SET·선 수업 포함)을 통째로 바꾸고, 주황 교시는 바꿀 수 없습니다. Esc 또는 같은 교시를 다시 누르면 취소합니다.`
              : picked
                ? `${picked.grade}-${picked.classNo} ${picked.subjectName}을 집었습니다. 초록 칸은 맞바꿀 수 있고, 주황 칸은 그 시간에 다른 수업이 있어 조정할 수 없습니다. Esc 또는 같은 칸을 다시 누르면 취소합니다.`
                : `공통 수업을 클릭해 집고, 같은 학반의 다른 칸을 클릭하면 시간을 맞바꿉니다. SET 수업은 이동할 수 없습니다.${
                    slotSwapEnabled
                      ? " 위쪽 교시 번호를 클릭하면 그 교시 전체를 다른 교시와 바꿀 수 있습니다."
                      : ""
                  }${
                    fixedCountBySlot.size > 0
                      ? " 파란 점은 선 수업(고정) 수업입니다."
                      : ""
                  }`}
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
                    periods.map((period) => {
                      const sKey = slotKey(key, period);
                      const clickable =
                        slotSwapEnabled &&
                        !swapping &&
                        anyGradeHasPeriod(schedules, key, period);
                      const isSource =
                        pickedSlot?.day === key && pickedSlot.period === period;
                      const isTarget = slotHints.valid.has(sKey);
                      const blockedReason = slotHints.blocked.get(sKey);
                      const fixedCount = fixedCountBySlot.get(sKey) ?? 0;
                      const fixedNote =
                        fixedCount > 0 ? `선 수업(고정) ${fixedCount}건 포함` : "";
                      return (
                        <th
                          key={sKey}
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          title={
                            blockedReason
                              ? `교환 불가 · ${blockedReason}`
                              : clickable
                                ? [`${dayLabel(key)}${period}교시 전체 교환`, fixedNote]
                                    .filter(Boolean)
                                    .join(" · ")
                                : fixedNote || undefined
                          }
                          onClick={
                            clickable ? () => handlePickSlot(key, period) : undefined
                          }
                          onKeyDown={
                            clickable
                              ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handlePickSlot(key, period);
                                  }
                                }
                              : undefined
                          }
                          className={`border border-zinc-200 px-1 py-0.5 text-[10px] font-normal ${
                            isSource
                              ? "bg-zinc-900 font-semibold text-white"
                              : isTarget
                                ? "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-500"
                                : blockedReason
                                  ? "cursor-not-allowed bg-amber-200 text-amber-950"
                                  : `text-zinc-500 ${dayIndex % 2 === 0 ? "bg-zinc-100" : "bg-zinc-50"}`
                          } ${
                            !clickable || blockedReason
                              ? ""
                              : isSource || isTarget
                                ? "cursor-pointer select-none"
                                : "cursor-pointer select-none hover:bg-zinc-200"
                          } ${dayStartBorder(period === periods[0])}`}
                        >
                          {period}
                          {fixedCount > 0 ? <FixedDot /> : null}
                        </th>
                      );
                    }),
                  )}
                </tr>
              </thead>
              <tbody>
                {teacherNames.map((name) => {
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
                              } ${
                                pickedSlot?.day === day &&
                                pickedSlot.period === period
                                  ? "shadow-[inset_0_0_0_999px_rgba(14,165,233,0.18)]"
                                  : ""
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
                                const fixed = isFixedLesson(c, fixedKeys);
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
                                        : `${c.grade}학년 ${c.classNo}반 ${c.subjectName} · ${name}${
                                            fixed ? " · 선 수업(고정)" : ""
                                          }`
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
                                      {fixed ? <FixedDot /> : null}
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
