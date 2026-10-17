"use client";

import { useCallback, useEffect, useState } from "react";
import type { TimetableVersionSummary } from "@/components/timetable-version-panel";
import { V3TimetableView } from "@/components/v3/v3-timetable-view";
import {
  MAX_TIMETABLE_VERSIONS,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Teacher,
  type TimetableCell,
} from "@/lib/types";

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
};

/**
 * v3 확정 버전 목록. 결과를 적용하면 확정 버전이 하나씩 쌓인다 (v1·v2와 같은 저장 공간).
 * 여기서는 보기·삭제만 한다 (확정은 "이 결과 적용"이 대신함).
 */
export function V3Versions({
  termId,
  refreshKey,
  schedules,
  classCounts,
  teachers,
}: {
  termId: string;
  /** 적용할 때마다 바뀌어 목록을 다시 읽게 하는 값 */
  refreshKey: number;
  schedules: GradeDaySchedules;
  classCounts: GradeClassCounts;
  teachers: Teacher[];
}) {
  const [versions, setVersions] = useState<TimetableVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<{ id: string; cells: TimetableCell[] } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const fetchVersions = useCallback(async () => {
    const res = await fetch(`/api/terms/${termId}/timetable/versions`);
    const data = (await res.json().catch(() => ({}))) as { versions?: TimetableVersionSummary[] };
    return res.ok && Array.isArray(data.versions) ? data.versions : null;
  }, [termId]);

  const load = useCallback(async () => {
    const list = await fetchVersions();
    if (list) setVersions(list);
  }, [fetchVersions]);

  useEffect(() => {
    let cancelled = false;
    fetchVersions().then((list) => {
      if (cancelled) return;
      if (list) setVersions(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchVersions, refreshKey]);

  async function show(id: string) {
    if (shown?.id === id) {
      setShown(null);
      return;
    }
    setMessage("");
    const res = await fetch(`/api/terms/${termId}/timetable/versions/${id}`);
    const data = (await res.json().catch(() => ({}))) as { version?: { cells?: TimetableCell[] }; error?: string };
    if (!res.ok || !data.version) {
      setMessage(data.error ?? "확정 버전을 불러오지 못했습니다.");
      return;
    }
    setShown({ id, cells: Array.isArray(data.version.cells) ? data.version.cells : [] });
  }

  async function remove(v: TimetableVersionSummary) {
    if (!window.confirm(`확정 ${v.versionNumber} 버전을 삭제할까요?`)) return;
    setDeleting(v.id);
    setMessage("");
    try {
      const res = await fetch(`/api/terms/${termId}/timetable/versions/${v.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "삭제하지 못했습니다.");
        return;
      }
      if (shown?.id === v.id) setShown(null);
      setMessage(`확정 ${v.versionNumber} 버전을 삭제했습니다.`);
      await load();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">확정 버전</h2>
        <span className="text-xs text-zinc-500">
          {versions.length}/{MAX_TIMETABLE_VERSIONS}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        &ldquo;이 결과 적용&rdquo;을 누를 때마다 하나씩 저장됩니다. 가장 최근에 적용한 것이 현재 시간표입니다.
      </p>
      {message ? <p className="mt-2 text-sm text-zinc-700">{message}</p> : null}
      {loading ? (
        <p className="mt-3 text-sm text-zinc-500" role="status">
          불러오는 중…
        </p>
      ) : versions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">아직 적용한 결과가 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">
                  확정 {v.versionNumber}
                  <span className="ml-2 text-xs font-normal text-zinc-500">{formatDate(v.createdAt)}</span>
                </p>
                <p className="text-xs text-zinc-600">
                  {v.note ?? ""} {v.note ? "· " : ""}점심 연강 {v.lunchDoubleCount} · 3연강 {v.tripleRunCount} · 같은 날 교과{" "}
                  {v.sameDaySubjectViolationCount}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void show(v.id)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
              >
                {shown?.id === v.id ? "닫기" : "보기"}
              </button>
              <button
                type="button"
                disabled={deleting === v.id}
                onClick={() => void remove(v)}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting === v.id ? "삭제 중…" : "삭제"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown ? (
        <div className="mt-4">
          <V3TimetableView cells={shown.cells} schedules={schedules} classCounts={classCounts} teachers={teachers} />
        </div>
      ) : null}
    </section>
  );
}
