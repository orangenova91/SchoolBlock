"use client";

import { useMemo } from "react";
import { shortSubjectName, subjectSetBadgeClass } from "@/lib/subjects";
import { maxPeriodsAllGrades } from "@/lib/timetable";
import {
  GRADES,
  WEEKDAYS,
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

type ClassRow = {
  grade: Grade;
  classNo: number;
};

/** Fixed column widths: without a width cap, long subject names stretch the period columns. */
const CLASS_COL_REM = 3.25;
const PERIOD_COL_REM = 2.75;

function slotKey(
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
): string {
  return `${grade}:${classNo}:${day}:${period}`;
}

function dayStartBorder(isDayStart: boolean): string {
  return isDayStart ? "border-l-2 border-l-zinc-500" : "";
}

export function TimetableGradeView({
  cells,
  schedules,
  classCounts,
}: TimetableGradeViewProps) {
  const periodCols = useMemo(
    () => maxPeriodsAllGrades(schedules),
    [schedules],
  );
  const periods = useMemo(
    () => Array.from({ length: periodCols }, (_, i) => i + 1),
    [periodCols],
  );
  const rows = useMemo(() => {
    const next: ClassRow[] = [];
    for (const grade of GRADES) {
      const count = classCounts[grade] ?? 0;
      for (let classNo = 1; classNo <= count; classNo += 1) {
        next.push({ grade, classNo });
      }
    }
    return next;
  }, [classCounts]);
  const cellsBySlot = useMemo(() => {
    const map = new Map<string, TimetableCell>();
    for (const cell of cells) {
      map.set(slotKey(cell.grade, cell.classNo, cell.day, cell.period), cell);
    }
    return map;
  }, [cells]);

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
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-sm">
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          등록된 반이 없습니다.
        </p>
      ) : (
        <>
          <h3 className="mb-3 text-center text-sm font-semibold text-zinc-800">
            전체 학년 시간표
          </h3>
          <div className="max-h-[75vh] overflow-auto rounded-lg border border-zinc-200">
            <table
              className="min-w-full table-fixed border-collapse text-center"
              style={{
                width: `${CLASS_COL_REM + PERIOD_COL_REM * periodCols * WEEKDAYS.length}rem`,
              }}
            >
              <colgroup>
                <col style={{ width: `${CLASS_COL_REM}rem` }} />
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
                    className="sticky left-0 z-30 border border-zinc-200 bg-white px-1 py-1 text-xs font-medium text-zinc-700"
                  >
                    학반
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
                {rows.map((row, rowIndex) => {
                  const gradeStart =
                    rowIndex > 0 && rows[rowIndex - 1].grade !== row.grade;
                  const label = `${row.grade}-${row.classNo}`;
                  return (
                    <tr key={label}>
                      <th
                        scope="row"
                        title={`${row.grade}학년 ${row.classNo}반`}
                        className={`sticky left-0 z-10 whitespace-nowrap border border-zinc-200 bg-white px-1 py-1 text-xs font-medium text-zinc-800 ${
                          gradeStart ? "border-t-2 border-t-zinc-800" : ""
                        }`}
                      >
                        {label}
                      </th>
                      {WEEKDAYS.map(({ key: day }, dayIndex) =>
                        periods.map((period) => {
                          const active =
                            (schedules[row.grade][day] ?? 0) >= period;
                          const cell = active
                            ? cellsBySlot.get(
                                slotKey(row.grade, row.classNo, day, period),
                              )
                            : undefined;
                          const title = !active
                            ? undefined
                            : cell
                              ? `${row.grade}학년 ${row.classNo}반 ${cell.subjectName} · ${cell.teacherName}`
                              : `${row.grade}학년 ${row.classNo}반 공강`;
                          return (
                            <td
                              key={`${day}-${period}`}
                              title={title}
                              className={`overflow-hidden border border-zinc-200 px-0.5 py-0.5 align-middle text-[10px] leading-tight ${
                                gradeStart ? "border-t-2 border-t-zinc-800" : ""
                              } ${dayStartBorder(period === periods[0])} ${
                                !active
                                  ? dayIndex % 2 === 0
                                    ? "bg-zinc-200/70"
                                    : "bg-zinc-100"
                                  : cell?.kind === "set"
                                    ? subjectSetBadgeClass(cell.set)
                                    : cell
                                      ? dayIndex % 2 === 0
                                        ? "bg-zinc-100"
                                        : "bg-zinc-50"
                                      : dayIndex % 2 === 0
                                        ? "bg-zinc-50"
                                        : "bg-white"
                              }`}
                            >
                              {cell ? (
                                <span className="block truncate font-medium">
                                  {shortSubjectName(cell.subjectName)}
                                </span>
                              ) : null}
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
            {GRADES.filter((grade) => (classCounts[grade] ?? 0) > 0)
              .map((grade) => `${grade}학년 ${classCounts[grade]}반`)
              .join(" · ")}
            {" · "}수업 {cells.length}칸
          </p>
        </>
      )}
    </section>
  );
}
