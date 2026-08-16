"use client";

import { useMemo } from "react";
import { TimetableGrid } from "@/components/timetable-grid";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { maxPeriods } from "@/lib/timetable";
import {
  GRADES,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

type TimetableGradeViewProps = {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
};

function cellAt(
  cells: TimetableCell[],
  classNo: number,
  day: Weekday,
  period: number,
): TimetableCell | undefined {
  return cells.find(
    (c) => c.classNo === classNo && c.day === day && c.period === period,
  );
}

function GradeGrid({
  grade,
  cells,
  schedules,
  classCount,
}: {
  grade: Grade;
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  classCount: number;
}) {
  const periodRows = useMemo(() => maxPeriods(schedules, grade), [schedules, grade]);
  const gradeCells = useMemo(
    () => cells.filter((c) => c.grade === grade),
    [cells, grade],
  );

  return (
    <div>
      <h3 className="mb-3 text-center text-sm font-semibold text-zinc-800">
        {grade}학년 전체
      </h3>
      {classCount === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          등록된 반이 없습니다.
        </p>
      ) : (
        <TimetableGrid
          periodRows={periodRows}
          minWidthClassName="min-w-[56rem]"
          isActive={(day, period) => (schedules[grade][day] ?? 0) >= period}
          renderCell={(day, period, active) => (
            <div
              key={`${day}-${period}`}
              className={`min-h-16 rounded-md border px-1 py-1 ${
                !active ? "border-zinc-100 bg-zinc-100" : "border-zinc-200 bg-white"
              }`}
            >
              {active ? (
                <div className="grid grid-cols-2 gap-0.5">
                  {Array.from({ length: classCount }, (_, i) => i + 1).map(
                    (classNo) => {
                      const cell = cellAt(gradeCells, classNo, day, period);
                      return (
                        <div
                          key={classNo}
                          title={
                            cell
                              ? `${classNo}반 ${cell.subjectName} · ${cell.teacherName}`
                              : `${classNo}반 공강`
                          }
                          className={`truncate rounded px-1 py-0.5 text-[9px] leading-tight ${
                            cell?.kind === "set"
                              ? subjectSetBadgeClass(cell.set)
                              : cell
                                ? "bg-zinc-100 text-zinc-700"
                                : "text-zinc-300"
                          }`}
                        >
                          {classNo}·{cell ? cell.subjectName : "-"}
                        </div>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          )}
        />
      )}
      <p className="mt-2 text-center text-xs text-zinc-500">
        {grade}학년 · 반 {classCount}개 · 수업 {gradeCells.length}칸
      </p>
    </div>
  );
}

export function TimetableGradeView({
  cells,
  schedules,
  classCounts,
}: TimetableGradeViewProps) {
  if (cells.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="py-10 text-center text-sm text-zinc-500">
          시간표 생성을 누르면 결과가 표시됩니다.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {GRADES.map((grade) => (
        <section
          key={grade}
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <GradeGrid
            grade={grade}
            cells={cells}
            schedules={schedules}
            classCount={classCounts[grade] ?? 0}
          />
        </section>
      ))}
    </div>
  );
}
