"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { V3DiagnosisReport, V3QuickCheckBox, DIAGNOSE_HINT, DIAGNOSE_LABEL, type V3DiagnoseKind } from "@/components/v3/v3-diagnosis";
import { V3TimetableView } from "@/components/v3/v3-timetable-view";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  dayLabel,
  type GradeClassCounts,
  type GradeDaySchedules,
  type SetBlockCell,
  type Teacher,
  type TimetableCell,
} from "@/lib/types";
import type { V3JobView } from "@/lib/v3/api";
import type { V3Weights } from "@/lib/v3/input";
import type { QuickCheckResult } from "@/lib/v3/quick-check";
import type { V3Judgement, V3Metrics } from "@/lib/v3/score";
import type { V3ScoreDetails } from "@/lib/v3/validate";
import { TIER_LABEL, type V3Estimate, type V3SizeSummary } from "@/lib/v3/estimate";

type EngineKind = "hybrid" | "search" | "milp";

const KIND_LABEL: Record<string, string> = { hybrid: "혼합", search: "탐색", milp: "정수계획", diagnose: "진단" };

const ENGINES: { kind: EngineKind; badge: string; label: string; hint: string }[] = [
  {
    kind: "hybrid",
    badge: "방법1",
    label: "혼합",
    hint: "탐색으로 먼저 완성본을 만든 뒤, 하루·학년 단위로 나눠 정밀 계산으로 다듬습니다. 대부분 가장 좋은 결과를 냅니다.",
  },
  {
    kind: "search",
    badge: "방법2",
    label: "탐색",
    hint: "칸을 바꿔 보며 점수를 조금씩 줄입니다. 빠르게 완성본을 찾지만 더 좋은 답을 놓칠 수 있습니다.",
  },
  {
    kind: "milp",
    badge: "방법3",
    label: "정수계획",
    hint: "시간표 전체를 한 번에 수식으로 풀어 최선을 찾습니다. 작은 학교에 강하고, 큰 학교는 오래 걸립니다.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  queued: "대기 중",
  running: "계산 중",
  stopping: "멈추는 중",
  awaiting: "승인 대기",
  stopped: "중지됨",
  done: "완료",
  infeasible: "배치 불가",
  error: "오류",
};

const STATUS_TONE: Record<string, string> = {
  queued: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  running: "bg-sky-50 text-sky-700 ring-sky-200",
  stopping: "bg-amber-50 text-amber-700 ring-amber-200",
  awaiting: "bg-amber-50 text-amber-800 ring-amber-300",
  stopped: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  infeasible: "bg-red-50 text-red-700 ring-red-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};

const PHASE_LABEL: Record<string, string> = {
  start: "시작하는 중",
  repair: "빠진 수업을 채우는 중",
  improve: "점수를 줄이는 중",
  collect: "서로 다른 결과를 모으는 중",
  diagnose: "진단 중",
};

const STOP_REASON: Record<string, string> = {
  budget: "정한 시간만큼 계산했습니다.",
  user: "요청대로 멈췄습니다. 지금까지 찾은 가장 좋은 결과를 보여 드립니다.",
  early: "목표 점수에 드는 서로 다른 결과 3개를 모아 일찍 끝냈습니다.",
  optimal: "최선임을 증명해 더 계산할 것이 없어 끝냈습니다.",
  memory: "계산 메모리 한도에 닿아 멈췄습니다. 지금까지의 결과를 보여 드립니다.",
  infeasible: "모든 수업을 배치할 수 없는 조건으로 확인되었습니다.",
};

const WEIGHT_ROWS: { key: keyof V3Weights; label: string; pref: "avoidLunchDouble" | "avoidTriplePeriod" | "avoidSameDaySubject" }[] = [
  { key: "lunch", label: "점심시간 연강", pref: "avoidLunchDouble" },
  { key: "triple", label: "3연강", pref: "avoidTriplePeriod" },
  { key: "sameDay", label: "동일 교과 같은 날", pref: "avoidSameDaySubject" },
];

const ACTIVE = ["queued", "running", "stopping"];
const DELETABLE = ["awaiting", "stopped", "done", "infeasible", "error"];
const POLL_MS = 2500;

type Checks = {
  inputHash: string;
  quick: QuickCheckResult;
  size?: V3SizeSummary;
  estimate?: V3Estimate;
  weights: V3Weights;
  diagnoses: Partial<Record<V3DiagnoseKind, V3JobView>>;
};

type ResultView = {
  rank: number;
  metrics: V3Metrics;
  foundAtMs: number;
  judgement: V3Judgement;
  diffFromTop: number;
  cells: TimetableCell[];
  details?: V3ScoreDetails;
};

type Prefs = { avoidLunchDouble?: boolean; avoidTriplePeriod?: boolean; avoidSameDaySubject?: boolean };

const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}`;
};

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export function V3TimetablePanel({ termId }: { termId: string }) {
  const api = `/api/terms/${termId}/v3`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checks, setChecks] = useState<Checks | null>(null);
  const [weights, setWeights] = useState<V3Weights | null>(null);
  const [choices, setChoices] = useState<number[]>([1, 2, 3, 5, 10]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [savingWeights, setSavingWeights] = useState(false);
  const [jobs, setJobs] = useState<V3JobView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; jobId: string; list: ResultView[] }>({ key: "", jobId: "", list: [] });
  const [shownRank, setShownRank] = useState(0);
  const [engineKind, setEngineKind] = useState<EngineKind>("hybrid");
  const [autoContinue, setAutoContinue] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressId, setProgressId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<GradeDaySchedules>(createDefaultGradeDaySchedules());
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(createDefaultClassCounts());
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [fixedSetKeys, setFixedSetKeys] = useState<Set<string>>(new Set());
  const router = useRouter();
  const finishedDiagnoses = useRef<string | null>(null);

  const loadChecks = useCallback(async () => {
    const res = await fetch(`${api}/checks`);
    const data = await readJson<Checks>(res);
    if (!res.ok) throw new Error(data.error ?? "빠른 검사를 불러오지 못했습니다.");
    setChecks(data);
  }, [api]);

  const loadJobs = useCallback(async () => {
    const res = await fetch(`${api}/jobs`);
    const data = await readJson<{ jobs: V3JobView[] }>(res);
    if (!res.ok) throw new Error(data.error ?? "작업 목록을 불러오지 못했습니다.");
    setJobs(data.jobs);
    return data.jobs;
  }, [api]);

  // 처음 불러오기
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settingsRes, prefsRes, scheduleRes, teachersRes, setBlocksRes] = await Promise.all([
          fetch(`${api}/settings`),
          fetch(`/api/terms/${termId}/preferences`),
          fetch(`/api/terms/${termId}/day-schedule`),
          fetch(`/api/terms/${termId}/teachers`),
          fetch(`/api/terms/${termId}/set-blocks`),
        ]);
        const setBlocks = await readJson<{ cells?: SetBlockCell[]; partialCells?: SetBlockCell[] }>(setBlocksRes);
        const settings = await readJson<{ weights: V3Weights; choices: number[] }>(settingsRes);
        const prefsData = await readJson<{ preferences?: Prefs }>(prefsRes);
        const schedule = await readJson<{ grades?: GradeDaySchedules; classCounts?: GradeClassCounts }>(scheduleRes);
        const teachersData = await readJson<{ teachers?: Teacher[] }>(teachersRes);
        if (cancelled) return;
        if (!settingsRes.ok) throw new Error(settings.error ?? "설정을 불러오지 못했습니다.");
        setWeights(settings.weights);
        setChoices(settings.choices);
        setPrefs(prefsData.preferences ?? {});
        if (scheduleRes.ok) {
          setSchedules(schedule.grades ?? createDefaultGradeDaySchedules());
          setClassCounts(schedule.classCounts ?? createDefaultClassCounts());
        }
        if (teachersRes.ok) setTeachers(Array.isArray(teachersData.teachers) ? teachersData.teachers : []);
        if (setBlocksRes.ok) {
          const fixed = [...(setBlocks.cells ?? []), ...(setBlocks.partialCells ?? [])];
          setFixedSetKeys(new Set(fixed.map((c) => `${c.grade}|${c.set}|${c.day}|${c.period}`)));
        }
        await loadChecks();
        const list = await loadJobs();
        if (!cancelled) setSelectedId((prev) => prev ?? list.find((j) => j.kind !== "diagnose")?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, termId, loadChecks, loadJobs]);

  // 계산 중인 작업이 있으면 2.5초마다 상태를 읽는다
  const anyActive = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => {
      void loadJobs().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, loadJobs]);

  // 진단이 끝나면 빠른 검사·진단 결과를 다시 읽는다
  useEffect(() => {
    const key = jobs.filter((j) => j.kind === "diagnose" && !ACTIVE.includes(j.status)).map((j) => j.id).join(",");
    if (key === finishedDiagnoses.current) return;
    const first = finishedDiagnoses.current === null;
    finishedDiagnoses.current = key;
    if (!first) void loadChecks().catch(() => undefined);
  }, [jobs, loadChecks]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  // 고른 작업의 결과는 구간이 끝날 때만 바뀐다
  const wantKey = selected && selected.kind !== "diagnose" ? `${selected.id}:${selected.segments}:${selected.status}:${selected.results.length}:${selected.lowerBound}` : "";
  const jobIdToLoad = selected && selected.results.length > 0 && wantKey !== loaded.key ? selected.id : null;
  useEffect(() => {
    if (!jobIdToLoad) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${api}/jobs/${jobIdToLoad}/results`);
      const data = await readJson<{ results: ResultView[] }>(res);
      if (cancelled || !res.ok) return;
      setLoaded({ key: wantKey, jobId: jobIdToLoad, list: data.results });
      setShownRank((r) => (r < data.results.length ? r : 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [api, jobIdToLoad, wantKey]);
  // 다른 작업을 고르면 그 작업의 결과가 올 때까지 비운다
  const results = selected && selected.results.length > 0 && loaded.jobId === selected.id ? loaded.list : [];

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const startJob = (kind: EngineKind) =>
    act(async () => {
      const res = await fetch(`${api}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, autoContinue }),
      });
      const data = await readJson<{ job: V3JobView; boundJobId: string | null }>(res);
      if (!res.ok) throw new Error(data.error ?? "작업을 만들지 못했습니다.");
      setSelectedId(data.job.id);
      setProgressId(data.job.id);
      setNotice(
        `#${data.job.number} ${KIND_LABEL[kind]} 작업을 대기열에 넣었습니다.${data.boundJobId ? " 목표 기준을 정하려고 이론상 최선 계산도 함께 넣었습니다." : ""}`,
      );
      await loadJobs();
    });

  const startDiagnosis = (diagnose: V3DiagnoseKind) =>
    act(async () => {
      const res = await fetch(`${api}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "diagnose", diagnose }),
      });
      const data = await readJson<{ job: V3JobView }>(res);
      if (!res.ok) throw new Error(data.error ?? "진단을 시작하지 못했습니다.");
      setNotice(`${DIAGNOSE_LABEL[diagnose]}을(를) 대기열에 넣었습니다.`);
      await loadJobs();
    });

  const stopJob = (job: V3JobView) =>
    act(async () => {
      const res = await fetch(`${api}/jobs/${job.id}/stop`, { method: "POST" });
      const data = await readJson<object>(res);
      if (!res.ok) throw new Error(data.error ?? "멈추지 못했습니다.");
      await loadJobs();
    });

  const continueJob = (job: V3JobView) =>
    act(async () => {
      const res = await fetch(`${api}/jobs/${job.id}/continue`, { method: "POST" });
      const data = await readJson<object>(res);
      if (!res.ok) throw new Error(data.error ?? "이어 돌리지 못했습니다.");
      setNotice(`#${job.number} 작업을 중단점에서 이어 돌립니다.`);
      await loadJobs();
    });

  const toggleJobAuto = (job: V3JobView, value: boolean) =>
    act(async () => {
      const res = await fetch(`${api}/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoContinue: value }),
      });
      const data = await readJson<object>(res);
      if (!res.ok) throw new Error(data.error ?? "바꾸지 못했습니다.");
      await loadJobs();
    });

  const deleteJob = (job: V3JobView) => {
    const warn = job.status === "awaiting" ? "\n승인 대기 중인 작업이라, 지우면 더 이어 계산할 수 없습니다." : "";
    if (!window.confirm(`#${job.number} ${KIND_LABEL[job.kind]} 작업을 삭제할까요?\n저장한 최종 시간표는 그대로 남습니다.${warn}`)) return;
    void act(async () => {
      const res = await fetch(`${api}/jobs/${job.id}`, { method: "DELETE" });
      const data = await readJson<object>(res);
      if (!res.ok) throw new Error(data.error ?? "삭제하지 못했습니다.");
      setProgressId(null);
      setSelectedId((id) => (id === job.id ? null : id));
      setNotice(`#${job.number} ${KIND_LABEL[job.kind]} 작업을 삭제했습니다.`);
      await loadJobs();
    });
  };

  const applyResult = (job: V3JobView, rank: number) => {
    if (
      !window.confirm(
        `#${job.number} ${KIND_LABEL[job.kind]}의 ${rank + 1}번 결과를 최종 시간표로 저장할까요?\n현재 시간표가 이 결과로 바뀌고, 저장한 뒤 9. 최종 시간표로 이동합니다.`,
      )
    )
      return;
    setApplying(rank);
    void act(async () => {
      const res = await fetch(`${api}/jobs/${job.id}/results/${rank}/apply`, { method: "POST" });
      const data = await readJson<{ version: number | null; warning?: string; note: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "저장하지 못했습니다.");
      // 저장 개수가 꽉 차 목록에 남지 않았으면 경고를 보이도록 이 화면에 남는다
      if (data.version === null) {
        setNotice(data.warning ?? `${rank + 1}번 결과를 현재 시간표로 바꿨습니다. (${data.note})`);
        return;
      }
      router.push(`/v3/terms/${termId}/final?saved=${data.version}`);
    }).finally(() => setApplying(null));
  };

  async function changeWeights(next: V3Weights) {
    const previous = weights;
    setWeights(next);
    setSavingWeights(true);
    setError("");
    try {
      const res = await fetch(`${api}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights: next }),
      });
      const data = await readJson<{ weights: V3Weights }>(res);
      if (!res.ok) throw new Error(data.error ?? "중요도를 저장하지 못했습니다.");
      setWeights(data.weights);
      await Promise.all([loadChecks(), loadJobs()]);
    } catch (e) {
      setWeights(previous);
      setError(e instanceof Error ? e.message : "중요도를 저장하지 못했습니다.");
    } finally {
      setSavingWeights(false);
    }
  }

  const blocked = checks ? checks.quick.blocking || checks.quick.minUnplaced > 0 : true;
  const engineJobs = useMemo(() => jobs.filter((j) => j.kind !== "diagnose"), [jobs]);
  const diagnoseJobs = useMemo(() => jobs.filter((j) => j.kind === "diagnose"), [jobs]);
  const modalJob = engineJobs.find((j) => j.id === progressId) ?? null;

  function openJob(job: V3JobView) {
    setSelectedId(job.id);
    setProgressId(job.id);
  }

  function showResults(job: V3JobView) {
    setSelectedId(job.id);
    setProgressId(null);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        불러오는 중…
      </p>
    );
  }

  return (
    <div className="relative flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">시간표 생성 (v3)</h1>
        <p className="mt-2 text-sm text-zinc-600">
          모든 수업을 빠짐없이 배치한 시간표만 만듭니다. 점수는 피하고 싶은 일(점심 연강·3연강·같은 날 교과)이 생긴 건수에
          중요도를 곱해 더한 값이라 <b>낮을수록 좋습니다</b>.
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/v3/terms/${termId}/preferences`}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              이전
            </Link>
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => void startJob(engineKind)}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              시간표 생성
            </button>
            <button
              type="button"
              aria-label="생성 설정"
              title="생성 설정"
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg border border-zinc-300 bg-white p-2.5 text-zinc-700 transition hover:bg-zinc-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <Link
              href={`/v3/terms/${termId}/final`}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              다음
            </Link>
          </div>
          {blocked ? <p className="text-xs font-medium text-red-700">빠른 검사 오류를 먼저 고쳐야 생성할 수 있습니다.</p> : null}
        </div>
      </header>

      {modalJob ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="계산 진행"
          onClick={() => setProgressId(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setProgressId(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <JobDetail
              job={modalJob}
              busy={busy}
              onStop={() => void stopJob(modalJob)}
              onContinue={() => void continueJob(modalJob)}
              onToggleAuto={(v) => void toggleJobAuto(modalJob, v)}
              onDiagnose={(k) => void startDiagnosis(k)}
            />
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {DELETABLE.includes(modalJob.status) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deleteJob(modalJob)}
                  className="mr-auto rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  작업 삭제
                </button>
              ) : null}
              {ACTIVE.includes(modalJob.status) ? (
                <span className="mr-auto text-xs text-white">닫아도 계산은 계속됩니다. 작업 목록에서 다시 볼 수 있습니다.</span>
              ) : null}
              {modalJob.results.length ? (
                <button
                  type="button"
                  onClick={() => showResults(modalJob)}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  결과 보기
                </button>
              ) : null}
              <button
                type="button"
                autoFocus
                onClick={() => setProgressId(null)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {checks ? <V3QuickCheckBox quick={checks.quick} /> : null}

      {settingsOpen ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v3-settings-title"
        onClick={() => setSettingsOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setSettingsOpen(false);
        }}
      >
      <section
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="v3-settings-title" className="text-base font-semibold text-zinc-900">생성 설정</h2>
          <button
            type="button"
            autoFocus
            onClick={() => setSettingsOpen(false)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            닫기
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          여기서 고른 계산 방법과 조건별 가중치는 시간표 생성 버튼을 누를 때 적용됩니다. 생성은 5분씩 계산하며, 언제든 멈추면 그때까지 찾은 가장
          좋은 결과를 보여 줍니다. 결과는 서로 30칸 이상 다른 좋은 시간표 3개를 모읍니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ENGINES.map((engine) => {
            const time = checks?.estimate?.methods[engine.kind];
            const picked = engine.kind === engineKind;
            return (
            <button
              key={engine.kind}
              type="button"
              aria-pressed={picked}
              onClick={() => setEngineKind(engine.kind)}
              className={`flex flex-col items-start gap-1 rounded-xl border bg-white px-4 py-3 text-left text-zinc-900 transition hover:bg-zinc-50 ${
                picked ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-300"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">{engine.badge}</span>
                <span className="text-sm font-semibold">{engine.label}</span>
              </span>
              <span className="text-xs text-zinc-600">{engine.hint}</span>
              {time ? <span className="text-xs font-medium text-zinc-800">예상: {time}</span> : null}
            </button>
            );
          })}
        </div>
        {checks?.size && checks.estimate ? (
          <div className="mt-4 rounded-lg bg-zinc-200 px-3 py-2 text-xs text-zinc-700">
            <p>
              * 이 시간표에 대해서: <b>{TIER_LABEL[checks.estimate.tier]}</b> · {checks.size.classes}반 · 교사 {checks.size.teachers}명(1인 평균 {checks.size.avgLoad}시간) · 주당 수업{" "}
              {checks.size.lessons}칸 · 배정 불가 {checks.size.forbidden}칸 · 선 수업 {checks.size.pins}칸
            </p>
            <p className="mt-1 text-zinc-500">
              예상 시간은 목표(근접 기준)에 닿기까지의 대략적인 범위입니다 (여러 학교 조건을 측정한 값, 학교마다 차이가 큼).
              {checks.estimate.slower.length ? ` 더 걸릴 수 있는 조건: ${checks.estimate.slower.join(", ")}.` : ""}
            </p>
            {checks.estimate.tip ? <p className="mt-1 text-zinc-700">{checks.estimate.tip}</p> : null}
          </div>
        ) : null}
        {weights ? (
          <div className="mt-4 text-sm text-zinc-800">
            <p className="font-medium">
              조건별 가중치 설정
              <span className="ml-1.5 text-xs font-normal text-zinc-500">
                {savingWeights ? "저장 중…" : "한 건이 생길 때 더해지는 점수입니다. 시간표 생성 로직에 반영됩니다.(점수가 높을수록 불량한 시간표입니다.)"}
              </span>
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {WEIGHT_ROWS.map((row) => {
                const on = prefs[row.pref] ?? row.key !== "sameDay";
                return (
                  <label key={row.key} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-3">
                    <span className={on ? "" : "text-zinc-400"}>
                      {row.label}
                      {on ? "" : " (꺼짐)"}
                    </span>
                    <select
                      value={weights[row.key]}
                      disabled={!on || savingWeights || busy}
                      onChange={(e) => void changeWeights({ ...weights, [row.key]: Number(e.target.value) })}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {choices.map((c) => (
                        <option key={c} value={c}>
                          {c}점
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              조건을 켜고 끄는 것은{" "}
              <Link href={`/v3/terms/${termId}/preferences`} className="underline">
                추가 조건 설정
              </Link>
              에서 합니다. 교사 중복·배정 불가·선 수업·고정한 SET·같은 SET 하루 한 번은 중요도와 관계없이 반드시 지킵니다.
            </p>
          </div>
        ) : null}
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="mt-0.5" checked={autoContinue} onChange={(e) => setAutoContinue(e.target.checked)} />
          <span>
            미리 승인: 5분마다 묻지 않고 최대 30분까지 이어 계산합니다.
            <span className="block text-xs text-zinc-500">
              끄면 5분이 끝날 때마다 결과를 보여 주고 더 계산할지 묻습니다. 목표를 달성하면 어느 쪽이든 일찍 끝납니다.
            </span>
          </span>
        </label>
      </section>
      </div>
      ) : null}

      {engineJobs.length ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm min-[1440px]:absolute min-[1440px]:top-0 min-[1440px]:right-full min-[1440px]:mr-4 min-[1440px]:max-h-[calc(100vh-10rem)] min-[1440px]:w-60 min-[1440px]:overflow-y-auto min-[1440px]:p-4">
          <h2 className="text-base font-semibold text-zinc-900">작업 목록</h2>
          <ul className="mt-3 divide-y divide-zinc-100">
            {engineJobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => openJob(j)}
                  className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-sm transition ${
                    j.id === selectedId ? "bg-zinc-100" : "hover:bg-zinc-50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900">
                      #{j.number} {KIND_LABEL[j.kind]}
                    </span>
                    <StatusChip job={j} />
                  </span>
                  <span className="text-xs text-zinc-500">
                    {jobSummary(j)}
                    {j.inputChanged ? <span className="ml-1 whitespace-nowrap text-amber-700">· 입력이 바뀜</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected && results.length ? (
        <section ref={resultsRef} className="flex scroll-mt-44 flex-col gap-4">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900">결과 비교 (#{selected.number})</h2>
            <button
              type="button"
              onClick={() => openJob(selected)}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              작업 정보
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {results.map((r) => (
              <div
                key={r.rank}
                role="button"
                tabIndex={0}
                aria-pressed={r.rank === shownRank}
                onClick={() => setShownRank(r.rank)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                  e.preventDefault();
                  setShownRank(r.rank);
                }}
                className={`flex cursor-pointer flex-col gap-2 rounded-xl border bg-white p-4 text-sm shadow-sm transition ${
                  r.rank === shownRank ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-zinc-900">
                    {r.rank + 1}번 결과
                    {r.rank === shownRank ? <span className="text-xs font-medium text-zinc-500">보는 중</span> : null}
                  </span>
                  <span className="text-lg font-bold text-zinc-900">{r.metrics.score}점</span>
                </div>
                <JudgementLine judgement={r.judgement} />
                <ul className="text-xs text-zinc-600">
                  <li>점심 연강 {r.metrics.lunch}건 · 3연강 {r.metrics.triple}건 · 같은 날 교과 {r.metrics.sameDay}건</li>
                  <li>{r.rank === 0 ? "가장 좋은 결과" : `1번과 ${r.diffFromTop}칸 다름`} · {minutes(r.foundAtMs)}에 찾음</li>
                </ul>
                <div className="mt-auto flex gap-2">
                  <button
                    type="button"
                    disabled={busy || selected.inputChanged || ACTIVE.includes(selected.status)}
                    onClick={() => applyResult(selected, r.rank)}
                    className="flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applying === r.rank ? "저장 중…" : "최종 시간표로 저장"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {ACTIVE.includes(selected.status) ? (
            <p className="text-center text-xs text-zinc-500">계산 중에는 저장할 수 없습니다. 멈추거나 구간이 끝난 뒤 저장해 주세요.</p>
          ) : selected.inputChanged ? (
            <p className="text-center text-xs text-amber-700">작업 뒤에 입력이 바뀌어 저장할 수 없습니다. 새로 생성해 주세요.</p>
          ) : (
            <p className="text-center text-xs text-zinc-500">저장하면 현재 시간표가 되고 &ldquo;9. 최종 시간표&rdquo;에 쌓입니다. 메모는 자동으로 적힙니다.</p>
          )}
          {results[shownRank]?.details && weights ? (
            <ScoreDetailsBox rank={shownRank} metrics={results[shownRank].metrics} details={results[shownRank].details!} weights={weights} />
          ) : null}
          {results[shownRank] ? (
            <V3TimetableView
              cells={results[shownRank].cells}
              schedules={schedules}
              classCounts={classCounts}
              teachers={teachers}
              fixedSetKeys={fixedSetKeys}
            />
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">진단</h2>
        <p className="mt-1 text-sm text-zinc-600">필요할 때만 실행합니다. 결과는 입력이 바뀌기 전까지 다시 계산하지 않고 보여 줍니다.</p>
        <div className="mt-3 flex flex-col gap-3">
          {(["feasibility", "relax", "fixedLoss", "dataLimit", "bound"] as const).map((k) => {
            const running = diagnoseJobs.find((j) => j.diagnose === k && ACTIVE.includes(j.status) && !j.inputChanged);
            const doneJob = checks?.diagnoses[k];
            return (
              <div key={k} className="rounded-xl border border-zinc-200 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">{DIAGNOSE_LABEL[k]}</p>
                    <p className="text-xs text-zinc-500">{DIAGNOSE_HINT[k]}</p>
                  </div>
                  {running ? (
                    <div className="flex items-center gap-2">
                      <StatusChip job={running} />
                      <span className="text-xs text-zinc-500">{running.progress?.message ?? ""}</span>
                      <button
                        type="button"
                        disabled={busy || running.status === "stopping"}
                        onClick={() => void stopJob(running)}
                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                      >
                        멈추기
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startDiagnosis(k)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {doneJob ? "다시 실행" : "실행"}
                    </button>
                  )}
                </div>
                {doneJob?.diagnosis ? (
                  <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-zinc-800">
                    <V3DiagnosisReport kind={k} report={doneJob.diagnosis} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** 작업 목록 한 줄 요약 (계산 중이면 진행 상황) */
function jobSummary(j: V3JobView): string {
  const live = j.status === "running" || j.status === "stopping" ? j.progress : null;
  const score = live?.bestScore ?? j.results[0]?.metrics.score ?? null;
  const count = live ? live.results : j.results.length;
  const unplaced = live?.bestUnplaced ?? j.bestUnplaced;
  const head = score !== null ? `최고 ${score}점 · 결과 ${count}개` : unplaced ? `미배치 ${unplaced}시간` : "결과 없음";
  return `${head} · ${minutes(j.elapsedMs + (live?.segmentMs ?? 0))}`;
}

/** 점수 내역: 감점마다 어느 교사의 어느 수업 때문인지 */
function ScoreDetailsBox({ rank, metrics, details, weights }: { rank: number; metrics: V3Metrics; details: V3ScoreDetails; weights: V3Weights }) {
  const [open, setOpen] = useState(false);
  const rows: { key: string; title: string; weight: number; items: { key: string; text: string }[] }[] = [
    {
      key: "lunch",
      title: "점심시간 연강",
      weight: weights.lunch,
      items: details.lunch.map((d, i) => ({ key: `l${i}`, text: `${d.teacher} · ${dayLabel(d.day)}요일 — ${d.lessons.join(" / ")}` })),
    },
    {
      key: "triple",
      title: "3연강",
      weight: weights.triple,
      items: details.triple.map((d, i) => ({ key: `t${i}`, text: `${d.teacher} · ${dayLabel(d.day)}요일 ${d.startPeriod}~${d.startPeriod + 2}교시 — ${d.lessons.join(" / ")}` })),
    },
    {
      key: "sameDay",
      title: "같은 날 교과",
      weight: weights.sameDay,
      items: details.sameDay.map((d, i) => ({ key: `s${i}`, text: `${d.grade}학년 ${d.classNo}반 ${d.subject}(${d.teacher}) · ${dayLabel(d.day)}요일 ${d.periods.join("·")}교시` })),
    },
  ];
  return (
    <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="font-medium">
          {rank + 1}번 결과 점수 내역 · {metrics.score}점 = 점심 연강 {metrics.lunch}건 × {weights.lunch} + 3연강 {metrics.triple}건 × {weights.triple} + 같은 날 교과{" "}
          {metrics.sameDay}건 × {weights.sameDay}
        </span>
        <span className="shrink-0 text-xs text-zinc-500">{open ? "접기" : "어느 수업인지 보기"}</span>
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.key}>
              <p className="text-xs font-semibold text-zinc-700">
                {row.title} {row.items.length}건 × {row.weight}점 = {row.items.length * row.weight}점
              </p>
              {row.items.length ? (
                <ul className="mt-1 max-h-48 list-inside list-disc overflow-auto text-xs text-zinc-700">
                  {row.items.map((it) => (
                    <li key={it.key}>{it.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">없음</p>
              )}
            </div>
          ))}
          <p className="text-xs text-zinc-500">교사는 SET 담당(여러 교사가 함께 맡는 +α 과목 포함)까지 셉니다. 아래 &ldquo;교사별&rdquo; 보기로 그 교사의 하루를 확인할 수 있습니다.</p>
        </div>
      ) : null}
    </section>
  );
}

function StatusChip({ job }: { job: V3JobView }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_TONE[job.status] ?? STATUS_TONE.queued}`}>
      {STATUS_LABEL[job.status] ?? job.status}
      {job.status === "queued" && job.queuePosition ? ` (${job.queuePosition}번째)` : ""}
    </span>
  );
}

function JudgementLine({ judgement }: { judgement: V3Judgement }) {
  if (judgement.near === null) return <p className="text-xs text-zinc-500">목표 기준 계산 전</p>;
  if (judgement.optimal) return <p className="text-xs font-medium text-emerald-700">최선 (더 좋을 수 없음)</p>;
  if (judgement.strict) return <p className="text-xs font-medium text-emerald-700">목표 달성 (엄격 기준까지)</p>;
  if (judgement.near) return <p className="text-xs font-medium text-emerald-700">목표 달성</p>;
  return <p className="text-xs font-medium text-amber-700">목표까지 {judgement.gapToNear}점</p>;
}

function JobDetail({
  job,
  busy,
  onStop,
  onContinue,
  onToggleAuto,
  onDiagnose,
}: {
  job: V3JobView;
  busy: boolean;
  onStop: () => void;
  onContinue: () => void;
  onToggleAuto: (value: boolean) => void;
  onDiagnose: (kind: V3DiagnoseKind) => void;
}) {
  const active = ACTIVE.includes(job.status);
  const running = job.status === "running" || job.status === "stopping";
  const elapsed = job.elapsedMs + (running ? job.progress?.segmentMs ?? 0 : 0);
  const pct = Math.min(100, Math.round((elapsed / job.maxMs) * 100));
  const best = job.results[0]?.metrics ?? null;
  const liveScore = running ? job.progress?.bestScore ?? null : null;
  const liveUnplaced = running ? job.progress?.bestUnplaced ?? null : null;
  const failed = !active && job.results.length === 0;
  // 완성본이 하나도 없으면(미배치만 남음) 점수 목표는 뜻이 없으므로 미배치를 앞세운다
  const unplacedOnly = job.results.length === 0 && ((running ? liveUnplaced : job.bestUnplaced) ?? 0) > 0;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
          #{job.number} {KIND_LABEL[job.kind]} <StatusChip job={job} />
        </h2>
        <div className="flex items-center gap-2">
          {active ? (
            <button
              type="button"
              disabled={busy || job.status === "stopping"}
              onClick={onStop}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {job.status === "stopping" ? "멈추는 중…" : "멈추기"}
            </button>
          ) : null}
          {job.canContinue ? (
            <button
              type="button"
              disabled={busy}
              onClick={onContinue}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {job.status === "done" && job.nextGoal === "optimal" && job.goal !== "optimal" ? "추가 탐색 (최적해 3개)" : "5분 더 계산"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full ${running ? "bg-sky-500" : "bg-zinc-400"} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          누적 {minutes(elapsed)} / 최대 {minutes(job.maxMs)} · 구간 {job.segments}회 (한 구간 {minutes(job.segmentMs)})
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">지금까지 최고</dt>
          <dd className="font-semibold text-zinc-900">
            {liveScore !== null
              ? `${liveScore}점`
              : best
                ? `${best.score}점`
                : liveUnplaced
                  ? `미배치 ${liveUnplaced}시간`
                  : job.bestUnplaced
                    ? `미배치 ${job.bestUnplaced}시간`
                    : "-"}
          </dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">이론상 최선</dt>
          <dd className="font-semibold text-zinc-900">
            {unplacedOnly
              ? "-"
              : job.lowerBound !== null
                ? `${job.lowerBound}점`
                : (liveScore ?? best?.score) === 0
                  ? "0점 (0점이 곧 최선)"
                  : "계산 중 · 0점 이상"}
          </dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">목표 (근접 기준)</dt>
          <dd className="font-semibold text-zinc-900">
            {unplacedOnly ? "미배치 0" : job.nearThreshold === null ? "6점 이하면 달성 (최선 계산 전)" : `${job.nearThreshold}점 이하`}
          </dd>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <dt className="text-xs text-zinc-500">모은 결과</dt>
          <dd className="font-semibold text-zinc-900">{running ? job.progress?.results ?? 0 : job.results.length} / 3</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-zinc-700">
        {job.status === "queued"
          ? `대기열 ${job.queuePosition ?? ""}번째입니다. 앞 작업의 구간이 끝나면 시작합니다.`
          : running
            ? `${PHASE_LABEL[job.progress?.phase ?? "start"] ?? "계산 중"}${job.progress?.message ? ` — ${job.progress.message}` : ""}`
            : job.status === "awaiting"
              ? job.results.length
                ? "5분 계산이 끝났습니다. 결과를 보고, 더 계산하려면 “5분 더 계산”을 눌러 주세요. (중단점은 30일 동안 보관합니다)"
                : "5분 계산이 끝났지만 아직 모든 수업을 놓은 시간표가 없습니다. 더 계산하려면 “5분 더 계산”을 눌러 주세요. (중단점은 30일 동안 보관합니다)"
              : job.status === "error"
                ? `오류로 멈췄습니다: ${job.error ?? ""}`
                : job.stopReason === "early"
                  ? job.goal === "optimal"
                    ? "이론상 최선과 같은 점수의 서로 다른 시간표 3개를 찾아 끝냈습니다."
                    : `엄격 기준(${job.strictThreshold ?? 3}점 이하)에 드는 서로 다른 시간표 3개를 찾아 멈췄습니다. 최선(이론상 최선 ${job.lowerBound ?? 0}점)과 같은 시간표 3개를 찾으려면 “추가 탐색 (최적해 3개)”을 눌러 주세요. 찾을 때까지 5분씩 계산합니다.`
                  : job.stopReason
                    ? STOP_REASON[job.stopReason] ?? ""
                    : job.error ?? ""}
      </p>
      {job.goal === "optimal" && job.status !== "done" ? (
        <p className="mt-1 text-xs font-medium text-sky-800">
          지금 목표: 이론상 최선({job.lowerBound ?? 0}점)과 같은 점수의 시간표 3개. 이론상 최선이 아직 덜 계산된 값이면 끝까지 못 찾을 수 있습니다.
        </p>
      ) : null}
      {!unplacedOnly && job.lowerBound !== null && job.strictThreshold !== null ? (
        <p className="mt-1 text-xs text-zinc-500">
          목표: 이론상 최선 {job.lowerBound}점의 1.1배 또는 +6점 중 넉넉한 쪽({job.nearThreshold}점)까지는 달성으로 봅니다. 엄격 기준은{" "}
          {job.strictThreshold}점입니다.
        </p>
      ) : null}

      {!job.inputChanged && (active || job.status === "awaiting") ? (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={job.autoContinue} disabled={busy} onChange={(e) => onToggleAuto(e.target.checked)} />
          미리 승인 (최대 {minutes(job.maxMs)}까지 묻지 않고 이어 계산)
        </label>
      ) : null}
      {job.inputChanged ? (
        <p className="mt-2 text-xs text-amber-700">이 작업을 만든 뒤 입력이 바뀌었습니다. 이어 돌리거나 최종 시간표로 저장할 수 없으니 새로 생성해 주세요.</p>
      ) : null}

      {failed && (job.status === "infeasible" || (job.bestUnplaced ?? 0) > 0) ? (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">
            {job.status === "infeasible"
              ? "모든 수업을 배치할 수 없는 조건으로 확인되었습니다."
              : `모든 수업을 배치한 시간표를 찾지 못했습니다 (가장 좋은 배치에서 ${job.bestUnplaced}시간이 남음).`}
          </p>
          <p className="mt-1 text-xs">
            미배치가 있는 시간표는 만들지 않습니다. 원인을 찾아 입력을 고친 뒤 다시 생성해 주세요.
            {job.status !== "infeasible" ? " 계산 시간이 짧아서일 수도 있으니 더 계산해 볼 수도 있습니다." : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onDiagnose("feasibility")}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {DIAGNOSE_LABEL.feasibility}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDiagnose("relax")}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {DIAGNOSE_LABEL.relax}
            </button>
          </div>
          <p className="mt-2 text-xs">진단 결과는 아래 &ldquo;진단&rdquo;에 표시됩니다.</p>
        </div>
      ) : null}
    </section>
  );
}
