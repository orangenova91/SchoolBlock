"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { slotKey } from "@/lib/set-blocks";
import {
  WEEKDAYS,
  type ElectiveSet,
  type Grade,
  type Weekday,
  type WeekdayPeriods,
} from "@/lib/types";

type PaintMode = "paint" | "erase";

type PartialSetBlockGridProps = {
  grade: Grade;
  periods: WeekdayPeriods;
  /** Whole-grade SET occupying the slot (locked). */
  wholeLocked: Map<string, ElectiveSet>;
  /** All partial SETs on each slot. */
  partialBySlot: Map<string, ElectiveSet[]>;
  selectedSet: ElectiveSet | null;
  blocked: Map<string, string>;
  disabled?: boolean;
  onPaint: (day: Weekday, period: number) => void;
  onErase: (day: Weekday, period: number) => void;
  onSelectPlacedSet: (set: ElectiveSet) => void;
};

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some(({ key }) => key === value);
}

export function PartialSetBlockGrid({
  grade,
  periods,
  wholeLocked,
  partialBySlot,
  selectedSet,
  blocked,
  disabled,
  onPaint,
  onErase,
  onSelectPlacedSet,
}: PartialSetBlockGridProps) {
  const periodsRef = useRef(periods);
  const wholeRef = useRef(wholeLocked);
  const partialRef = useRef(partialBySlot);
  const selectedRef = useRef(selectedSet);
  const blockedRef = useRef(blocked);
  const disabledRef = useRef(disabled);
  const draggingRef = useRef(false);
  const modeRef = useRef<PaintMode>("paint");
  const onPaintRef = useRef(onPaint);
  const onEraseRef = useRef(onErase);
  const onSelectRef = useRef(onSelectPlacedSet);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    periodsRef.current = periods;
  }, [periods]);
  useEffect(() => {
    wholeRef.current = wholeLocked;
  }, [wholeLocked]);
  useEffect(() => {
    partialRef.current = partialBySlot;
  }, [partialBySlot]);
  useEffect(() => {
    selectedRef.current = selectedSet;
  }, [selectedSet]);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  useEffect(() => {
    onPaintRef.current = onPaint;
  }, [onPaint]);
  useEffect(() => {
    onEraseRef.current = onErase;
  }, [onErase]);
  useEffect(() => {
    onSelectRef.current = onSelectPlacedSet;
  }, [onSelectPlacedSet]);

  const applyCell = useCallback((day: Weekday, period: number, mode: PaintMode) => {
    if (disabledRef.current) return;
    const allowed = periodsRef.current[day] ?? 0;
    if (period < 1 || period > allowed) return;

    const key = slotKey(day, period);
    if (wholeRef.current.has(key)) return;

    const selected = selectedRef.current;
    const onSlot = partialRef.current.get(key) ?? [];
    const hasSelected = selected ? onSlot.includes(selected) : false;

    if (mode === "erase") {
      if (selected && hasSelected) onEraseRef.current(day, period);
      return;
    }

    if (!selected) {
      if (onSlot.length > 0) onSelectRef.current(onSlot[0]);
      return;
    }

    if (hasSelected) return;
    if (blockedRef.current.has(key)) return;
    onPaintRef.current(day, period);
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
    if (event.button !== 0 || disabled) return;
    event.preventDefault();

    const key = slotKey(day, period);
    if (wholeLocked.has(key)) return;

    const onSlot = partialBySlot.get(key) ?? [];
    const hasSelected = selectedSet ? onSlot.includes(selectedSet) : false;

    if (selectedSet && hasSelected) {
      modeRef.current = "erase";
    } else if (!selectedSet && onSlot.length > 0) {
      onSelectPlacedSet(onSlot[0]);
      return;
    } else {
      modeRef.current = "paint";
    }

    draggingRef.current = true;
    setIsDragging(true);
    applyCell(day, period, modeRef.current);
  }

  const rowCount = Math.max(1, ...WEEKDAYS.map(({ key }) => periods[key]));

  return (
    <div
      className={`select-none ${isDragging ? "cursor-crosshair" : ""}`}
      onContextMenu={(event) => event.preventDefault()}
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

        {Array.from({ length: rowCount }, (_, i) => i + 1).map((period) => (
          <div key={period} className="contents">
            <div className="flex items-center justify-end pr-1 text-[11px] text-zinc-500">
              {period}
            </div>
            {WEEKDAYS.map(({ key, label }) => {
              const active = periods[key] >= period;
              const keyName = slotKey(key, period);
              const whole = wholeLocked.get(keyName);
              const partials = partialBySlot.get(keyName) ?? [];
              const blockReason = blocked.get(keyName);
              const selectedHere =
                selectedSet !== null && partials.includes(selectedSet);
              const isConflict =
                Boolean(selectedSet) &&
                !selectedHere &&
                !whole &&
                Boolean(blockReason);

              let body = "";
              let className =
                "border-zinc-200 bg-white text-transparent hover:border-zinc-300 hover:bg-zinc-50";

              if (!active) {
                className =
                  "border-zinc-100 bg-zinc-100 text-transparent disabled:cursor-not-allowed";
              } else if (whole) {
                className = `${subjectSetBadgeClass(whole)} opacity-50 cursor-not-allowed`;
                body = whole;
              } else if (partials.length > 0) {
                const primary = selectedHere
                  ? selectedSet!
                  : partials[0];
                className = `${subjectSetBadgeClass(primary)} ${
                  selectedHere ? "ring-2 ring-zinc-700" : ""
                }`;
                body =
                  partials.length === 1
                    ? partials[0]
                    : partials.join("/");
              } else if (isConflict) {
                className = "border-red-200 bg-red-50 text-red-400";
                body = "!";
              }

              return (
                <button
                  key={`${key}-${period}`}
                  type="button"
                  data-day={key}
                  data-period={period}
                  disabled={disabled || !active || Boolean(whole)}
                  aria-label={`${grade}학년 ${label}요일 ${period}교시${
                    whole
                      ? ` 전학년 SET ${whole}`
                      : partials.length
                        ? ` 부분 ${partials.join(",")}`
                        : isConflict
                          ? " 충돌"
                          : active
                            ? " 비어 있음"
                            : " 수업 없음"
                  }`}
                  title={
                    !active
                      ? "수업 없음"
                      : whole
                        ? `전학년 SET ${whole}`
                        : isConflict
                          ? blockReason
                          : partials.length
                            ? partials.join(", ")
                            : selectedSet
                              ? `SET ${selectedSet} 배치`
                              : "SET를 선택한 뒤 칸을 누르세요"
                  }
                  className={`h-8 rounded-sm border text-[10px] font-semibold transition-colors touch-none ${className}`}
                  onPointerDown={(event) =>
                    handlePointerDown(event, key, period)
                  }
                >
                  {active ? body : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
