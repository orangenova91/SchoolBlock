"use client";

import { useMemo } from "react";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { anyGradeHasPeriod, cellsForTeacher, maxPeriodsAllGrades } from "@/lib/timetable";
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
};

function cellsAt(
  cells: TimetableCell[],
  day: Weekday,
  period: number,
): TimetableCell[] {
  return cells.filter((c) => c.day === day && c.period === period);
}

export function TimetableAllTeachersView({
  cells,
  schedules,
  teachers,
}: TimetableAllTeachersViewProps) {
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

  const cellsByTeacher = useMemo(() => {
    const map = new Map<string, TimetableCell[]>();
    for (const name of teacherNames) {
      map.set(name, cellsForTeacher(cells, name));
    }
    return map;
  }, [cells, teacherNames]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
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
          <div className="max-h-[75vh] overflow-auto rounded-lg border border-zinc-200">
            <table className="min-w-full border-collapse text-center">
              <thead className="sticky top-0 z-20 bg-white">
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-30 border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700"
                  >
                    교사
                  </th>
                  {WEEKDAYS.map(({ key, label }) => (
                    <th
                      key={key}
                      colSpan={periodCols}
                      className="border border-zinc-200 bg-zinc-50 px-1 py-1 text-xs font-medium text-zinc-700"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {WEEKDAYS.map(({ key }) =>
                    periods.map((period) => (
                      <th
                        key={`${key}-${period}`}
                        style={{ minWidth: "2.75rem" }}
                        className="border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[10px] font-normal text-zinc-500"
                      >
                        {period}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {teacherNames.map((name) => {
                  const teacherCells = cellsByTeacher.get(name) ?? [];
                  return (
                    <tr key={name}>
                      <td className="sticky left-0 z-10 whitespace-nowrap border border-zinc-200 bg-white px-2 py-1 text-left text-xs font-medium text-zinc-800">
                        {name}
                      </td>
                      {WEEKDAYS.map(({ key: day }) =>
                        periods.map((period) => {
                          const active = anyGradeHasPeriod(schedules, day, period);
                          const matches = active
                            ? cellsAt(teacherCells, day, period)
                            : [];
                          const conflict = matches.length > 1;
                          const title = matches
                            .map((c) => `${c.grade}학년 ${c.classNo}반 ${c.subjectName}`)
                            .join(", ");
                          return (
                            <td
                              key={`${day}-${period}`}
                              title={title || undefined}
                              className={`border border-zinc-200 px-0.5 py-0.5 align-middle text-[9px] leading-tight ${
                                !active
                                  ? "bg-zinc-100"
                                  : conflict
                                    ? "bg-red-100"
                                    : matches[0]?.kind === "set"
                                      ? subjectSetBadgeClass(matches[0].set)
                                      : matches[0]
                                        ? "bg-zinc-50"
                                        : "bg-white"
                              }`}
                            >
                              {matches.map((c, i) => (
                                <div key={i} className="truncate">
                                  {c.grade}-{c.classNo} {c.subjectName}
                                </div>
                              ))}
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
          </p>
        </>
      )}
    </section>
  );
}
