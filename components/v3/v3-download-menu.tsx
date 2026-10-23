"use client";

import { useState } from "react";
import {
  buildAllTeachersTimetableXlsx,
  buildClassTimetablesXlsx,
  buildGradeTimetableXlsx,
  buildTeacherTimetablesXlsx,
  downloadXlsx,
} from "@/lib/timetable-excel";
import type { GradeClassCounts, GradeDaySchedules, Teacher, TimetableCell } from "@/lib/types";

type Kind = "class" | "teacher" | "grade" | "allTeachers";

const ITEMS: { kind: Kind; label: string; hint: string; file: string }[] = [
  { kind: "class", label: "학반별 시간표 (엑셀)", hint: "한 시트에 1학년 1반부터 끝 반까지", file: "학반별" },
  { kind: "teacher", label: "교사별 시간표 (엑셀)", hint: "한 시트에 교사 이름 가나다순으로", file: "교사별" },
  { kind: "grade", label: "전체 학년 시간표 (엑셀)", hint: "모든 반을 한 표에 (가로 인쇄)", file: "전체학년" },
  { kind: "allTeachers", label: "전체 교사 시간표 (엑셀)", hint: "모든 교사를 한 표에 (가로 인쇄)", file: "전체교사" },
];

/**
 * 9장 오른쪽 사이드 메뉴 (다운로드). 왼쪽에서 고른 저장본을 엑셀로 받는다.
 * 넓은 화면에서는 왼쪽 저장 목록과 마주 보게 본문 오른쪽에 붙는다.
 */
export function V3DownloadMenu({
  cells,
  schedules,
  classCounts,
  teachers,
  teacherGroups,
  versionNumber,
  termPeriod,
}: {
  /** 고른 저장본의 칸 (불러오는 중이면 null) */
  cells: TimetableCell[] | null;
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
  teachers: Teacher[];
  /** 교사 그룹 순서. 교사별·전체 교사 엑셀을 그룹 순서로 나눈다 */
  teacherGroups: string[];
  versionNumber: number | null;
  /** 블록 제목과 파일 이름 앞에 붙는 학년도·학기 */
  termPeriod: { academicYear: number; semester: number } | null;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState("");
  const ready = cells !== null && versionNumber !== null;

  async function download(item: (typeof ITEMS)[number]) {
    if (cells === null || versionNumber === null) return;
    setBusy(item.kind);
    setError("");
    const termLabel = termPeriod ? `${termPeriod.academicYear}학년도 ${termPeriod.semester}학기` : "";
    try {
      const buffer =
        item.kind === "class"
          ? await buildClassTimetablesXlsx({ cells, schedules, termLabel, classCounts })
          : item.kind === "teacher"
            ? await buildTeacherTimetablesXlsx({ cells, schedules, termLabel, teachers, groups: teacherGroups })
            : item.kind === "grade"
              ? await buildGradeTimetableXlsx({ cells, schedules, termLabel, classCounts })
              : await buildAllTeachersTimetableXlsx({ cells, schedules, termLabel, teachers, groups: teacherGroups });
      const prefix = termLabel ? `${termLabel.replace(/ /g, "_")}_` : "";
      downloadXlsx(buffer, `${prefix}저장${versionNumber}_${item.file}_시간표.xlsx`);
    } catch {
      setError("엑셀 파일을 만들지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside
      aria-label="다운로드"
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm min-[1440px]:absolute min-[1440px]:top-0 min-[1440px]:left-full min-[1440px]:ml-4 min-[1440px]:max-h-[calc(100vh-10rem)] min-[1440px]:w-60 min-[1440px]:overflow-y-auto min-[1440px]:p-4"
    >
      <h2 className="text-base font-semibold text-zinc-900">다운로드</h2>
      <p className="mt-1 text-xs text-zinc-500">
        {versionNumber !== null ? `저장 ${versionNumber}을(를) 엑셀로 받습니다.` : "저장한 최종 시간표를 고르면 받을 수 있습니다."}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {ITEMS.map((item) => (
          <button
            key={item.kind}
            type="button"
            disabled={!ready || busy !== null}
            onClick={() => void download(item)}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === item.kind ? "만드는 중…" : item.label}
            <span className="mt-0.5 block text-xs font-normal text-emerald-50">{item.hint}</span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}
