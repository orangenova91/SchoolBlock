"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { subjectSetBadgeClass } from "@/lib/subjects";
import { cellsForClass, maxPeriods } from "@/lib/timetable";
import {
  GRADES,
  WEEKDAYS,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Semester,
  type TimetableCell,
  type TimetableUnplaced,
  type Weekday,
} from "@/lib/types";

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
  const [status, setStatus] = useState<"idle" | "ready" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateText, setEstimateText] = useState("");
  const [viewGrade, setViewGrade] = useState<Grade>(1);
  const [viewClass, setViewClass] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [ttRes, scheduleRes] = await Promise.all([
          fetch(`/api/terms/${termId}/timetable`),
          fetch(`/api/terms/${termId}/day-schedule`),
        ]);
        const tt = (await ttRes.json()) as {
          term?: TermSummary;
          status?: "idle" | "ready" | "failed";
          cells?: TimetableCell[];
          unplaced?: TimetableUnplaced[];
          message?: string | null;
          error?: string;
        };
        const schedule = (await scheduleRes.json()) as {
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
        };

        if (!ttRes.ok) {
          if (!cancelled) {
            setError(tt.error ?? "시간표를 불러오지 못했습니다.");
          }
          return;
        }

        if (!cancelled) {
          setTerm(tt.term ?? null);
          setStatus(tt.status ?? "idle");
          setCells(Array.isArray(tt.cells) ? tt.cells : []);
          setUnplaced(Array.isArray(tt.unplaced) ? tt.unplaced : []);
          setMessage(tt.message ?? "");
          if (scheduleRes.ok) {
            setSchedules(schedule.grades ?? createDefaultGradeDaySchedules());
            setClassCounts(
              schedule.classCounts ?? createDefaultClassCounts(),
            );
          }
        }
      } catch {
        if (!cancelled) setError("서버에 연결할 수 없습니다.");
      } finally {
        if (!cancelled) setLoading(false);
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

  const classCells = useMemo(
    () => cellsForClass(cells, viewGrade, viewClass),
    [cells, viewGrade, viewClass],
  );

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setMessage("");
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
      };
      if (!response.ok) {
        setError(data.error ?? "시간표 생성에 실패했습니다.");
        return;
      }
      setStatus(data.status ?? "failed");
      setCells(Array.isArray(data.cells) ? data.cells : []);
      setUnplaced(Array.isArray(data.unplaced) ? data.unplaced : []);
      setMessage(data.message ?? "");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleEstimate() {
    setEstimating(true);
    setError("");
    setEstimateText("");
    try {
      const response = await fetch(
        `/api/terms/${termId}/timetable/estimate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples: 5 }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        summary?: string;
        upperBound?: {
          lessonCount?: number;
          upperBoundLabel?: string;
          note?: string;
          log10UpperBound?: number | null;
        };
        completeCount?: number;
        distinctComplete?: number;
        failedCount?: number;
        elapsedMs?: number;
        distinctHashes?: string[];
      };
      if (!response.ok) {
        setError(data.error ?? "해공간 추정에 실패했습니다.");
        return;
      }
      const hashes = (data.distinctHashes ?? []).join(", ") || "(없음)";
      setEstimateText(
        [
          data.summary ?? "",
          `공통 수업 ${data.upperBound?.lessonCount ?? "?"}교시`,
          data.upperBound?.note ?? "",
          `소요 ${(data.elapsedMs ?? 0) / 1000}초 · 실패 ${data.failedCount ?? 0}회`,
          `해시: ${hashes}`,
          "※ 저장된 시간표는 변경하지 않습니다.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setEstimating(false);
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
    <div className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          시간표
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          SET 블록을 고정하고 교사 배정 불가 교시를 반영한 뒤 공통 수업을
          자동 배치합니다. 나중에 교과 블록 조건을 추가할 수 있습니다.
        </p>
      </header>

      {term ? (
        <p className="text-center text-sm text-zinc-600">
          {term.timetableName ? `${term.timetableName} · ` : null}
          {term.school} · {term.academicYear}학년도 · {term.semester}학기
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/constraints`)}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={() => {
            void handleGenerate();
          }}
          disabled={generating || estimating}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating
            ? "생성 중… (최대 약 15초)"
            : status === "idle"
              ? "시간표 생성"
              : "다시 생성"}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleEstimate();
          }}
          disabled={generating || estimating}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {estimating
            ? "해공간 추정 중… (최대 약 1분)"
            : "해공간 추정"}
        </button>
      </div>

      {message ? (
        <p
          role="status"
          className={`text-center text-sm ${
            status === "failed" ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {message}
        </p>
      ) : null}

      {estimateText ? (
        <pre
          role="status"
          className="whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-xs leading-relaxed text-zinc-700"
        >
          {estimateText}
        </pre>
      ) : null}

      {error ? (
        <p className="text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {unplaced.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">미배치 공통 수업</p>
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs">
            {unplaced.map((u) => (
              <li
                key={`${u.teacherName}-${u.grade}-${u.classNo}-${u.subjectName}`}
              >
                {u.grade}학년 {u.classNo}반 {u.subjectName} · {u.teacherName}{" "}
                ({u.remaining}교시)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

        {cells.length === 0 && status === "idle" ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            시간표 생성을 누르면 결과가 표시됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[28rem] gap-1"
              style={{
                gridTemplateColumns: `2rem repeat(${WEEKDAYS.length}, minmax(0, 1fr))`,
              }}
            >
              <div />
              {WEEKDAYS.map(({ key, label }) => (
                <div
                  key={key}
                  className="pb-1 text-center text-xs font-medium text-zinc-600"
                >
                  {label}
                </div>
              ))}
              {Array.from({ length: periodRows }, (_, i) => i + 1).map(
                (period) => (
                  <div key={period} className="contents">
                    <div className="flex items-center justify-end pr-1 text-[11px] text-zinc-500">
                      {period}
                    </div>
                    {WEEKDAYS.map(({ key }) => {
                      const active = (schedules[viewGrade][key] ?? 0) >= period;
                      const cell = active
                        ? cellAt(classCells, viewGrade, viewClass, key, period)
                        : undefined;
                      return (
                        <div
                          key={`${key}-${period}`}
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
                    })}
                  </div>
                ),
              )}
            </div>
            <p className="mt-3 text-center text-xs text-zinc-500">
              {viewGrade}학년 {viewClass}반 · 수업 {classCells.length}칸
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
