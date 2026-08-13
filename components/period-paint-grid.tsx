"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_PERIODS,
  WEEKDAYS,
  type Weekday,
  type WeekdayPeriods,
} from "@/lib/types";

const PERIOD_ROWS = Array.from({ length: MAX_PERIODS }, (_, i) => i + 1);

type PaintMode = "paint" | "erase";

type PeriodPaintGridProps = {
  grade: 1 | 2 | 3;
  periods: WeekdayPeriods;
  onChange: (day: Weekday, count: number) => void;
};

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some(({ key }) => key === value);
}

export function PeriodPaintGrid({
  grade,
  periods,
  onChange,
}: PeriodPaintGridProps) {
  const periodsRef = useRef(periods);
  const draggingRef = useRef(false);
  const modeRef = useRef<PaintMode>("paint");
  const onChangeRef = useRef(onChange);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    periodsRef.current = periods;
  }, [periods]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const applyCell = useCallback((day: Weekday, period: number, mode: PaintMode) => {
    const next = mode === "paint" ? period : Math.max(0, period - 1);
    if (periodsRef.current[day] === next) return;
    onChangeRef.current(day, next);
  }, []);

  const applyFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!(el instanceof HTMLElement)) return;

      const cell = el.closest<HTMLElement>("[data-day][data-period]");
      if (!cell) return;

      const day = cell.dataset.day;
      const period = Number(cell.dataset.period);
      if (!day || !isWeekday(day) || !Number.isInteger(period)) return;

      applyCell(day, period, modeRef.current);
    },
    [applyCell],
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
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [applyFromPoint]);

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    day: Weekday,
    period: number,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();

    const filled = periodsRef.current[day] >= period;
    modeRef.current = filled ? "erase" : "paint";
    draggingRef.current = true;
    setIsDragging(true);
    applyCell(day, period, modeRef.current);
  }

  return (
    <div
      className={`select-none ${isDragging ? "cursor-crosshair" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `1.75rem repeat(${WEEKDAYS.length}, minmax(0, 1fr))`,
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

        {PERIOD_ROWS.map((period) => (
          <div key={period} className="contents">
            <div className="flex items-center justify-end pr-1 text-[11px] text-zinc-500">
              {period}
            </div>
            {WEEKDAYS.map(({ key, label }) => {
              const active = periods[key] >= period;
              return (
                <button
                  key={`${key}-${period}`}
                  type="button"
                  data-day={key}
                  data-period={period}
                  aria-label={`${grade}학년 ${label}요일 ${period}교시 ${active ? "수업 있음" : "수업 없음"}`}
                  aria-pressed={active}
                  className={`h-7 rounded-sm border transition-colors touch-none ${
                    active
                      ? "border-blue-300 bg-blue-200"
                      : "border-zinc-200 bg-zinc-50 hover:border-blue-200 hover:bg-blue-50"
                  }`}
                  onPointerDown={(e) => handlePointerDown(e, key, period)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-xs text-zinc-500">
        {WEEKDAYS.map(({ key, label }) => `${label} ${periods[key]}`).join(
          " · ",
        )}
      </p>
    </div>
  );
}
