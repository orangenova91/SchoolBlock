"use client";

import { MAX_TIMETABLE_VERSIONS } from "@/lib/types";

export type TimetableVersionSummary = {
  id: string;
  versionNumber: number;
  createdAt: string;
  lunchDoubleCount: number;
  tripleRunCount: number;
  sameDaySubjectViolationCount: number;
  note?: string | null;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type TimetableVersionPanelProps = {
  versions: TimetableVersionSummary[];
  selectedId: string | null;
  loading: boolean;
  confirming: boolean;
  deletingId: string | null;
  canConfirm: boolean;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onConfirm: () => void;
  onDelete: (id: string) => void;
};

export function TimetableVersionPanel({
  versions,
  selectedId,
  loading,
  confirming,
  deletingId,
  canConfirm,
  busy,
  onSelect,
  onConfirm,
  onDelete,
}: TimetableVersionPanelProps) {
  return (
    <aside className="w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">확정 버전</h2>
        <span className="text-xs text-zinc-500">
          {versions.length}/{MAX_TIMETABLE_VERSIONS}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        완성된 전체 배치만 남길 수 있습니다. 초기화해도 목록은 유지됩니다.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canConfirm || busy || confirming}
        className="mt-3 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirming ? "확정 중…" : "현재 결과 확정"}
      </button>
      <button
        type="button"
        onClick={() => onSelect(null)}
        disabled={selectedId === null}
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        작업본 보기
      </button>

      {loading ? (
        <p className="mt-3 text-xs text-zinc-500" role="status">
          목록을 불러오는 중…
        </p>
      ) : versions.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">아직 확정한 버전이 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {versions.map((version) => {
            const selected = selectedId === version.id;
            return (
              <li key={version.id} className="py-2 first:pt-0">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(version.id)}
                    className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition ${
                      selected
                        ? "bg-zinc-900 text-white"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <p
                      className={`text-sm font-medium ${
                        selected ? "text-white" : "text-zinc-900"
                      }`}
                    >
                      확정 {version.versionNumber}
                    </p>
                    {version.note ? (
                      <p
                        className={`mt-0.5 text-[11px] leading-snug ${
                          selected ? "text-zinc-100" : "text-zinc-700"
                        }`}
                      >
                        {version.note}
                      </p>
                    ) : null}
                    <p
                      className={`mt-0.5 text-[11px] ${
                        selected ? "text-zinc-300" : "text-zinc-500"
                      }`}
                    >
                      {formatDate(version.createdAt)}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] ${
                        selected ? "text-zinc-300" : "text-zinc-500"
                      }`}
                    >
                      연강 {version.lunchDoubleCount} · 3연강{" "}
                      {version.tripleRunCount} · 중복{" "}
                      {version.sameDaySubjectViolationCount}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(version.id)}
                    disabled={busy || deletingId === version.id}
                    className="shrink-0 rounded-md px-1.5 py-1 text-xs text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    aria-label={`확정 ${version.versionNumber} 삭제`}
                    title="삭제"
                  >
                    {deletingId === version.id ? "…" : "✕"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
