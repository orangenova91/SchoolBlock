"use client";

import type { ReactElement } from "react";
import { WEEKDAYS, type Weekday } from "@/lib/types";

type TimetableGridProps = {
  periodRows: number;
  isActive: (day: Weekday, period: number) => boolean;
  /** Must return an element with `key` set to something unique per (day, period). */
  renderCell: (day: Weekday, period: number, active: boolean) => ReactElement;
  minWidthClassName?: string;
};

/**
 * Shared day x period grid skeleton (label column + weekday header + period
 * rows). Callers own the full markup/content of each cell via `renderCell`,
 * so this can back the per-class, per-teacher, and whole-grade views alike.
 */
export function TimetableGrid({
  periodRows,
  isActive,
  renderCell,
  minWidthClassName = "min-w-[28rem]",
}: TimetableGridProps) {
  return (
    <div className="overflow-x-auto">
      <div
        className={`grid ${minWidthClassName} gap-1`}
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
        {Array.from({ length: periodRows }, (_, i) => i + 1).map((period) => (
          <div key={period} className="contents">
            <div className="flex items-center justify-end pr-1 text-[11px] text-zinc-500">
              {period}
            </div>
            {WEEKDAYS.map(({ key: day }) =>
              renderCell(day, period, isActive(day, period)),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
