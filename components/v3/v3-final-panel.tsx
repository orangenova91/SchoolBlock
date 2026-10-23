"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TimetableVersionSummary } from "@/components/timetable-version-panel";
import { V3DownloadMenu } from "@/components/v3/v3-download-menu";
import { V3TimetableView } from "@/components/v3/v3-timetable-view";
import { formatVersionDate, V3Versions, versionNote } from "@/components/v3/v3-versions";
import type { TimetableCellRef } from "@/lib/timetable-swap";
import {
  applyFineTuneSwap,
  fineTuneMetrics,
  isPinnedLesson,
  pinnedLessonKeys,
  type FineTuneContext,
  type FineTuneSwap,
} from "@/lib/v3/fine-tune";
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
export function V3FinalPanel({
  termId,
  savedVersion,
  termPeriod,
}: {
  termId: string;
  savedVersion: number | null;
  termPeriod: { academicYear: number; semester: number } | null;
}) {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<GradeDaySchedules>(createDefaultGradeDaySchedules());
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(createDefaultClassCounts());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherGroups, setTeacherGroups] = useState<string[]>([]);
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
      const teachersData = (await teachersRes.json().catch(() => ({}))) as { teachers?: Teacher[]; groups?: string[] };
      const setBlocks = (await setBlocksRes.json().catch(() => ({}))) as { cells?: SetBlockCell[]; partialCells?: SetBlockCell[] };
      if (cancelled) return;
      if (scheduleRes.ok) {
        setSchedules(schedule.grades ?? createDefaultGradeDaySchedules());
        setClassCounts(schedule.classCounts ?? createDefaultClassCounts());
      }
      if (teachersRes.ok) {
        setTeachers(Array.isArray(teachersData.teachers) ? teachersData.teachers : []);
        setTeacherGroups(Array.isArray(teachersData.groups) ? teachersData.groups : []);
      }
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

  // 미세 조정: 고른 저장본에서 시작해 화면에서 맞바꾸고, 저장하면 서버가 같은 규칙으로 다시 적용해 새 저장본을 만든다
  const [tuneCtx, setTuneCtx] = useState<FineTuneContext | null>(null);
  const [draft, setDraft] = useState<{
    baseId: string;
    baseNumber: number;
    swaps: FineTuneSwap[];
    /** 맞바꿀 때마다 쌓는 칸 목록 (첫 칸 = 시작한 저장본). 되돌리기에 쓴다 */
    history: TimetableCell[][];
  } | null>(null);
  const [tuneBusy, setTuneBusy] = useState(false);
  const pinned = useMemo(() => pinnedLessonKeys(tuneCtx?.pins ?? []), [tuneCtx]);
  const isLocked = useCallback((cell: TimetableCell) => isPinnedLesson(pinned, cell), [pinned]);
  const draftCells = draft ? draft.history[draft.history.length - 1] : null;
  const dirty = (draft?.swaps.length ?? 0) > 0;
  const draftMetrics = useMemo(() => {
    if (!draft || !draftCells || !tuneCtx) return null;
    const count = (c: TimetableCell[]) => {
      const m = fineTuneMetrics(c, tuneCtx);
      return { lunch: m.lunchDoubles.length, triple: m.tripleRuns.length, sameDay: m.sameDaySubjectViolations.length };
    };
    return { before: count(draft.history[0]), now: count(draftCells) };
  }, [draft, draftCells, tuneCtx]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** 바꾼 내용이 있으면 버려도 되는지 묻는다 */
  const confirmDiscard = () =>
    !dirty || window.confirm("미세 조정한 내용이 저장되지 않고 사라집니다. 계속할까요?");

  async function startFineTune() {
    if (!selected || !cells) return;
    setError("");
    setNotice("");
    let ctx = tuneCtx;
    if (!ctx) {
      setTuneBusy(true);
      try {
        const res = await fetch(`/api/terms/${termId}/v3/fine-tune`);
        const data = (await res.json().catch(() => ({}))) as FineTuneContext & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "미세 조정을 시작하지 못했습니다.");
          return;
        }
        ctx = data;
        setTuneCtx(data);
      } finally {
        setTuneBusy(false);
      }
    }
    setDraft({ baseId: selected.id, baseNumber: selected.versionNumber, swaps: [], history: [cells] });
  }

  function swapInDraft(from: TimetableCellRef, to: TimetableCellRef) {
    if (!draft || !draftCells || !tuneCtx) return;
    const next = applyFineTuneSwap(draftCells, { from, to }, tuneCtx, pinned);
    if ("error" in next) {
      setError(next.error);
      return;
    }
    setError("");
    setDraft({ ...draft, swaps: [...draft.swaps, { from, to }], history: [...draft.history, next.cells] });
  }

  function undoSwap() {
    if (!draft || draft.swaps.length === 0) return;
    setDraft({ ...draft, swaps: draft.swaps.slice(0, -1), history: draft.history.slice(0, -1) });
  }

  function cancelFineTune() {
    if (!confirmDiscard()) return;
    setDraft(null);
    setError("");
  }

  async function saveFineTune() {
    if (!draft || !dirty) return;
    setTuneBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/terms/${termId}/v3/fine-tune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersionId: draft.baseId, swaps: draft.swaps }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; version?: number; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "저장하지 못했습니다.");
        return;
      }
      const list = await fetchVersions();
      if (list) setVersions(list);
      setDraft(null);
      setSelectedId(data.id);
      setNotice(`미세 조정한 시간표를 저장 ${data.version}(으)로 저장했습니다. 지금 현재 시간표입니다.`);
    } finally {
      setTuneBusy(false);
    }
  }

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
          if (draft && id !== draft.baseId) {
            if (!confirmDiscard()) return;
            setDraft(null);
          }
          setError("");
          setSelectedId(id);
        }}
      />
      <V3DownloadMenu
        cells={cells}
        schedules={schedules}
        classCounts={classCounts}
        teachers={teachers}
        teacherGroups={teacherGroups}
        versionNumber={selected?.versionNumber ?? null}
        termPeriod={termPeriod}
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
            {draft ? null : (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={!cells || tuneBusy}
                  onClick={() => void startFineTune()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {tuneBusy ? "준비 중…" : "미세 조정"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void remove(selected)}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "삭제 중…" : "이 저장본 삭제"}
                </button>
              </div>
            )}
          </div>
          {draft ? (
            <div className="sticky top-40 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-300 bg-sky-50 px-5 py-3 shadow-sm">
              <div className="min-w-0 text-sm text-sky-950">
                <p className="font-semibold">
                  미세 조정 중 · 저장 {draft.baseNumber}에서 시작 · 맞바꾼 횟수 {draft.swaps.length}
                </p>
                {draftMetrics ? (
                  <p className="mt-0.5 text-xs text-sky-900">
                    점심 연강 {draftMetrics.before.lunch}→{draftMetrics.now.lunch} · 3연강 {draftMetrics.before.triple}→
                    {draftMetrics.now.triple} · 같은 날 교과 {draftMetrics.before.sameDay}→{draftMetrics.now.sameDay}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-sky-800">
                  전체 교사 시간표에서 공통 수업을 클릭해 집고 같은 학반의 다른 칸을 클릭하면 맞바뀝니다. 저장하면 새 저장본이 되고
                  현재 시간표가 됩니다.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={!dirty || tuneBusy}
                  onClick={undoSwap}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  한 단계 되돌리기
                </button>
                <button
                  type="button"
                  disabled={tuneBusy}
                  onClick={cancelFineTune}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={!dirty || tuneBusy}
                  onClick={() => void saveFineTune()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {tuneBusy ? "저장 중…" : "새 저장본으로 저장"}
                </button>
              </div>
            </div>
          ) : null}
          {draftCells || cells ? (
            <V3TimetableView
              key={draft ? `tune-${draft.baseId}` : "view"}
              cells={draftCells ?? cells ?? []}
              schedules={schedules}
              classCounts={classCounts}
              teachers={teachers}
              teacherGroups={teacherGroups}
              fixedSetKeys={fixedSetKeys}
              defaultView={draft ? "allTeachers" : "class"}
              fineTune={
                draft && tuneCtx
                  ? { swapping: tuneBusy, onSwap: swapInDraft, forbiddenSlots: tuneCtx.forbiddenSlots, isLocked }
                  : undefined
              }
            />
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
