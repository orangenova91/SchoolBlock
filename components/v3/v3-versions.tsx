"use client";

import type { TimetableVersionSummary } from "@/components/timetable-version-panel";
import { MAX_TIMETABLE_VERSIONS } from "@/lib/types";

export const formatVersionDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
};

/** 메모 앞의 "v3 · "는 목록에서 빼고 보인다 */
export const versionNote = (v: TimetableVersionSummary) => (v.note ?? "").replace(/^v3 · /, "");

/**
 * v3 저장한 최종 시간표 목록 (v1·v2의 확정 버전과 같은 저장 공간).
 * 넓은 화면에서는 본문 왼쪽에 붙는다. 줄을 누르면 그 저장본을 고른다.
 */
export function V3Versions({
  versions,
  loading,
  selectedId,
  justSavedVersion,
  onSelect,
}: {
  versions: TimetableVersionSummary[];
  loading: boolean;
  selectedId: string | null;
  /** 8장에서 방금 저장하고 넘어온 번호 */
  justSavedVersion: number | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm min-[1440px]:absolute min-[1440px]:top-0 min-[1440px]:right-full min-[1440px]:mr-4 min-[1440px]:max-h-[calc(100vh-10rem)] min-[1440px]:w-60 min-[1440px]:overflow-y-auto min-[1440px]:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">저장한 최종 시간표</h2>
        <span className="text-xs text-zinc-500">
          {versions.length}/{MAX_TIMETABLE_VERSIONS}
        </span>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-zinc-500" role="status">
          불러오는 중…
        </p>
      ) : versions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">아직 저장한 최종 시간표가 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {versions.map((v, i) => (
            <li key={v.id}>
              <button
                type="button"
                aria-pressed={v.id === selectedId}
                onClick={() => onSelect(v.id)}
                className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-sm transition ${
                  v.id === selectedId ? "bg-zinc-100" : "hover:bg-zinc-50"
                }`}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-zinc-900">저장 {v.versionNumber}</span>
                  {i === 0 ? (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">가장 최근</span>
                  ) : null}
                  {v.versionNumber === justSavedVersion ? (
                    <span className="text-[10px] font-semibold text-emerald-700">방금 저장</span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatVersionDate(v.createdAt)}
                  {versionNote(v) ? ` · ${versionNote(v)}` : ""}
                </span>
                <span className="text-xs text-zinc-500">
                  점심 {v.lunchDoubleCount} · 3연강 {v.tripleRunCount} · 같은 날 {v.sameDaySubjectViolationCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
