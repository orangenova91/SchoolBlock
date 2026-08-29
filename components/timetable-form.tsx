"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TimetableAllTeachersView } from "@/components/timetable-all-teachers-view";
import { TimetableGrid } from "@/components/timetable-grid";
import { TimetableGradeView } from "@/components/timetable-grade-view";
import { TimetableTeacherView } from "@/components/timetable-teacher-view";
import {
  TimetableVersionPanel,
  type TimetableVersionSummary,
} from "@/components/timetable-version-panel";
import { subjectSetBadgeClass } from "@/lib/subjects";
import type { TimetableCellRef } from "@/lib/timetable-swap";
import { cellsForClass, maxPeriods } from "@/lib/timetable";
import {
  GRADES,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  dayLabel,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type SameDaySubjectViolation,
  type Semester,
  type SoftRunDetail,
  type Teacher,
  type TimetableCell,
  type TimetableUnplaced,
  type Weekday,
} from "@/lib/types";

/** Shared formatter for teacher-based soft-run diagnostics (lunch doubles, 3연강). */
function formatSoftRunDetail(detail: SoftRunDetail): string {
  const periods =
    detail.startPeriod === detail.endPeriod
      ? `${detail.startPeriod}교시`
      : `${detail.startPeriod}–${detail.endPeriod}교시`;
  return `${dayLabel(detail.day)}${periods} · ${detail.teacherName} · ${detail.subjectName}`;
}

function formatSameDaySubjectViolation(detail: SameDaySubjectViolation): string {
  const periods = detail.periods.map((p) => `${p}교시`).join("·");
  return `${dayLabel(detail.day)} ${detail.grade}학년 ${detail.classNo}반 · ${detail.subjectName}(${detail.teacherName}) · ${periods}`;
}

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type TimetableFormProps = {
  termId: string;
};

function cellAt(
  cells: TimetableCell[],
  grade: Grade,
  classNo: number,
  day: Weekday,
  period: number,
): TimetableCell | undefined {
  return cells.find(
    (c) =>
      c.grade === grade &&
      c.classNo === classNo &&
      c.day === day &&
      c.period === period,
  );
}

