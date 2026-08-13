"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PeriodPaintGrid } from "@/components/period-paint-grid";
import { setPeriod } from "@/lib/day-schedule";
import {
  GRADES,
  MAX_CLASS_COUNT,
  MIN_CLASS_COUNT,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Semester,
  type Weekday,
} from "@/lib/types";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type DayScheduleFormProps = {
  termId: string;
};

export function DayScheduleForm({ termId }: DayScheduleFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [grades, setGrades] = useState<GradeDaySchedules>(
    createDefaultGradeDaySchedules(),
  );
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(
    createDefaultClassCounts(),
  );
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMessage("");

      try {
        const response = await fetch(`/api/terms/${termId}/day-schedule`);
        const data = (await response.json()) as {
          term?: TermSummary;
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
          error?: string;
        };

        if (!response.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(data.error ?? "설정을 불러오지 못했습니다.");
          }
          return;
        }

        if (!cancelled) {
          setTerm(data.term ?? null);
          setGrades(data.grades ?? createDefaultGradeDaySchedules());
          setClassCounts(data.classCounts ?? createDefaultClassCounts());
          setStatus("idle");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("서버에 연결할 수 없습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [termId]);

  function updateDayPeriods(grade: Grade, day: Weekday, count: number) {
    setGrades((prev) => setPeriod(prev, grade, day, count));
    setStatus("idle");
    setMessage("");
  }

  function updateClassCount(grade: Grade, value: string) {
    const n = Number(value);
    if (!Number.isInteger(n)) return;
    if (n < MIN_CLASS_COUNT || n > MAX_CLASS_COUNT) return;
    setClassCounts((prev) => ({ ...prev, [grade]: n }));
    setStatus("idle");
    setMessage("");
  }

  function copyFromGrade1() {
    setGrades((prev) => ({
      1: { ...prev[1] },
      2: { ...prev[1] },
      3: { ...prev[1] },
    }));
    setClassCounts((prev) => ({
      1: prev[1],
      2: prev[1],
      3: prev[1],
    }));
    setStatus("idle");
    setMessage("1학년 기준으로 2·3학년에 복사했습니다. 저장을 눌러 주세요.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch(`/api/terms/${termId}/day-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grades, classCounts }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return;
      }

      router.push(`/terms/${termId}/subjects`);
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        불러오는 중…
      </p>
    );
  }

  if (!term && status === "error") {
    return (
      <p className="text-sm text-red-600" role="alert">
        {message || "학기 정보를 찾을 수 없습니다."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-10">
      {term ? (
        <p className="text-center text-sm text-zinc-600">
          {term.timetableName ? `${term.timetableName} · ` : null}
          {term.school} · {term.academicYear}학년도 · {term.semester}학기
        </p>
      ) : null}

      <div className="flex w-full flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            학반 설정
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            학년별 학반 수를 입력해 주세요. (1~20)
          </p>
        </header>

        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
          {GRADES.map((grade) => (
            <section
              key={`class-count-${grade}`}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
                {grade}학년
              </h2>
              <label className="flex items-center justify-center gap-2 text-sm text-zinc-700">
                <span className="font-medium">학반 수</span>
                <input
                  type="number"
                  min={MIN_CLASS_COUNT}
                  max={MAX_CLASS_COUNT}
                  value={classCounts[grade]}
                  onChange={(e) => updateClassCount(grade, e.target.value)}
                  aria-label={`${grade}학년 학반 수`}
                  className="w-16 rounded-lg border border-zinc-300 px-2 py-1.5 text-center text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                />
              </label>
            </section>
          ))}
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            수업 요일 설정
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            칸을 드래그해 월~금 수업 차시를 설정하세요. (위에서부터 연속, 최대
            10교시)
          </p>
        </header>

        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
          {GRADES.map((grade) => (
            <section
              key={grade}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
                {grade}학년
              </h2>
              <PeriodPaintGrid
                grade={grade}
                periods={grades[grade]}
                onChange={(day, count) => updateDayPeriods(grade, day, count)}
              />
            </section>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={copyFromGrade1}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          1학년 기준으로 전체 복사
        </button>
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "저장 중…" : "저장"}
        </button>
      </div>

      {message ? (
        <p
          role="status"
          className={`text-center text-sm ${
            status === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
