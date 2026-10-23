"use client";

import { useMemo, useState } from "react";
import { TimetableAllTeachersView } from "@/components/timetable-all-teachers-view";
import { TimetableGradeView } from "@/components/timetable-grade-view";
import { TimetableGrid } from "@/components/timetable-grid";
import { TimetableTeacherView } from "@/components/timetable-teacher-view";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { cellsForClass, maxPeriods } from "@/lib/timetable";
import type { TimetableCellRef } from "@/lib/timetable-swap";
import {
  GRADES,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Teacher,
  type TeacherForbiddenSlot,
  type TimetableCell,
} from "@/lib/types";

export type V3ViewMode = "class" | "teacher" | "grade" | "allTeachers";

/** 9장 미세 조정: 전체 교사 시간표에서만 맞바꾼다 */
export type V3FineTuneProps = {
  swapping: boolean;
  onSwap: (from: TimetableCellRef, to: TimetableCellRef) => void;
  forbiddenSlots: TeacherForbiddenSlot[];
  isLocked: (cell: TimetableCell) => boolean;
};

/**
 * v3 결과 보기. v1 시간표 화면의 보기(학반별·교사별·학년 전체·전체 교사)를 그대로 쓴다.
 * 칸 바꾸기(미세 조정)는 fineTune을 줄 때만 전체 교사 시간표에서 켠다.
 */
export function V3TimetableView({
  cells,
  schedules,
  classCounts,
  teachers,
  teacherGroups,
  fixedSetKeys,
  defaultView = "class",
  fineTune,
}: {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  /** 교사 그룹 순서 (교사 배정의 교사 그룹화). 교사별·전체 교사 보기를 그룹 순서로 */
  teacherGroups?: string[];
  /** 사용자가 고정한 SET 칸 ("학년|SET|요일|교시"). 나머지 SET 칸은 자동 배치 */
  fixedSetKeys?: Set<string>;
  /** 처음 열 보기 탭 */
  defaultView?: V3ViewMode;
  fineTune?: V3FineTuneProps;
}) {
  const [viewMode, setViewMode] = useState<V3ViewMode>(defaultView);
  const [viewGrade, setViewGrade] = useState<Grade>(1);
  const [viewClass, setViewClass] = useState(1);
  const periodRows = useMemo(() => maxPeriods(schedules, viewGrade), [schedules, viewGrade]);
  const classCells = useMemo(() => cellsForClass(cells, viewGrade, viewClass), [cells, viewGrade, viewClass]);

  const tabClass = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      on ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
    }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {(
          [
            { key: "class", label: "학반별" },
            { key: "teacher", label: "교사별" },
            { key: "grade", label: "전체 학년 시간표" },
            { key: "allTeachers", label: "전체 교사 시간표" },
          ] as const
        ).map((tab) => (
          <button key={tab.key} type="button" onClick={() => setViewMode(tab.key)} className={tabClass(viewMode === tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {viewMode === "class" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            {GRADES.map((grade) => (
              <button
                key={grade}
                type="button"
                onClick={() => {
                  setViewGrade(grade);
                  setViewClass(1);
                }}
                className={tabClass(viewGrade === grade)}
              >
                {grade}학년
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-center gap-1.5">
            {Array.from({ length: classCounts[viewGrade] ?? 0 }, (_, i) => i + 1).map((classNo) => (
              <button
                key={classNo}
                type="button"
                onClick={() => setViewClass(classNo)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewClass === classNo
                    ? "bg-zinc-800 text-white"
                    : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {classNo}반
              </button>
            ))}
          </div>
          <TimetableGrid
            periodRows={periodRows}
            isActive={(day, period) => (schedules[viewGrade][day] ?? 0) >= period}
            renderCell={(day, period, active) => {
              const cell = active
                ? classCells.find((c) => c.day === day && c.period === period)
                : undefined;
              return (
                <div
                  key={`${day}-${period}`}
                  className={`min-h-14 rounded-md border px-1 py-1 text-center ${
                    !active
                      ? "border-zinc-100 bg-zinc-100"
                      : cell?.kind === "set"
                        ? subjectSetBadgeClass(cell.set)
                        : cell
                          ? "border-zinc-300 bg-zinc-50"
                          : "border-dashed border-zinc-200 bg-white"
                  }`}
                >
                  {active && cell ? (
                    <>
                      {cell.kind === "set" ? (
                        <p className="text-[9px] font-medium leading-tight text-zinc-500">
                          {cell.set} SET · {fixedSetKeys?.has(`${viewGrade}|${cell.set}|${day}|${period}`) ? "고정" : "자동"}
                        </p>
                      ) : null}
                      <p className="text-[11px] font-semibold leading-tight text-zinc-900">{cell.subjectName}</p>
                      <p className="mt-0.5 text-[10px] leading-tight text-zinc-600">{cell.teacherName}</p>
                    </>
                  ) : null}
                </div>
              );
            }}
          />
          <p className="mt-3 text-center text-xs text-zinc-500">
            {viewGrade}학년 {viewClass}반 · 수업 {classCells.length}칸 · SET 칸의 &ldquo;고정&rdquo;은 직접 칠한 칸, &ldquo;자동&rdquo;은 생성이 고른 칸입니다
          </p>
        </section>
      ) : viewMode === "teacher" ? (
        <TimetableTeacherView cells={cells} schedules={schedules} teachers={teachers} groups={teacherGroups} />
      ) : viewMode === "grade" ? (
        <TimetableGradeView cells={cells} schedules={schedules} classCounts={classCounts} />
      ) : (
        <TimetableAllTeachersView
          cells={cells}
          schedules={schedules}
          teachers={teachers}
          groups={teacherGroups}
          swapEnabled={Boolean(fineTune)}
          swapping={fineTune?.swapping}
          onSwap={fineTune?.onSwap}
          forbiddenSlots={fineTune?.forbiddenSlots}
          isLocked={fineTune?.isLocked}
        />
      )}
    </div>
  );
}
