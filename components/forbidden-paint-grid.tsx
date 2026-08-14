"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WEEKDAYS,
  type Weekday,
  type WeekdayPeriods,
} from "@/lib/types";

type PaintMode = "paint" | "erase";

type ForbiddenPaintGridProps = {
  maxByDay: WeekdayPeriods;
  /** Set of `${day}|${period}` that are forbidden for the selected teacher. */
  forbiddenKeys: Set<string>;
  onToggle: (day: Weekday, period: number, mode: PaintMode) => void;
};

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some(({ key }) => key === value);
}

function cellKey(day: Weekday, period: number) {
  return `${day}|${period}`;
}

export function ForbiddenPaintGrid({
  maxByDay,
  forbiddenKeys,
  onToggle,
}: ForbiddenPaintGridProps) {
  const maxPeriod = Math.max(0, ...WEEKDAYS.map(({ key }) => maxByDay[key] ?? 0));
  const rows = useMemo(
    () => Array.from({ length: maxPeriod }, (_, i) => i + 1),
    [maxPeriod],
  );

  const draggingRef = useRef(false);
  const modeRef = useRef<PaintMode>("paint");
  const onToggleRef = useRef(onToggle);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  const applyFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!(el instanceof HTMLElement)) return;
    const cell = el.closest<HTMLElement>("[data-day][data-period]");
    if (!cell) return;
    const day = cell.dataset.day;
    const period = Number(cell.dataset.period);
    if (!day || !isWeekday(day) || !Number.isInteger(period)) return;
    if ((maxByDay[day] ?? 0) < period) return;
    onToggleRef.current(day, period, modeRef.current);
  }, [maxByDay]);

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
          <div key={period} className="contents">
            <div className="flex items-center justify-end pr-1 text-[11px] text-zinc-500">
              {period}
            </div>
            {WEEKDAYS.map(({ key }) => {
              const active = (maxByDay[key] ?? 0) >= period;
              const forbidden =
                active && forbiddenKeys.has(cellKey(key, period));
              return (
                <button
                  key={`${key}-${period}`}
                  type="button"
                  data-day={key}
                  data-period={period}
                  disabled={!active}
                  onPointerDown={(event) => {
                    if (!active) return;
                    event.preventDefault();
                    modeRef.current = forbidden ? "erase" : "paint";
                    draggingRef.current = true;
                    setIsDragging(true);
                    onToggle(key, period, modeRef.current);
                  }}
                  className={`min-h-10 rounded-md border text-[10px] font-medium transition ${
                    !active
                      ? "cursor-default border-zinc-100 bg-zinc-100"
                      : forbidden
                        ? "border-rose-400 bg-rose-100 text-rose-900"
                        : "border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  {active ? (forbidden ? "불가" : "") : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
