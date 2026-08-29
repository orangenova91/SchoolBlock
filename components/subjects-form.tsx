"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { SubjectGradeTable } from "@/components/subject-grade-table";
import { sumWeekdayPeriods } from "@/lib/day-schedule";
import {
  alignSetClassNos,
  applyClassCountsFromClipboard,
  classNoLabel,
  ensureGradeSubjects,
  isAlphaClassNo,
  isElectiveSubjectSet,
  partialClassNoOptions,
  sanitizeGradeSubjects,
  setClassKind,
  subjectSetBadgeClass,
  usedClassNosInSet,
  validateSetClassAssignments,
  wholeClassNoOptions,
} from "@/lib/subjects";
import {
  DEFAULT_SUBJECT_CLASS_COUNT,
  DEFAULT_SUBJECT_SET,
  GRADES,
  MAX_SUBJECT_CLASS_COUNT,
  MIN_SUBJECT_CLASS_COUNT,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createEmptySubject,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type Semester,
  type Subject,
} from "@/lib/types";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type FormMode = "edit" | "classCount";

type SubjectsFormProps = {
  termId: string;
  initialStep?: FormMode;
};

type GradeScheduleTotal = {
  classCount: number;
  weekdaySum: number;
  total: number;
};

function hasAnySubjects(subjects: GradeSubjects): boolean {
  return GRADES.some((grade) =>
    subjects[grade].some((s) => s.name.trim().length > 0),
  );
}

function withEditRows(subjects: GradeSubjects): GradeSubjects {
  const ensured = ensureGradeSubjects(subjects);
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    next[grade] =
      ensured[grade].length > 0
        ? ensured[grade].map((row) => ({ ...row }))
        : [createEmptySubject()];
  }
  return next;
}

/** Home-room curriculum hours; excludes partial-SET +α (이동 분반). */
function gradeTotalHours(
  subjects: Subject[],
  gradeClassCount: number,
): number {
  return subjects.reduce((sum, row) => {
    if (
      isElectiveSubjectSet(row.set) &&
      typeof row.classNo === "number" &&
      isAlphaClassNo(row.classNo, gradeClassCount)
    ) {
      return sum;
    }
    return sum + row.units * row.classCount;
  }, 0);
}

function buildScheduleTotals(
  grades: GradeDaySchedules,
  classCounts: GradeClassCounts,
): Record<Grade, GradeScheduleTotal> {
  const next = {} as Record<Grade, GradeScheduleTotal>;
  for (const grade of GRADES) {
    const weekdaySum = sumWeekdayPeriods(grades[grade]);
    const classCount = classCounts[grade];
    next[grade] = {
      classCount,
      weekdaySum,
      total: classCount * weekdaySum,
    };
  }
  return next;
}

