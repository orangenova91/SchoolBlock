"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { SubjectGradeTable } from "@/components/subject-grade-table";
import {
  ensureGradeSubjects,
  sanitizeGradeSubjects,
} from "@/lib/subjects";
import {
  GRADES,
  createDefaultGradeSubjects,
  createEmptySubject,
  type Grade,
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

type SubjectsFormProps = {
  termId: string;
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

function SubjectListView({ subjects }: { subjects: GradeSubjects }) {
  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
      {GRADES.map((grade) => (
        <section
          key={grade}
          className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
            {grade}학년
          </h2>
          {subjects[grade].length === 0 ? (
            <p className="text-center text-sm text-zinc-500">저장된 교과 없음</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {subjects[grade].map((row, index) => (
                <li
                  key={`${grade}-${index}-${row.name}`}
                  className="flex items-center justify-between gap-3 px-1 py-2"
                >
                  <span className="font-medium text-zinc-900">{row.name}</span>
                  <span className="shrink-0 text-zinc-600">{row.units}단위</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function SubjectsForm({ termId }: SubjectsFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [subjects, setSubjects] = useState<GradeSubjects>(
    createDefaultGradeSubjects(),
  );
  const [mode, setMode] = useState<"edit" | "view">("edit");
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
          setSubjects(hasSaved ? loaded : createDefaultGradeSubjects());
          setMode(hasSaved ? "view" : "edit");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    const sanitized = sanitizeGradeSubjects(subjects);

    try {
      const response = await fetch(`/api/terms/${termId}/subjects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: sanitized }),
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
        ensureGradeSubjects(data.subjects ?? sanitized),
      );
      setSubjects(saved);
      setMode("view");
      setStatus("success");
      setMessage("수업 교과 설정이 저장되었습니다.");
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
    <div className="flex w-full flex-col gap-6">
      {term ? (
        <p className="text-center text-sm text-zinc-600">
          {term.timetableName ? `${term.timetableName} · ` : null}
          {term.school} · {term.academicYear}학년도 · {term.semester}학기
        </p>
      ) : null}

      {mode === "view" ? (
        <>
          <SubjectListView subjects={subjects} />
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => router.push(`/terms/${termId}/days`)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              이전
            </button>
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              수정
            </button>
          </div>
        </>
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
              type="button"
              onClick={() => {
                setSubjects(sanitizeGradeSubjects(subjects));
                setMode("view");
                setMessage("");
              }}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={status === "saving"}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "저장 중…" : "저장"}
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
