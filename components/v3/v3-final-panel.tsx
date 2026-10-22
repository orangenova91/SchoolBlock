"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { TimetableVersionSummary } from "@/components/timetable-version-panel";
import { V3TimetableView } from "@/components/v3/v3-timetable-view";
import { formatVersionDate, V3Versions, versionNote } from "@/components/v3/v3-versions";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  type GradeClassCounts,
  type GradeDaySchedules,
  type SetBlockCell,
  type Teacher,
  type TimetableCell,
} from "@/lib/types";

/** v3 9장 최종 시간표: 왼쪽에서 저장본을 고르면 가운데에 그 시간표를 보여 준다 */
export function V3FinalPanel({ termId, savedVersion }: { termId: string; savedVersion: number | null }) {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<GradeDaySchedules>(createDefaultGradeDaySchedules());
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(createDefaultClassCounts());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [fixedSetKeys, setFixedSetKeys] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<TimetableVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shown, setShown] = useState<{ id: string; cells: TimetableCell[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(savedVersion ? `저장 ${savedVersion}을(를) 최종 시간표로 저장했습니다. 지금 현재 시간표입니다.` : "");

  const fetchVersions = useCallback(async () => {
    const res = await fetch(`/api/terms/${termId}/timetable/versions`);
    const data = (await res.json().catch(() => ({}))) as { versions?: TimetableVersionSummary[] };
    return res.ok && Array.isArray(data.versions) ? data.versions : null;
  }, [termId]);

  // 처음 불러오기: 방금 저장한 것, 없으면 가장 최근 것을 고른다
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [scheduleRes, teachersRes, setBlocksRes, list] = await Promise.all([
        fetch(`/api/terms/${termId}/day-schedule`),
        fetch(`/api/terms/${termId}/teachers`),
        fetch(`/api/terms/${termId}/set-blocks`),
        fetchVersions(),
      ]);
      const schedule = (await scheduleRes.json().catch(() => ({}))) as { grades?: GradeDaySchedules; classCounts?: GradeClassCounts };
      const teachersData = (await teachersRes.json().catch(() => ({}))) as { teachers?: Teacher[] };
      const setBlocks = (await setBlocksRes.json().catch(() => ({}))) as { cells?: SetBlockCell[]; partialCells?: SetBlockCell[] };
      if (cancelled) return;
      if (scheduleRes.ok) {
        setSchedules(schedule.grades ?? createDefaultGradeDaySchedules());
        setClassCounts(schedule.classCounts ?? createDefaultClassCounts());
      }
      if (teachersRes.ok) setTeachers(Array.isArray(teachersData.teachers) ? teachersData.teachers : []);
      if (setBlocksRes.ok) {
        const fixed = [...(setBlocks.cells ?? []), ...(setBlocks.partialCells ?? [])];
        setFixedSetKeys(new Set(fixed.map((c) => `${c.grade}|${c.set}|${c.day}|${c.period}`)));
      }
      if (list) {
        setVersions(list);
        setSelectedId((list.find((v) => v.versionNumber === savedVersion) ?? list[0])?.id ?? null);
      } else {
        setError("저장한 최종 시간표를 불러오지 못했습니다.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [termId, fetchVersions, savedVersion]);

  // 고른 저장본의 시간표 칸 불러오기
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/terms/${termId}/timetable/versions/${selectedId}`);
      const data = (await res.json().catch(() => ({}))) as { version?: { cells?: TimetableCell[] }; error?: string };
      if (cancelled) return;
      if (!res.ok || !data.version) {
        setError(data.error ?? "저장한 시간표를 불러오지 못했습니다.");
        return;
      }
      setShown({ id: selectedId, cells: Array.isArray(data.version.cells) ? data.version.cells : [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [termId, selectedId]);

  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const cells = shown && shown.id === selectedId ? shown.cells : null;

  async function remove(v: TimetableVersionSummary) {
    if (!window.confirm(`저장 ${v.versionNumber}을(를) 삭제할까요?\n삭제해도 현재 시간표는 바뀌지 않습니다.`)) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/terms/${termId}/timetable/versions/${v.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "삭제하지 못했습니다.");
        return;
      }
      const list = (await fetchVersions()) ?? versions.filter((x) => x.id !== v.id);
      setVersions(list);
      setSelectedId(list[0]?.id ?? null);
      setNotice(`저장 ${v.versionNumber}을(를) 삭제했습니다.`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="relative flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">최종 시간표</h1>
        <p className="mt-2 text-sm text-zinc-600">
          <Link href={`/v3/terms/${termId}/timetable`} className="underline">
            8. 시간표 생성
          </Link>
          에서 결과를 &ldquo;최종 시간표로 저장&rdquo;하면 왼쪽 목록에 쌓입니다. 가장 최근에 저장한 것이 현재 시간표이고, 목록에서 삭제해도
          현재 시간표는 바뀌지 않습니다.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}

      <V3Versions
        versions={versions}
        loading={loading}
        selectedId={selectedId}
        justSavedVersion={savedVersion}
        onSelect={(id) => {
          setError("");
          setSelectedId(id);
        }}
      />

      {loading ? null : !selected ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-center text-sm text-zinc-600 shadow-sm">
          아직 저장한 최종 시간표가 없습니다.{" "}
          <Link href={`/v3/terms/${termId}/timetable`} className="underline">
            8. 시간표 생성
          </Link>
          에서 결과를 최종 시간표로 저장해 주세요.
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
                저장 {selected.versionNumber}
                {versions[0]?.id === selected.id ? (
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">가장 최근</span>
                ) : null}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-600">
                {formatVersionDate(selected.createdAt)}
                {versionNote(selected) ? ` · ${versionNote(selected)}` : ""} · 점심 연강 {selected.lunchDoubleCount} · 3연강{" "}
                {selected.tripleRunCount} · 같은 날 교과 {selected.sameDaySubjectViolationCount}
              </p>
            </div>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void remove(selected)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "삭제 중…" : "이 저장본 삭제"}
            </button>
          </div>
          {cells ? (
            <V3TimetableView cells={cells} schedules={schedules} classCounts={classCounts} teachers={teachers} fixedSetKeys={fixedSetKeys} />
          ) : (
            <p className="text-center text-sm text-zinc-600" role="status">
              시간표를 불러오는 중…
            </p>
          )}
        </section>
      )}
    </div>
  );
}
