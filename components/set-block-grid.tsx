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

type SetBlockGridProps = {
  grade: Grade;
  periods: WeekdayPeriods;
  placed: Map<string, ElectiveSet>;
  /** Slots already occupied by partial SET(s); locked, cannot paint here. */
  partialLocked: Map<string, ElectiveSet[]>;
  selectedSet: ElectiveSet | null;
  blocked: Map<string, string[]>;
  disabled?: boolean;
  onPaint: (day: Weekday, period: number) => void;
  onErase: (day: Weekday, period: number) => void;
  onSelectPlacedSet: (set: ElectiveSet) => void;
};

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some(({ key }) => key === value);
}

export function SetBlockGrid({
  grade,
  periods,
  placed,
  partialLocked,
  selectedSet,
  blocked,
  disabled,
  onPaint,
  onErase,
  onSelectPlacedSet,
}: SetBlockGridProps) {
  const periodsRef = useRef(periods);
  const placedRef = useRef(placed);
  const partialLockedRef = useRef(partialLocked);
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
    placedRef.current = placed;
  }, [placed]);

  useEffect(() => {
    partialLockedRef.current = partialLocked;
  }, [partialLocked]);

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
    if (partialLockedRef.current.has(key)) return;
    const existing = placedRef.current.get(key);
    const selected = selectedRef.current;

    if (mode === "erase") {
      if (existing && existing === selected) onEraseRef.current(day, period);
      return;
    }

    if (existing) {
      if (existing !== selected) onSelectRef.current(existing);
      return;
    }

    if (!selected) return;
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
    if (partialLocked.has(key)) return;
    const existing = placed.get(key);

    if (existing && existing !== selectedSet) {
      onSelectPlacedSet(existing);
      return;
    }

    modeRef.current = existing && existing === selectedSet ? "erase" : "paint";
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
              const placedSet = placed.get(keyName);
              const partialHere = partialLocked.get(keyName);
              const conflictTeachers = blocked.get(keyName);
              const isConflict = Boolean(
                selectedSet &&
                  !placedSet &&
                  !partialHere &&
                  conflictTeachers?.length,
              );
              const isSelectedFill = placedSet === selectedSet;

              return (
                <button
                  key={`${key}-${period}`}
                  type="button"
                  data-day={key}
                  data-period={period}
                  disabled={disabled || !active || Boolean(partialHere)}
                  aria-label={`${grade}학년 ${label}요일 ${period}교시${
                    placedSet
                      ? ` SET ${placedSet}`
                      : partialHere
                        ? ` 부분 SET ${partialHere.join(",")}로 잠김`
                        : isConflict
                          ? " 교사 충돌"
                          : active
                            ? " 비어 있음"
                            : " 수업 없음"
                  }`}
                  className={`h-8 rounded-sm border text-xs font-semibold transition-colors touch-none disabled:cursor-not-allowed ${
                    !active
                      ? "border-zinc-100 bg-zinc-100 text-transparent"
                      : placedSet
                        ? `${subjectSetBadgeClass(placedSet)} ${
                            isSelectedFill ? "ring-2 ring-zinc-700" : ""
                          }`
                        : partialHere
                          ? `${subjectSetBadgeClass(partialHere[0])} opacity-50 cursor-not-allowed`
                          : isConflict
                            ? "border-red-200 bg-red-50 text-red-400"
                            : "border-zinc-200 bg-white text-transparent hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                  title={
                    !active
                      ? "수업 없음"
                      : partialHere
                        ? `부분 SET ${partialHere.join(", ")}가 배치되어 있습니다.`
                        : isConflict
                          ? `교사 충돌: ${conflictTeachers?.join(", ")}`
                          : placedSet
                            ? `SET ${placedSet}`
                            : selectedSet
                              ? `SET ${selectedSet} 배치`
                              : "SET를 선택한 뒤 칸을 누르세요"
                  }
                  onPointerDown={(event) =>
                    handlePointerDown(event, key, period)
                  }
                >
                  {active && placedSet
                    ? placedSet
                    : active && partialHere
                      ? partialHere.join("/")
                      : isConflict
                        ? "!"
                        : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
