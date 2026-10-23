"use client";

import { useMemo, useState } from "react";
import { TimetableGrid } from "@/components/timetable-grid";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { hasTeacherGroupSections, teacherSections } from "@/lib/teachers";
import { anyGradeHasPeriod, cellsForTeacher, maxPeriodsAllGrades } from "@/lib/timetable";
import {
  type GradeDaySchedules,
  type Teacher,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

type TimetableTeacherViewProps = {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  teachers: Teacher[];
  /** v3 교사 그룹 순서. 있으면 검색 목록을 그룹 순서로 보이고 그룹명을 붙인다 (없으면 가나다순) */
  groups?: string[];
};

function cellsAt(
  cells: TimetableCell[],
  day: Weekday,
  period: number,
): TimetableCell[] {
  return cells.filter((c) => c.day === day && c.period === period);
}

export function TimetableTeacherView({
  cells,
  schedules,
  teachers,
  groups,
}: TimetableTeacherViewProps) {
  const [query, setQuery] = useState("");

  const sections = useMemo(() => teacherSections(teachers, groups), [teachers, groups]);
  const showGroupLabels = hasTeacherGroupSections(sections);
  const teacherNames = useMemo(() => sections.flatMap((s) => s.names), [sections]);

  const trimmedQuery = query.trim();
  const selectedTeacher = teacherNames.find((name) => name === trimmedQuery);

  const teacherCells = useMemo(
    () => (selectedTeacher ? cellsForTeacher(cells, selectedTeacher) : []),
    [cells, selectedTeacher],
  );

  const periodRows = useMemo(() => maxPeriodsAllGrades(schedules), [schedules]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col items-center gap-2">
        <label className="w-full max-w-xs">
          <span className="mb-1 block text-center text-xs font-medium text-zinc-600">
            교사 검색
          </span>
          <input
            type="text"
            list="teacher-view-options"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="교사명을 입력하세요"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
          <datalist id="teacher-view-options">
            {sections.flatMap((section) =>
              section.names.map((name) => (
                <option
                  key={name}
                  value={name}
                  label={showGroupLabels ? (section.group ?? "그룹 없음") : undefined}
                />
              )),
            )}
          </datalist>
        </label>
      </div>

      {!trimmedQuery ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          교사명을 입력하면 해당 교사의 주간 시간표가 표시됩니다.
        </p>
      ) : !selectedTeacher ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          목록에 있는 교사명을 정확히 선택해 주세요.
        </p>
      ) : cells.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          시간표 생성을 누르면 결과가 표시됩니다.
        </p>
      ) : (
        <>
          <TimetableGrid
            periodRows={periodRows}
            isActive={(day, period) => anyGradeHasPeriod(schedules, day, period)}
            renderCell={(day, period, active) => {
              const matches = active ? cellsAt(teacherCells, day, period) : [];
              const conflict = matches.length > 1;
              return (
                <div
                  key={`${day}-${period}`}
                  className={`min-h-14 rounded-md border px-1 py-1 text-center ${
                    !active
                      ? "border-zinc-100 bg-zinc-100"
                      : conflict
                        ? "border-red-400 bg-red-50"
                        : matches[0]?.kind === "set"
                          ? subjectSetBadgeClass(matches[0].set)
                          : matches[0]
                            ? "border-zinc-300 bg-zinc-50"
                            : "border-dashed border-zinc-200 bg-white"
                  }`}
                >
                  {matches.map((cell, i) => (
                    <div key={i} className={i > 0 ? "mt-1 border-t border-red-200 pt-1" : undefined}>
                      <p className="text-[11px] font-semibold leading-tight text-zinc-900">
                        {cell.subjectName}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-tight text-zinc-600">
                        {cell.grade}학년 {cell.classNo}반
                      </p>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <p className="mt-3 text-center text-xs text-zinc-500">
            {selectedTeacher} · 수업 {teacherCells.length}칸
          </p>
        </>
      )}
    </section>
  );
}