export function TimetableForm({ termId }: TimetableFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [schedules, setSchedules] = useState<GradeDaySchedules>(
    createDefaultGradeDaySchedules(),
  );
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(
    createDefaultClassCounts(),
  );
  const [cells, setCells] = useState<TimetableCell[]>([]);
  const [unplaced, setUnplaced] = useState<TimetableUnplaced[]>([]);
  const [lunchDoubleCount, setLunchDoubleCount] = useState(0);
  const [lunchDoubles, setLunchDoubles] = useState<SoftRunDetail[]>([]);
  const [tripleRunCount, setTripleRunCount] = useState(0);
  const [tripleRuns, setTripleRuns] = useState<SoftRunDetail[]>([]);
  const [sameDaySubjectViolationCount, setSameDaySubjectViolationCount] =
    useState(0);
  const [sameDaySubjectViolations, setSameDaySubjectViolations] = useState<
    SameDaySubjectViolation[]
  >([]);
  const [status, setStatus] = useState<"idle" | "ready" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [previewKind, setPreviewKind] = useState<
    "lunch" | "sameDay" | "full" | null
  >(null);
  const [lunchStatus, setLunchStatus] = useState<"idle" | "ready" | "failed">(
    "idle",
  );
  const [lunchMessage, setLunchMessage] = useState("");
  const [lunchLockCount, setLunchLockCount] = useState(0);
  const [avoidLunchDouble, setAvoidLunchDouble] = useState(true);
  const [avoidTriplePeriod, setAvoidTriplePeriod] = useState(true);
  const [sameDaySubjectStatus, setSameDaySubjectStatus] = useState<
    "idle" | "ready" | "failed"
  >("idle");
  const [sameDaySubjectMessage, setSameDaySubjectMessage] = useState("");
  const [sameDaySubjectLockCount, setSameDaySubjectLockCount] = useState(0);
  const [avoidSameDaySubject, setAvoidSameDaySubject] = useState(false);
  const [sameSetTeacherConflictCount, setSameSetTeacherConflictCount] =
    useState(0);
  const [sameSetTeacherConflictMessages, setSameSetTeacherConflictMessages] =
    useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lunchGenerating, setLunchGenerating] = useState(false);
  const [sameDayGenerating, setSameDayGenerating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [viewGrade, setViewGrade] = useState<Grade>(1);
  const [viewClass, setViewClass] = useState(1);
  const [viewMode, setViewMode] = useState<
    "class" | "teacher" | "grade" | "allTeachers"
  >("class");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<TimetableVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [selectedVersionCells, setSelectedVersionCells] = useState<
    TimetableCell[] | null
  >(null);
  const [selectedVersionMeta, setSelectedVersionMeta] =
    useState<TimetableVersionSummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(
    null,
  );
  const [versionMessage, setVersionMessage] = useState("");
  const [swapping, setSwapping] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [ttRes, scheduleRes, preferencesRes, teachersRes, versionsRes] =
          await Promise.all([
            fetch(`/api/terms/${termId}/timetable`),
            fetch(`/api/terms/${termId}/day-schedule`),
            fetch(`/api/terms/${termId}/preferences`),
            fetch(`/api/terms/${termId}/teachers`),
            fetch(`/api/terms/${termId}/timetable/versions`),
          ]);
        const tt = (await ttRes.json()) as {
          term?: TermSummary;
          status?: "idle" | "ready" | "failed";
          cells?: TimetableCell[];
          unplaced?: TimetableUnplaced[];
          message?: string | null;
          error?: string;
          lunchDoubleCount?: number;
          lunchDoubles?: SoftRunDetail[];
          tripleRunCount?: number;
          tripleRuns?: SoftRunDetail[];
          lunchStatus?: "idle" | "ready" | "failed";
          lunchMessage?: string | null;
          lunchLockCount?: number;
          sameDaySubjectViolationCount?: number;
          sameDaySubjectViolations?: SameDaySubjectViolation[];
          sameDaySubjectStatus?: "idle" | "ready" | "failed";
          sameDaySubjectMessage?: string | null;
          sameDaySubjectLockCount?: number;
          sameSetTeacherConflictCount?: number;
          sameSetTeacherConflictMessages?: string[];
        };
        const schedule = (await scheduleRes.json()) as {
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
        };
        const preferencesData = (await preferencesRes.json()) as {
          preferences?: {
            avoidLunchDouble?: boolean;
            avoidTriplePeriod?: boolean;
            avoidSameDaySubject?: boolean;
          };
        };
        const teachersData = (await teachersRes.json()) as {
          teachers?: Teacher[];
        };
        const versionsData = (await versionsRes.json()) as {
          versions?: TimetableVersionSummary[];
        };

        if (!ttRes.ok) {
          if (!cancelled) {
            setError(tt.error ?? "시간표를 불러오지 못했습니다.");
            setVersionsLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setTerm(tt.term ?? null);
          setStatus(tt.status ?? "idle");
          setCells(Array.isArray(tt.cells) ? tt.cells : []);
          setUnplaced(Array.isArray(tt.unplaced) ? tt.unplaced : []);
          setMessage(tt.message ?? "");
          setLunchDoubleCount(tt.lunchDoubleCount ?? 0);
          setLunchDoubles(Array.isArray(tt.lunchDoubles) ? tt.lunchDoubles : []);
          setTripleRunCount(tt.tripleRunCount ?? 0);
          setTripleRuns(Array.isArray(tt.tripleRuns) ? tt.tripleRuns : []);
          setPreviewKind(
            Array.isArray(tt.cells) && tt.cells.length > 0 ? "full" : null,
          );
          setLunchStatus(tt.lunchStatus ?? "idle");
          setLunchMessage(tt.lunchMessage ?? "");
          setLunchLockCount(tt.lunchLockCount ?? 0);
          setSameDaySubjectViolationCount(tt.sameDaySubjectViolationCount ?? 0);
          setSameDaySubjectViolations(
            Array.isArray(tt.sameDaySubjectViolations)
              ? tt.sameDaySubjectViolations
              : [],
          );
          setSameDaySubjectStatus(tt.sameDaySubjectStatus ?? "idle");
          setSameDaySubjectMessage(tt.sameDaySubjectMessage ?? "");
          setSameDaySubjectLockCount(tt.sameDaySubjectLockCount ?? 0);
          setSameSetTeacherConflictCount(tt.sameSetTeacherConflictCount ?? 0);
          setSameSetTeacherConflictMessages(
            Array.isArray(tt.sameSetTeacherConflictMessages)
              ? tt.sameSetTeacherConflictMessages
              : [],
          );
          if (preferencesRes.ok) {
            setAvoidLunchDouble(
              preferencesData.preferences?.avoidLunchDouble ?? true,
            );
            setAvoidTriplePeriod(
              preferencesData.preferences?.avoidTriplePeriod ?? true,
            );
            setAvoidSameDaySubject(
              preferencesData.preferences?.avoidSameDaySubject ?? false,
            );
          }
          if (scheduleRes.ok) {
            setSchedules(schedule.grades ?? createDefaultGradeDaySchedules());
            setClassCounts(
              schedule.classCounts ?? createDefaultClassCounts(),
            );
          }
          if (teachersRes.ok) {
            setTeachers(
              Array.isArray(teachersData.teachers) ? teachersData.teachers : [],
            );
          }
          if (versionsRes.ok) {
            setVersions(
              Array.isArray(versionsData.versions) ? versionsData.versions : [],
            );
          }
        }
      } catch {
        if (!cancelled) setError("서버에 연결할 수 없습니다.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setVersionsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [termId]);

  useEffect(() => {
    const max = classCounts[viewGrade] ?? 1;
    if (viewClass > max) setViewClass(1);
  }, [viewGrade, classCounts, viewClass]);

  const periodRows = useMemo(
    () => maxPeriods(schedules, viewGrade),
    [schedules, viewGrade],
  );

  const displayedCells = selectedVersionCells ?? cells;

  const classCells = useMemo(
    () => cellsForClass(displayedCells, viewGrade, viewClass),
    [displayedCells, viewGrade, viewClass],
  );

  const canConfirm =
    previewKind === "full" &&
    status === "ready" &&
    cells.length > 0 &&
    unplaced.length === 0;

  const actionsBusy =
    generating ||
    lunchGenerating ||
    sameDayGenerating ||
    resetting ||
    confirming ||
    deletingVersionId !== null ||
    swapping;

  function clearVersionView() {
    setSelectedVersionId(null);
    setSelectedVersionCells(null);
    setSelectedVersionMeta(null);
  }

  async function handleSelectVersion(id: string | null) {
    if (!id) {
      clearVersionView();
      return;
    }
    setError("");
    setVersionMessage("");
    try {
      const response = await fetch(
        `/api/terms/${termId}/timetable/versions/${id}`,
      );
      const data = (await response.json()) as {
        version?: TimetableVersionSummary & { cells?: TimetableCell[] };
        error?: string;
      };
      if (!response.ok || !data.version) {
        setError(data.error ?? "확정 버전을 불러오지 못했습니다.");
        return;
      }
      setSelectedVersionId(id);
      setSelectedVersionCells(
        Array.isArray(data.version.cells) ? data.version.cells : [],
      );
      setSelectedVersionMeta({
        id: data.version.id,
        versionNumber: data.version.versionNumber,
        createdAt:
          typeof data.version.createdAt === "string"
            ? data.version.createdAt
            : String(data.version.createdAt),
        lunchDoubleCount: data.version.lunchDoubleCount,
        tripleRunCount: data.version.tripleRunCount,
        sameDaySubjectViolationCount: data.version.sameDaySubjectViolationCount,
      });
    } catch {
      setError("서버에 연결할 수 없습니다.");
    }
  }

  async function handleConfirmVersion() {
    setConfirming(true);
    setError("");
    setVersionMessage("");
    try {
      const response = await fetch(`/api/terms/${termId}/timetable/versions`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        version?: TimetableVersionSummary;
        error?: string;
      };
      if (!response.ok || !data.version) {
        setError(data.error ?? "확정에 실패했습니다.");
        return;
      }
      const created: TimetableVersionSummary = {
        ...data.version,
        createdAt:
          typeof data.version.createdAt === "string"
            ? data.version.createdAt
            : String(data.version.createdAt),
      };
      setVersions((prev) => [created, ...prev]);
      setVersionMessage(`확정 ${created.versionNumber}으로 저장했습니다.`);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleDeleteVersion(id: string) {
    const target = versions.find((item) => item.id === id);
    const confirmed = window.confirm(
      `확정 ${target?.versionNumber ?? ""} 버전을 삭제할까요?`,
    );
    if (!confirmed) return;

    setDeletingVersionId(id);
    setError("");
    setVersionMessage("");
    try {
      const response = await fetch(
        `/api/terms/${termId}/timetable/versions/${id}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "버전 삭제에 실패했습니다.");
        return;
      }
      setVersions((prev) => prev.filter((item) => item.id !== id));
      if (selectedVersionId === id) clearVersionView();
      setVersionMessage("확정 버전을 삭제했습니다.");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setDeletingVersionId(null);
    }
  }

  async function handleSwapCells(from: TimetableCellRef, to: TimetableCellRef) {
    setSwapping(true);
    setError("");
    setVersionMessage("");
    try {
      const response = await fetch(`/api/terms/${termId}/timetable/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = (await response.json()) as {
        cells?: TimetableCell[];
        lunchDoubleCount?: number;
        lunchDoubles?: SoftRunDetail[];
        tripleRunCount?: number;
        tripleRuns?: SoftRunDetail[];
        sameDaySubjectViolationCount?: number;
        sameDaySubjectViolations?: SameDaySubjectViolation[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "수업을 맞바꾸지 못했습니다.");
        return;
      }
      setCells(Array.isArray(data.cells) ? data.cells : cells);
      setLunchDoubleCount(data.lunchDoubleCount ?? 0);
      setLunchDoubles(Array.isArray(data.lunchDoubles) ? data.lunchDoubles : []);
      setTripleRunCount(data.tripleRunCount ?? 0);
      setTripleRuns(Array.isArray(data.tripleRuns) ? data.tripleRuns : []);
      setSameDaySubjectViolationCount(data.sameDaySubjectViolationCount ?? 0);
      setSameDaySubjectViolations(
        Array.isArray(data.sameDaySubjectViolations)
          ? data.sameDaySubjectViolations
          : [],
      );
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setSwapping(false);
    }
  }

  async function handleGenerate() {
    clearVersionView();
    setGenerating(true);
    setError("");
    setMessage("");
    setVersionMessage("");
    try {
      const response = await fetch(`/api/terms/${termId}/timetable`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        status?: "ready" | "failed";
        cells?: TimetableCell[];
        unplaced?: TimetableUnplaced[];
        message?: string;
        error?: string;
        lunchDoubleCount?: number;
        lunchDoubles?: SoftRunDetail[];
        tripleRunCount?: number;
        tripleRuns?: SoftRunDetail[];
        sameDaySubjectViolationCount?: number;
        sameDaySubjectViolations?: SameDaySubjectViolation[];
      };
      if (!response.ok) {
        setError(data.error ?? "시간표 생성에 실패했습니다.");
        return;
      }
      setStatus(data.status ?? "failed");
      setCells(Array.isArray(data.cells) ? data.cells : []);
      setUnplaced(Array.isArray(data.unplaced) ? data.unplaced : []);
      setMessage(data.message ?? "");
      setLunchDoubleCount(data.lunchDoubleCount ?? 0);
      setLunchDoubles(Array.isArray(data.lunchDoubles) ? data.lunchDoubles : []);
      setTripleRunCount(data.tripleRunCount ?? 0);
      setTripleRuns(Array.isArray(data.tripleRuns) ? data.tripleRuns : []);
      setSameDaySubjectViolationCount(data.sameDaySubjectViolationCount ?? 0);
      setSameDaySubjectViolations(
        Array.isArray(data.sameDaySubjectViolations)
          ? data.sameDaySubjectViolations
          : [],
      );
      setPreviewKind("full");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSameDaySubjectPriority() {
    clearVersionView();
    setSameDayGenerating(true);
    setError("");
    setSameDaySubjectMessage("");
    try {
      const response = await fetch(
        `/api/terms/${termId}/timetable/same-day-subject-priority`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        sameDaySubjectStatus?: "ready" | "failed";
        sameDaySubjectMessage?: string;
        targetCount?: number;
        filledCount?: number;
        cells?: TimetableCell[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "동일 교과 우선 배치에 실패했습니다.");
        return;
      }
      setSameDaySubjectStatus(data.sameDaySubjectStatus ?? "failed");
      setSameDaySubjectMessage(data.sameDaySubjectMessage ?? "");
      setSameDaySubjectLockCount(data.filledCount ?? 0);
      setCells(Array.isArray(data.cells) ? data.cells : []);
      setUnplaced([]);
      setPreviewKind("sameDay");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setSameDayGenerating(false);
    }
  }

  async function handleLunchPriority() {
    clearVersionView();
    setLunchGenerating(true);
    setError("");
    setLunchMessage("");
    try {
      const response = await fetch(
        `/api/terms/${termId}/timetable/lunch-priority`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        lunchStatus?: "ready" | "failed";
        lunchMessage?: string;
        targetCount?: number;
        filledCount?: number;
        cells?: TimetableCell[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "점심시간 우선 배치에 실패했습니다.");
        return;
      }
      setLunchStatus(data.lunchStatus ?? "failed");
      setLunchMessage(data.lunchMessage ?? "");
      setLunchLockCount(data.filledCount ?? 0);
      setCells(Array.isArray(data.cells) ? data.cells : []);
      setUnplaced([]);
      setPreviewKind("lunch");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLunchGenerating(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(
      "작업 중인 시간표와 점심시간·동일 교과 우선 배치 결과를 초기화할까요? 확정한 버전은 그대로 남습니다.",
    );
    if (!confirmed) return;

    clearVersionView();
    setResetting(true);
    setVersionMessage("");
    setError("");
    try {
      const response = await fetch(`/api/terms/${termId}/timetable`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "초기화에 실패했습니다.");
        return;
      }
      setStatus("idle");
      setCells([]);
      setUnplaced([]);
      setMessage("");
      setLunchDoubleCount(0);
      setLunchDoubles([]);
      setLunchStatus("idle");
      setLunchMessage("");
      setLunchLockCount(0);
      setSameDaySubjectViolationCount(0);
      setSameDaySubjectViolations([]);
      setSameDaySubjectStatus("idle");
      setSameDaySubjectMessage("");
      setSameDaySubjectLockCount(0);
      setPreviewKind(null);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        불러오는 중…
      </p>
    );
  }

  if (error && !term) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="relative w-full">
      <div className="mb-6 lg:absolute lg:top-0 lg:right-full lg:mb-0 lg:mr-4 lg:w-60">
        <TimetableVersionPanel
          versions={versions}
          selectedId={selectedVersionId}
          loading={versionsLoading}
          confirming={confirming}
          deletingId={deletingVersionId}
          canConfirm={canConfirm}
          busy={actionsBusy}
          onSelect={(id) => void handleSelectVersion(id)}
          onConfirm={() => void handleConfirmVersion()}
          onDelete={(id) => void handleDeleteVersion(id)}
        />
      </div>
      <div className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          시간표 생성
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          SET 블록·교과 블록을 고정하고 교사 배정 불가·추가 조건(점심 연강 등)을
          반영한 뒤 공통 수업을 자동 배치합니다.
        </p>
        {selectedVersionMeta ? (
          <p className="mt-2 text-sm font-medium text-zinc-700">
            확정 {selectedVersionMeta.versionNumber} 보는 중
          </p>
        ) : null}
        <p className="mt-1 text-xs text-zinc-500">
          {avoidSameDaySubject && avoidLunchDouble
            ? "테스트 단계: 동일 교과 우선 배치 → 점심시간 우선 배치 → 남은 시간 시간표 배치 순서로 진행합니다. (둘 다 여러 번 가능)"
            : avoidSameDaySubject
              ? "테스트 단계: 동일 교과 우선 배치(여러 번 가능)로 먼저 선택한 교과를 배치한 뒤, 남은 시간 시간표 배치로 나머지를 채웁니다."
              : avoidLunchDouble
                ? "테스트 단계: 점심시간 우선 배치(여러 번 가능)로 먼저 점심 전후 교시를 확정한 뒤, 남은 시간 시간표 배치로 나머지를 채웁니다."
                : "점심시간 연강 배제·동일 교과 배치 금지가 모두 꺼져 있어 시간표 배치 한 번으로 전체를 채웁니다."}
        </p>
      </header>

      {sameSetTeacherConflictCount > 0 ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">
            같은 SET 내부 교사 겹침 {sameSetTeacherConflictCount}건 — 같은
            시간에 한 교사가 서로 다른 반의 수업을 동시에 맡도록 되어 있어
            배치가 불가능합니다. SET 블록 배치 또는 수업 배정에서 교사를
            다시 확인해 주세요.
          </p>
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
            {sameSetTeacherConflictMessages.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/preferences`)}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        {avoidSameDaySubject ? (
          <button
            type="button"
            onClick={() => {
              void handleSameDaySubjectPriority();
            }}
            disabled={
              generating || lunchGenerating || sameDayGenerating || resetting || swapping
            }
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sameDayGenerating
              ? "동일 교과 배치 중… (최대 약 15초)"
              : "동일 교과 우선 배치"}
          </button>
        ) : null}
        {avoidLunchDouble ? (
          <button
            type="button"
            onClick={() => {
              void handleLunchPriority();
            }}
            disabled={
              generating || lunchGenerating || sameDayGenerating || resetting || swapping
            }
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {lunchGenerating
              ? "점심시간 배치 중… (최대 약 15초)"
              : "점심시간 우선 배치"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void handleGenerate();
          }}
          disabled={
            generating || lunchGenerating || sameDayGenerating || resetting || swapping
          }
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating
            ? "생성 중… (최대 약 15초)"
            : avoidSameDaySubject || avoidLunchDouble
              ? "남은 시간 시간표 배치"
              : "시간표 배치"}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleReset();
          }}
          disabled={
            (status === "idle" &&
              lunchLockCount === 0 &&
              sameDaySubjectLockCount === 0) ||
            generating ||
            lunchGenerating ||
            sameDayGenerating ||
            resetting ||
            swapping
          }
          className="rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resetting ? "초기화 중…" : "초기화"}
        </button>
      </div>

      {versionMessage ? (
        <p className="text-center text-sm text-emerald-700" role="status">
          {versionMessage}
        </p>
      ) : null}

      {message && !selectedVersionId ? (
        <div>
          <p className="mb-1 text-center text-xs font-medium text-zinc-500">
            {avoidSameDaySubject || avoidLunchDouble
              ? "남은 시간 시간표 배치 결과"
              : "시간표 배치 결과"}
          </p>
          <pre
            role="status"
            className={`whitespace-pre-wrap rounded-xl border px-4 py-3 text-left text-sm leading-relaxed ${
              status === "failed"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {message}
          </pre>
        </div>
      ) : null}

      {error ? (
        <p className="text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {unplaced.length > 0 && !selectedVersionId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">미배치 공통 수업</p>
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
            {unplaced.map((u) => (
              <li
                key={`${u.teacherName}-${u.grade}-${u.classNo}-${u.subjectName}`}
              >
                {u.grade}학년 {u.classNo}반 {u.subjectName} · {u.teacherName}{" "}
                ({u.remaining}차시)
                {u.reason === "impossible" ? (
                  <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                    배치 불가능 · 동시간 수업 존재
                  </span>
                ) : u.reason === "contention" ? (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    자리 경합 · 재시도 시 배치 가능
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {previewKind === "sameDay" ? (
        <p className="text-center text-xs font-medium text-sky-700">
          아래는 동일 교과 우선 배치 미리보기입니다. 저장된 최종 시간표가
          아니며, 만족스러우면 다음 단계로 이어서 진행해 주세요.
        </p>
      ) : null}

      {previewKind === "lunch" ? (
        <p className="text-center text-xs font-medium text-sky-700">
          아래는 점심시간 우선 배치 미리보기입니다. 저장된 최종 시간표가
          아니며, 만족스러우면 &ldquo;남은 시간 시간표 배치&rdquo;로 마무리해
          주세요.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {(
          [
            { key: "class", label: "학반별" },
            { key: "teacher", label: "교사별" },
            { key: "grade", label: "학년 전체" },
            { key: "allTeachers", label: "전체 교사(미세 조정)" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setViewMode(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              viewMode === tab.key
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
            }`}
          >
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
                onClick={() => setViewGrade(grade)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  viewGrade === grade
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
                }`}
              >
                {grade}학년
              </button>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-center gap-1.5">
            {Array.from(
              { length: classCounts[viewGrade] ?? 0 },
              (_, i) => i + 1,
            ).map((classNo) => (
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

          {displayedCells.length === 0 && status === "idle" ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              시간표 생성을 누르면 결과가 표시됩니다.
            </p>
          ) : (
            <>
              <TimetableGrid
                periodRows={periodRows}
                isActive={(day, period) =>
                  (schedules[viewGrade][day] ?? 0) >= period
                }
                renderCell={(day, period, active) => {
                  const cell = active
                    ? cellAt(classCells, viewGrade, viewClass, day, period)
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
                          <p className="text-[11px] font-semibold leading-tight text-zinc-900">
                            {cell.subjectName}
                          </p>
                          <p className="mt-0.5 text-[10px] leading-tight text-zinc-600">
                            {cell.teacherName}
                          </p>
                        </>
                      ) : null}
                    </div>
                  );
                }}
              />
              <p className="mt-3 text-center text-xs text-zinc-500">
                {viewGrade}학년 {viewClass}반 · 수업 {classCells.length}칸
              </p>
            </>
          )}
        </section>
      ) : viewMode === "teacher" ? (
        <TimetableTeacherView
          cells={displayedCells}
          schedules={schedules}
          teachers={teachers}
        />
      ) : viewMode === "grade" ? (
        <TimetableGradeView
          cells={displayedCells}
          schedules={schedules}
          classCounts={classCounts}
        />
      ) : (
        <TimetableAllTeachersView
          cells={displayedCells}
          schedules={schedules}
          teachers={teachers}
          swapEnabled={
            !selectedVersionId && previewKind === "full" && cells.length > 0
          }
          swapping={swapping}
          onSwap={(from, to) => void handleSwapCells(from, to)}
        />
      )}

      {avoidSameDaySubject || avoidLunchDouble ? (
        <div className="grid grid-cols-1 gap-1 text-center text-xs text-zinc-500 lg:grid-cols-3">
          {avoidSameDaySubject ? (
            <p>
              저장된 동일 교과 우선 배치:{" "}
              {sameDaySubjectLockCount > 0
                ? `${sameDaySubjectLockCount}칸 (${
                    sameDaySubjectStatus === "ready" ? "성공" : "일부 실패"
                  })`
                : "없음 (다음 단계는 잠금 없이 진행됩니다)"}
            </p>
          ) : (
            <span />
          )}
          {avoidLunchDouble ? (
            <p>
              저장된 점심시간 배치:{" "}
              {lunchLockCount > 0
                ? `${lunchLockCount}칸 (${
                    lunchStatus === "ready" ? "성공" : "일부 실패"
                  })`
                : "없음 (남은 시간 시간표 배치는 잠금 없이 진행됩니다)"}
            </p>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      {(avoidSameDaySubject && sameDaySubjectMessage) ||
      (avoidLunchDouble && lunchMessage) ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {avoidSameDaySubject && sameDaySubjectMessage ? (
            <div>
              <p className="mb-1 text-center text-xs font-medium text-zinc-500">
                동일 교과 우선 배치 결과
              </p>
              <pre
                role="status"
                className={`whitespace-pre-wrap rounded-xl border px-4 py-3 text-left text-sm leading-relaxed ${
                  sameDaySubjectStatus === "failed"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {sameDaySubjectMessage}
              </pre>
            </div>
          ) : null}

          {avoidLunchDouble && lunchMessage ? (
            <div>
              <p className="mb-1 text-center text-xs font-medium text-zinc-500">
                점심시간 우선 배치 결과
              </p>
              <pre
                role="status"
                className={`whitespace-pre-wrap rounded-xl border px-4 py-3 text-left text-sm leading-relaxed ${
                  lunchStatus === "failed"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {lunchMessage}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedVersionMeta ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm text-zinc-600">
          확정 {selectedVersionMeta.versionNumber} · 점심 연강{" "}
          {selectedVersionMeta.lunchDoubleCount}건 · 3연강{" "}
          {selectedVersionMeta.tripleRunCount}건 · 동일 교과 같은 날 중복{" "}
          {selectedVersionMeta.sameDaySubjectViolationCount}건
        </div>
      ) : previewKind === "full" && cells.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              sameDaySubjectViolationCount > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <p className="font-medium">
              동일 교과 같은 날 중복 {sameDaySubjectViolationCount}건
              {!avoidSameDaySubject && sameDaySubjectViolationCount > 0
                ? " (동일 교과 배치 금지가 꺼져 있어 참고용으로만 표시됩니다)"
                : null}
            </p>
            {sameDaySubjectViolationCount > 0 ? (
              <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
                {sameDaySubjectViolations.map((v, i) => (
                  <li key={`${v.teacherName}-${v.day}-${i}`}>
                    {formatSameDaySubjectViolation(v)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              lunchDoubleCount > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <p className="font-medium">
              점심시간 연강 {lunchDoubleCount}건
              {!avoidLunchDouble && lunchDoubleCount > 0
                ? " (점심시간 연강 배제가 꺼져 있어 참고용으로만 표시됩니다)"
                : null}
            </p>
            {lunchDoubleCount > 0 ? (
              <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
                {lunchDoubles.map((d, i) => (
                  <li key={`${d.teacherName}-${d.day}-${i}`}>
                    {formatSoftRunDetail(d)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              tripleRunCount > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <p className="font-medium">
              3연강 {tripleRunCount}건
              {!avoidTriplePeriod && tripleRunCount > 0
                ? " (3연강 완화가 꺼져 있어 참고용으로만 표시됩니다)"
                : null}
            </p>
            {tripleRunCount > 0 ? (
              <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
                {tripleRuns.map((d, i) => (
                  <li key={`${d.teacherName}-${d.day}-${i}`}>
                    {formatSoftRunDetail(d)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