function SubjectClassCountEditor({
  subjects,
  scheduleTotals,
  savingGrade,
  onChange,
  onSaveGrade,
}: {
  subjects: GradeSubjects;
  scheduleTotals: Record<Grade, GradeScheduleTotal> | null;
  savingGrade: Grade | null;
  onChange: (grade: Grade, rows: Subject[]) => void;
  onSaveGrade: (grade: Grade) => void;
}) {
  function handlePaste(
    grade: Grade,
    event: React.ClipboardEvent<HTMLElement>,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    if (!text.includes("\n") && !text.includes("\r")) return;

    const applied = applyClassCountsFromClipboard(subjects[grade], text);
    if (!applied) return;

    event.preventDefault();
    onChange(grade, applied);
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
        {GRADES.map((grade) => {
          const rows = subjects[grade];
          const gradeClassCount = scheduleTotals?.[grade]?.classCount ?? 0;
          const totalHours = gradeTotalHours(rows, gradeClassCount);
          const isSaving = savingGrade === grade;

          return (
            <section
              key={grade}
              className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
                {grade}학년
              </h2>
              {rows.length === 0 ? (
                <p className="text-center text-sm text-zinc-500">
                  저장된 교과 없음
                </p>
              ) : (
                <>
                  <div
                    className="overflow-x-auto"
                    onPaste={(e) => handlePaste(grade, e)}
                  >
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left text-zinc-600">
                          <th className="w-14 px-1 py-2 text-center font-medium">
                            set
                          </th>
                          <th className="px-2 py-2 font-medium">교과명</th>
                          <th className="w-12 px-1 py-2 text-center font-medium">
                            단위수
                          </th>
                          <th className=" min-w-[3rem] px-1 py-2 text-center font-medium">
                            학반수
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => {
                          const elective = isElectiveSubjectSet(row.set);
                          const kind =
                            elective && gradeClassCount
                              ? setClassKind(
                                  rows,
                                  row.set as ElectiveSet,
                                  gradeClassCount,
                                )
                              : null;
                          const showClassDropdown =
                            kind === "partial" || kind === "whole";
                          const classNoOptions =
                            kind === "whole"
                              ? wholeClassNoOptions(gradeClassCount)
                              : partialClassNoOptions(gradeClassCount);
                          const used =
                            showClassDropdown && elective
                              ? usedClassNosInSet(
                                  rows,
                                  row.set as ElectiveSet,
                                  index,
                                )
                              : new Set<number>();

                          return (
                            <tr
                              key={`${grade}-${index}-${row.name}`}
                              className="border-b border-zinc-100"
                            >
                              <td className="px-1 py-1.5 text-center">
                                <span
                                  className={`inline-block min-w-[2.5rem] rounded-md border px-1.5 py-0.5 text-xs font-medium ${subjectSetBadgeClass(row.set)}`}
                                >
                                  {row.set ?? DEFAULT_SUBJECT_SET}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">
                                    {row.name}
                                  </span>
                                  {kind === "whole" ? (
                                    <span className="shrink-0 text-[10px] text-zinc-400">
                                      전학년
                                    </span>
                                  ) : null}
                                  {kind === "overflow" ? (
                                    <span className="shrink-0 text-[10px] font-medium text-red-600">
                                      과다
                                    </span>
                                  ) : null}
                                  {showClassDropdown && gradeClassCount ? (
                                    <select
                                      value={row.classNo ?? ""}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const classNo =
                                          raw === ""
                                            ? undefined
                                            : Number(raw);
                                        onChange(
                                          grade,
                                          rows.map((item, i) =>
                                            i === index
                                              ? {
                                                  ...item,
                                                  classCount:
                                                    DEFAULT_SUBJECT_CLASS_COUNT,
                                                  classNo,
                                                }
                                              : item,
                                          ),
                                        );
                                      }}
                                      aria-label={`${grade}학년 ${row.name} 학반`}
                                      className="w-[3rem] shrink-0 rounded-md border border-zinc-300 bg-white px-0.5 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                                    >
                                      <option value="">학반</option>
                                      {classNoOptions.map((n) => (
                                        <option
                                          key={n}
                                          value={n}
                                          disabled={
                                            used.has(n) && row.classNo !== n
                                          }
                                        >
                                          {classNoLabel(n, gradeClassCount)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-1 py-1.5 text-center tabular-nums text-zinc-600">
                                {row.units}
                              </td>
                              <td className="px-1 py-1.5">
                                {elective ? (
                                  <span
                                    className="block w-full rounded-md border border-zinc-200 bg-zinc-50 px-1 py-1.5 text-center tabular-nums text-zinc-500"
                                    title="SET 과목은 분반마다 한 줄이며 학반 수는 1로 고정됩니다."
                                  >
                                    1
                                  </span>
                                ) : (
                                  <input
                                    type="number"
                                    min={MIN_SUBJECT_CLASS_COUNT}
                                    max={MAX_SUBJECT_CLASS_COUNT}
                                    value={row.classCount}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (!Number.isInteger(n)) return;
                                      if (
                                        n < MIN_SUBJECT_CLASS_COUNT ||
                                        n > MAX_SUBJECT_CLASS_COUNT
                                      ) {
                                        return;
                                      }
                                      onChange(
                                        grade,
                                        rows.map((item, i) =>
                                          i === index
                                            ? { ...item, classCount: n }
                                            : item,
                                        ),
                                      );
                                    }}
                                    onPaste={(e) => handlePaste(grade, e)}
                                    aria-label={`${grade}학년 ${row.name} 수업 학반 수`}
                                    className="w-full rounded-md border border-zinc-300 px-1 py-1.5 text-center text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-auto border-t border-zinc-100 pt-3 text-center">
                    <p className="text-sm font-medium text-zinc-900">
                      수업 총 시수{" "}
                      <span className="tabular-nums">{totalHours}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Σ(단위수 × 수업 학반 수) · 부분 SET +α 제외
                    </p>
                    <button
                      type="button"
                      onClick={() => onSaveGrade(grade)}
                      disabled={savingGrade !== null}
                      className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSaving ? "저장 중…" : "수업 학반 수 저장"}
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
        {GRADES.map((grade) => {
          const schedule = scheduleTotals?.[grade];
          const subjectTotal = gradeTotalHours(
            subjects[grade],
            schedule?.classCount ?? 0,
          );
          const matched =
            schedule !== undefined ? subjectTotal === schedule.total : null;

          return (
            <section
              key={`schedule-total-${grade}`}
              className={`rounded-2xl border p-4 shadow-sm ${
                matched === true
                  ? "border-emerald-300 bg-emerald-50"
                  : matched === false
                    ? "border-red-300 bg-red-50"
                    : "border-zinc-200 bg-white"
              }`}
            >
              {schedule ? (
                <div
                  className={`relative text-sm ${
                    matched === true
                      ? "text-emerald-800"
                      : matched === false
                        ? "text-red-800"
                        : "text-zinc-700"
                  }`}
                >
                  {matched === true || matched === false ? (
                    <span
                      className={`absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold ${
                        matched === true
                          ? "bg-emerald-200 text-emerald-900"
                          : "bg-red-200 text-red-900"
                      }`}
                    >
                      {matched === true ? "일치" : "불일치"}
                    </span>
                  ) : null}
                  <div className="text-center">
                    <p className="flex flex-wrap items-baseline justify-center gap-x-0.5 gap-y-1">
                      <span className="font-medium">수업 총 시수</span>
                      <span className="tabular-nums">
                        ({schedule.classCount} × {schedule.weekdaySum}=)
                        <span className="font-semibold">{schedule.total}</span>
                      </span>
                    </p>
                    <p
                      className={`mt-0.5 text-xs ${
                        matched === true
                          ? "text-emerald-700"
                          : matched === false
                            ? "text-red-700"
                            : "text-zinc-500"
                      }`}
                    >
                      학반 수 × 요일 차시 합
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-center text-xs text-zinc-500">
                  학반 설정 값을 불러오는 중…
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function SubjectsForm({
  termId,
  initialStep = "edit",
}: SubjectsFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [subjects, setSubjects] = useState<GradeSubjects>(
    createDefaultGradeSubjects(),
  );
  const [mode, setMode] = useState<FormMode>(initialStep);
  const [scheduleTotals, setScheduleTotals] = useState<Record<
    Grade,
    GradeScheduleTotal
  > | null>(null);
  const [gradeClassCounts, setGradeClassCounts] = useState<GradeClassCounts>(
    createDefaultClassCounts(),
  );
  const [savingGrade, setSavingGrade] = useState<Grade | null>(null);
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
        const response = await fetch(`/api/terms/${termId}/subjects`);
        const data = (await response.json()) as {
          term?: TermSummary;
          subjects?: GradeSubjects;
          error?: string;
        };

        if (!response.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(data.error ?? "교과 정보를 불러오지 못했습니다.");
          }
          return;
        }

        if (!cancelled) {
          setTerm(data.term ?? null);
          const loaded = sanitizeGradeSubjects(
            ensureGradeSubjects(data.subjects ?? createDefaultGradeSubjects()),
          );
          const hasSaved = hasAnySubjects(loaded);
          setSubjects(
            hasSaved ? withEditRows(loaded) : createDefaultGradeSubjects(),
          );
          setMode(
            hasSaved && initialStep === "classCount" ? "classCount" : "edit",
          );
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
  }, [termId, initialStep]);

  useEffect(() => {
    if (mode !== "classCount") return;

    let cancelled = false;

    async function loadScheduleTotals() {
      try {
        const response = await fetch(`/api/terms/${termId}/day-schedule`);
        const data = (await response.json()) as {
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
          error?: string;
        };

        if (!response.ok) {
          if (!cancelled) {
            setScheduleTotals(null);
            setStatus("error");
            setMessage(
              data.error ?? "학반 설정의 학년 수업 총 시수를 불러오지 못했습니다.",
            );
          }
          return;
        }

        if (!cancelled) {
          const counts = data.classCounts ?? createDefaultClassCounts();
          setGradeClassCounts(counts);
          setScheduleTotals(
            buildScheduleTotals(
              data.grades ?? createDefaultGradeDaySchedules(),
              counts,
            ),
          );
          setSubjects((prev) =>
            ensureGradeSubjects(sanitizeGradeSubjects(prev, counts), counts),
          );
        }
      } catch {
        if (!cancelled) {
          setScheduleTotals(null);
          setStatus("error");
          setMessage("학반 설정의 학년 수업 총 시수를 불러오지 못했습니다.");
        }
      }
    }

    void loadScheduleTotals();
    return () => {
      cancelled = true;
    };
  }, [mode, termId]);

  function updateGrade(grade: Grade, rows: Subject[]) {
    setSubjects((prev) => ({
      ...ensureGradeSubjects(prev),
      [grade]: rows,
    }));
    setStatus("idle");
    setMessage("");
  }

  function startEdit(event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    setSubjects((prev) => withEditRows(prev));
    setMode("edit");
    setStatus("idle");
    setMessage("");
  }

  async function saveSubjects(
    nextSubjects: GradeSubjects,
    options: {
      successMessage: string;
      nextMode: FormMode;
      classCounts?: GradeClassCounts;
      requireSetClassNos?: boolean;
    },
  ) {
    setStatus("saving");
    setMessage("");

    const counts = options.classCounts ?? gradeClassCounts;
    let prepared = sanitizeGradeSubjects(nextSubjects, counts);
    if (options.requireSetClassNos) {
      prepared = sanitizeGradeSubjects(
        alignSetClassNos(prepared, counts),
        counts,
      );
      const setError = validateSetClassAssignments(prepared, counts);
      if (setError) {
        setStatus("error");
        setMessage(setError);
        return false;
      }
    }

    try {
      const response = await fetch(`/api/terms/${termId}/subjects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: prepared }),
      });

      const data = (await response.json()) as {
        subjects?: GradeSubjects;
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }

      const saved = sanitizeGradeSubjects(
        ensureGradeSubjects(data.subjects ?? prepared, counts),
        counts,
      );
      setSubjects(saved);
      setMode(options.nextMode);
      setStatus("success");
      setMessage(options.successMessage);
      return true;
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSubjects(subjects, {
      successMessage: "교과명·단위수가 저장되었습니다.",
      nextMode: "classCount",
    });
  }

  async function handleSaveGradeClassCounts(grade: Grade) {
    setSavingGrade(grade);
    setStatus("saving");
    setMessage("");

    const prepared = sanitizeGradeSubjects(subjects, gradeClassCounts);

    try {
      const response = await fetch(`/api/terms/${termId}/subjects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: prepared }),
      });

      const data = (await response.json()) as {
        subjects?: GradeSubjects;
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return;
      }

      const saved = sanitizeGradeSubjects(
        ensureGradeSubjects(data.subjects ?? prepared, gradeClassCounts),
        gradeClassCounts,
      );
      setSubjects(saved);
      setMode("classCount");
      setStatus("success");
      setMessage(`${grade}학년 수업 학반 수가 저장되었습니다.`);
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSavingGrade(null);
    }
  }

  async function handleClassCountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !scheduleTotals ||
      !GRADES.every(
        (grade) =>
          gradeTotalHours(subjects[grade], scheduleTotals[grade].classCount) ===
          scheduleTotals[grade].total,
      )
    ) {
      setStatus("error");
      setMessage(
        "세 학년의 수업 총 시수가 모두 일치해야 다음 단계로 진행할 수 있습니다.",
      );
      return;
    }

    const ok = await saveSubjects(subjects, {
      successMessage: "수업 학반 수가 저장되었습니다.",
      nextMode: "classCount",
      classCounts: gradeClassCounts,
      requireSetClassNos: true,
    });
    if (ok) router.push(`/terms/${termId}/teachers`);
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

  const isStep2 = mode === "classCount";
  const allTotalsMatched =
    scheduleTotals !== null &&
    GRADES.every(
      (grade) =>
        gradeTotalHours(subjects[grade], scheduleTotals[grade].classCount) ===
        scheduleTotals[grade].total,
    );
  const setAssignmentError = isStep2
    ? validateSetClassAssignments(subjects, gradeClassCounts)
    : null;
  const canGoNext = allTotalsMatched && setAssignmentError === null;

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {isStep2 ? "수업 교과 설정(2/2)" : "수업 교과 설정(1/2)"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {isStep2
            ? "공통 교과는 수업 학반 수를 입력하세요. SET 과목은 학반 수가 1로 고정됩니다. 부분 SET는 교과명 오른쪽에서 원학반 또는 맨 아래 +α(이동 분반)를 지정하세요."
            : "학년별 교과명과 단위수를 입력하세요. SET 과목은 분반마다 한 줄로 입력하세요. 같은 내용을 두 학반이 들으면 물리1·물리2처럼 나누면 됩니다. 엑셀에서 두 열(교과명, 단위수)을 복사한 뒤 표 안에서 Ctrl+V로 붙여넣을 수 있습니다."}
        </p>
      </header>

      {isStep2 ? (
        <form
          onSubmit={handleClassCountSubmit}
          className="flex w-full flex-col gap-6"
        >
          <SubjectClassCountEditor
            subjects={subjects}
            scheduleTotals={scheduleTotals}
            savingGrade={savingGrade}
            onChange={updateGrade}
            onSaveGrade={(grade) => {
              void handleSaveGradeClassCounts(grade);
            }}
          />

          {setAssignmentError ? (
            <p className="text-center text-xs text-amber-700" role="status">
              {setAssignmentError}
            </p>
          ) : null}

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              이전
            </button>
            <span
              className="inline-flex"
              title={
                setAssignmentError
                  ? setAssignmentError
                  : !allTotalsMatched
                    ? "세 학년의 수업 총 시수가 모두 일치해야 다음 단계로 진행할 수 있습니다."
                    : savingGrade !== null
                      ? "수업 학반 수 저장이 끝난 뒤 다시 시도해 주세요."
                      : status === "saving"
                        ? "저장 중입니다."
                        : undefined
              }
            >
              <button
                type="submit"
                disabled={
                  status === "saving" ||
                  savingGrade !== null ||
                  !canGoNext
                }
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "saving" && savingGrade === null
                  ? "저장 중…"
                  : "다음"}
              </button>
            </span>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {GRADES.map((grade) => (
              <SubjectGradeTable
                key={grade}
                grade={grade}
                subjects={subjects[grade]}
                onChange={(rows) => updateGrade(grade, rows)}
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => router.push(`/terms/${termId}/days`)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              이전
            </button>
            <button
              type="submit"
              disabled={status === "saving"}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "저장 중…" : "다음"}
            </button>
          </div>
        </form>
      )}

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
    </div>
  );
}
