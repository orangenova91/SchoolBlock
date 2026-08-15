"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WEEKDAYS,
  type SubjectBlockCell,
  type Weekday,
  type WeekdayPeriods,
} from "@/lib/types";

type PaintMode = "paint" | "erase";

type SubjectBlockGridProps = {
  periods: WeekdayPeriods;
  /** SET-locked slots `${day}|${period}`. */
  setLocked: Set<string>;
  /** Existing subject blocks on this class grid. */
  blocksBySlot: Map<string, SubjectBlockCell>;
  selectedKey: string | null;
  disabled?: boolean;
  onPaint: (day: Weekday, period: number) => void;
  onErase: (day: Weekday, period: number) => void;
};

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some(({ key }) => key === value);
}

function cellKey(day: Weekday, period: number) {
  return `${day}|${period}`;
}

export function SubjectBlockGrid({
  periods,
  setLocked,
  blocksBySlot,
  selectedKey,
  disabled,
  onPaint,
  onErase,
}: SubjectBlockGridProps) {
  const maxPeriod = Math.max(0, ...WEEKDAYS.map(({ key }) => periods[key] ?? 0));
  const rows = useMemo(
    () => Array.from({ length: maxPeriod }, (_, i) => i + 1),
    [maxPeriod],
  );

  const draggingRef = useRef(false);
  const modeRef = useRef<PaintMode>("paint");
  const onPaintRef = useRef(onPaint);
  const onEraseRef = useRef(onErase);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    onPaintRef.current = onPaint;
    onEraseRef.current = onErase;
  }, [onPaint, onErase]);

  const applyFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) return;
      const el = document.elementFromPoint(clientX, clientY);
      if (!(el instanceof HTMLElement)) return;
      const cell = el.closest<HTMLElement>("[data-day][data-period]");
      if (!cell) return;
      const day = cell.dataset.day;
      const period = Number(cell.dataset.period);
      if (!day || !isWeekday(day) || !Number.isInteger(period)) return;
      if ((periods[day] ?? 0) < period) return;
      if (setLocked.has(cellKey(day, period))) return;
      if (modeRef.current === "paint") onPaintRef.current(day, period);
      else onEraseRef.current(day, period);
    },
    [disabled, periods, setLocked],
  );

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!draggingRef.current) return;
      applyFromPoint(event.clientX, event.clientY);
    }
    function handlePointerUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [applyFromPoint]);

  if (maxPeriod === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        교시표가 비어 있습니다. 요일별 교시를 먼저 설정해 주세요.
      </p>
    );
  }

  return (
    <div
      className={`select-none overflow-x-auto ${isDragging ? "cursor-grabbing" : ""}`}
    >
      <div
        className="grid min-w-[20rem] gap-1"
        style={{
          gridTemplateColumns: `2rem repeat(${WEEKDAYS.length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {WEEKDAYS.map(({ key, label }) => (
          <div
            key={key}
            className="pb-1 text-center text-xs font-medium text-zinc-600"
          >
            {label}
          </div>
        ))}

        {rows.map((period) => (
          <div key={`row-${period}`} className="contents">
            <div className="flex items-center justify-center text-xs text-zinc-500">
              {period}
            </div>
            {WEEKDAYS.map(({ key: day }) => {
              const allowed = (periods[day] ?? 0) >= period;
              const key = cellKey(day, period);
              const locked = setLocked.has(key);
              const block = blocksBySlot.get(key);
              const selected =
                block &&
                selectedKey ===
                  `${block.teacherName}|${block.grade}|${block.classNo}|${block.subjectName}`;

              let className =
                "flex h-12 flex-col items-center justify-center rounded-md border px-0.5 text-center transition ";
              if (!allowed) {
                className += "border-transparent bg-zinc-50/50 text-zinc-300";
              } else if (locked) {
                className +=
                  "cursor-not-allowed border-violet-200 bg-violet-50 text-[10px] text-violet-700";
              } else if (block) {
                className += selected
                  ? "border-zinc-800 bg-zinc-900 text-[10px] text-white"
                  : "border-sky-300 bg-sky-50 text-[10px] text-sky-900";
              } else {
                className +=
                  "border-zinc-200 bg-white hover:border-zinc-400 hover:bg-zinc-50";
              }

              return (
                <button
                  key={key}
                  type="button"
                  data-day={day}
                  data-period={period}
                  disabled={!allowed || locked || disabled}
                  className={className}
                  title={
                    locked
                      ? "SET 고정"
                      : block
                        ? `${block.subjectName} · ${block.teacherName}`
                        : undefined
                  }
                  onPointerDown={(event) => {
                    if (!allowed || locked || disabled) return;
                    event.preventDefault();
                    draggingRef.current = true;
                    setIsDragging(true);
                    modeRef.current = block ? "erase" : "paint";
                    applyFromPoint(event.clientX, event.clientY);
                  }}
                >
                  {locked ? (
                    <span>SET</span>
                  ) : block ? (
                    <>
                      <span className="line-clamp-1 w-full font-medium leading-tight">
                        {block.subjectName}
                      </span>
                      <span className="line-clamp-1 w-full opacity-80 leading-tight">
                        {block.teacherName}
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
