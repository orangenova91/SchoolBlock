"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTermHref } from "@/lib/use-term-href";
import { useRouter } from "next/navigation";
import {
  createDefaultGenerationPreferences,
  DEFAULT_LUNCH_AFTER_PERIOD,
  sameDaySubjectBanKey,
} from "@/lib/generation-preferences";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { isSetSubject } from "@/lib/teachers";
import {
  GRADES,
  MAX_PERIODS,
  WEEKDAYS,
  createDefaultGradeSubjects,
  type Grade,
  type GenerationPreferences,
  type GradeSubjects,
  type Semester,
} from "@/lib/types";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type GenerationPreferencesFormProps = {
  termId: string;
};

export function GenerationPreferencesForm({
  termId,
}: GenerationPreferencesFormProps) {
  const router = useRouter();
  const termHref = useTermHref();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [preferences, setPreferences] = useState<GenerationPreferences>(
    createDefaultGenerationPreferences(),
  );
  const [subjects, setSubjects] = useState<GradeSubjects>(
    createDefaultGradeSubjects(),
  );
  const [sameDayGradeTab, setSameDayGradeTab] = useState<Grade>(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const [response, subjectsRes] = await Promise.all([
          fetch(`/api/terms/${termId}/preferences`),
          fetch(`/api/terms/${termId}/subjects`),
        ]);
        const data = (await response.json()) as {
          term?: TermSummary;
          preferences?: GenerationPreferences;
          error?: string;
        };
        const subjectsData = (await subjectsRes.json()) as {
          subjects?: GradeSubjects;
          error?: string;
        };
        if (!response.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(data.error ?? "추가 조건을 불러오지 못했습니다.");
          }
          return;
        }
        if (!cancelled) {
          setTerm(data.term ?? null);
          setPreferences(
            data.preferences ?? createDefaultGenerationPreferences(),
          );
          if (subjectsRes.ok) {
            setSubjects(
              sanitizeGradeSubjects(
                ensureGradeSubjects(
                  subjectsData.subjects ?? createDefaultGradeSubjects(),
                ),
              ),
            );
          }
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

  async function savePreferences(
    successMessage: string,
  ): Promise<boolean> {
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/terms/${termId}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      const data = (await response.json()) as {
        preferences?: GenerationPreferences;
        error?: string;
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }
      if (data.preferences) setPreferences(data.preferences);
      setStatus("success");
      setMessage(successMessage);
      return true;
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다.");
      return false;
    }
  }

  async function handleSave() {
    await savePreferences("추가 조건이 저장되었습니다.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await savePreferences("추가 조건이 저장되었습니다.");
    if (ok) router.push(termHref(termId, `timetable`));
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

  const lunchAfter = preferences.lunchAfterPeriod;
  const lunchNext = lunchAfter + 1;

  const commonSubjectsByGrade = new Map<string, number>();
  for (const subject of subjects[sameDayGradeTab] ?? []) {
    if (isSetSubject(subject) || !subject.name.trim()) continue;
    if (!commonSubjectsByGrade.has(subject.name)) {
      commonSubjectsByGrade.set(subject.name, subject.units);
    }
  }
  const sameDayGradeSubjects = [...commonSubjectsByGrade.entries()].sort(
    (a, b) => a[0].localeCompare(b[0], "ko"),
  );
  const sameDayBanSet = new Set(
    preferences.sameDaySubjectBans.map((b) =>
      sameDaySubjectBanKey(b.grade, b.subjectName),
    ),
  );

  function toggleSameDaySubject(grade: Grade, subjectName: string) {
    const key = sameDaySubjectBanKey(grade, subjectName);
    setPreferences((prev) => {
      const has = prev.sameDaySubjectBans.some(
        (b) => sameDaySubjectBanKey(b.grade, b.subjectName) === key,
      );
      return {
        ...prev,
        sameDaySubjectBans: has
          ? prev.sameDaySubjectBans.filter(
              (b) => sameDaySubjectBanKey(b.grade, b.subjectName) !== key,
            )
          : [...prev.sameDaySubjectBans, { grade, subjectName }],
      };
    });
    setStatus("idle");
    setMessage("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          추가 조건 설정
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          필수 금지가 아니라, 시간표 생성 시 가능하면 지키는 선호 조건입니다.
          이후 3연강 배제 등도 이 단계에서 추가할 수 있습니다.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-zinc-900">
              동일 교과 같은 날 배치 금지
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              학년별로 선택한 교과는 같은 학반에서 같은 날 두 번 이상
              배치되지 않도록 우선합니다. 주당 시수가 요일 수({WEEKDAYS.length}
              일)보다 많은 교과는 완전히 피할 수 없어 부득이하게 겹칠 수
              있습니다. SET 교과는 대상이 아닙니다.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2">
            <span className="text-sm text-zinc-700">
              {preferences.avoidSameDaySubject ? "켜짐" : "꺼짐"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={preferences.avoidSameDaySubject}
              onClick={() => {
                setPreferences((prev) => ({
                  ...prev,
                  avoidSameDaySubject: !prev.avoidSameDaySubject,
                }));
                setStatus("idle");
                setMessage("");
              }}
              className={`relative h-7 w-12 rounded-full transition ${
                preferences.avoidSameDaySubject ? "bg-zinc-900" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition ${
                  preferences.avoidSameDaySubject ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        </div>

        <div
          className={`mt-5 border-t border-zinc-100 pt-4 ${
            preferences.avoidSameDaySubject ? "" : "opacity-50"
          }`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {GRADES.map((grade) => (
              <button
                key={grade}
                type="button"
                disabled={!preferences.avoidSameDaySubject}
                onClick={() => setSameDayGradeTab(grade)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${
                  sameDayGradeTab === grade
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
                }`}
              >
                {grade}학년
              </button>
            ))}
          </div>

          {sameDayGradeSubjects.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              {sameDayGradeTab}학년에 등록된 공통 교과가 없습니다.
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {sameDayGradeSubjects.map(([name, units]) => {
                const checked = sameDayBanSet.has(
                  sameDaySubjectBanKey(sameDayGradeTab, name),
                );
                const overflow = units > WEEKDAYS.length;
                return (
                  <li key={name}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                        checked
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!preferences.avoidSameDaySubject}
                        onChange={() =>
                          toggleSameDaySubject(sameDayGradeTab, name)
                        }
                        className="h-4 w-4 shrink-0 rounded border-zinc-300 disabled:cursor-not-allowed"
                      />
                      <span className="min-w-0 flex-1 truncate text-zinc-800">
                        {name}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        주 {units}시간
                      </span>
                      {overflow ? (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          요일 초과
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-zinc-900">
              점심시간 연강 배제
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              같은 교사가 점심 직전·직후 교시에 모두 수업하지 않도록 우선합니다.
              학반·교과가 달라도 해당합니다. 배치 시 연강이 없는 교시를 우선
              시도하고, 완성된 시간표에서 공통 수업을 옮겨 연강을 한 번 더
              줄입니다. SET·블록으로 고정된 연강은 남을 수 있습니다.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2">
            <span className="text-sm text-zinc-700">
              {preferences.avoidLunchDouble ? "켜짐" : "꺼짐"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={preferences.avoidLunchDouble}
              onClick={() => {
                setPreferences((prev) => ({
                  ...prev,
                  avoidLunchDouble: !prev.avoidLunchDouble,
                }));
                setStatus("idle");
                setMessage("");
              }}
              className={`relative h-7 w-12 rounded-full transition ${
                preferences.avoidLunchDouble ? "bg-zinc-900" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition ${
                  preferences.avoidLunchDouble ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        </div>

        <div
          className={`mt-5 border-t border-zinc-100 pt-4 ${
            preferences.avoidLunchDouble ? "" : "opacity-50"
          }`}
        >
          <label className="block text-sm font-medium text-zinc-800">
            점심 직전 교시
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            기본 {DEFAULT_LUNCH_AFTER_PERIOD}교시 → {DEFAULT_LUNCH_AFTER_PERIOD}
            ·{DEFAULT_LUNCH_AFTER_PERIOD + 1}교시 같은 교사 연강을 완화합니다.
            현재 설정: {lunchAfter}교시 다음이 점심 ({lunchAfter}·{lunchNext}
            교시).
          </p>
          <select
            value={preferences.lunchAfterPeriod}
            disabled={!preferences.avoidLunchDouble}
            onChange={(event) => {
              setPreferences((prev) => ({
                ...prev,
                lunchAfterPeriod: Number(event.target.value),
              }));
              setStatus("idle");
              setMessage("");
            }}
            className="mt-3 w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed"
          >
            {Array.from({ length: MAX_PERIODS - 1 }, (_, i) => i + 1).map(
              (period) => (
                <option key={period} value={period}>
                  {period}교시 다음이 점심 ({period}·{period + 1}교시 연강 완화)
                </option>
              ),
            )}
          </select>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-zinc-900">
              3연강 완화
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              같은 교사가 3교시 연속으로 수업하지 않도록 우선합니다(학반·교과는
              달라도 해당). 점심 전후 교시 사이는 연속으로 보지 않습니다. 해가
              없으면 3연강이 남을 수 있습니다.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2">
            <span className="text-sm text-zinc-700">
              {preferences.avoidTriplePeriod ? "켜짐" : "꺼짐"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={preferences.avoidTriplePeriod}
              onClick={() => {
                setPreferences((prev) => ({
                  ...prev,
                  avoidTriplePeriod: !prev.avoidTriplePeriod,
                }));
                setStatus("idle");
                setMessage("");
              }}
              className={`relative h-7 w-12 rounded-full transition ${
                preferences.avoidTriplePeriod ? "bg-zinc-900" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white transition ${
                  preferences.avoidTriplePeriod ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        </div>
      </section>

      <p className="text-center text-xs text-zinc-500">
        SET·교과 블록으로 이미 고정된 연강은 이 조건으로 바꿀 수 없습니다.
      </p>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(termHref(termId, `constraints`))}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={status === "saving"}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "저장 중…" : "저장"}
        </button>
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "저장 중…" : "다음"}
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
