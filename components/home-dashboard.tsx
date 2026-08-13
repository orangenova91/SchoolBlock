"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Semester } from "@/lib/types";

type TermListItem = {
  id: string;
  timetableName: string | null;
  school: string;
  academicYear: number;
  semester: number;
  createdAt: string;
};

type EditDraft = {
  timetableName: string;
  school: string;
  academicYear: string;
  semester: Semester;
};

const titleInputClassName =
  "w-full bg-transparent p-0 font-medium text-zinc-900 outline-none border-0 border-b border-transparent focus:border-zinc-400";

const metaInputClassName =
  "bg-transparent p-0 text-sm text-zinc-600 outline-none border-0 border-b border-transparent focus:border-zinc-400";

const metaSelectClassName =
  "appearance-none bg-transparent p-0 text-sm text-zinc-600 outline-none border-0 border-b border-transparent focus:border-zinc-400 cursor-pointer";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDraft(term: TermListItem): EditDraft {
  return {
    timetableName: term.timetableName ?? "",
    school: term.school,
    academicYear: String(term.academicYear),
    semester: (term.semester === 2 ? 2 : 1) as Semester,
  };
}

export function HomeDashboard() {
  const [terms, setTerms] = useState<TermListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");
  const [listMessage, setListMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/terms");
        const data = (await response.json()) as {
          terms?: TermListItem[];
          error?: string;
        };

        if (!response.ok) {
          if (!cancelled) {
            setError(data.error ?? "목록을 불러오지 못했습니다.");
          }
          return;
        }

        if (!cancelled) {
          setTerms(data.terms ?? []);
        }
      } catch {
        if (!cancelled) {
          setError("서버에 연결할 수 없습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function startEdit(term: TermListItem) {
    setEditingId(term.id);
    setDraft(toDraft(term));
    setEditError("");
    setListMessage("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditError("");
  }

  async function deleteTerm(term: TermListItem) {
    const label = term.timetableName || "(이름 없음)";
    const confirmed = window.confirm(
      `"${label}" 시간표를 삭제할까요?\n학반·요일·교과 설정도 함께 삭제됩니다.`,
    );
    if (!confirmed) return;

    setDeletingId(term.id);
    setListMessage("");
    setError("");

    try {
      const response = await fetch(`/api/terms/${term.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setListMessage(data.error ?? "삭제에 실패했습니다.");
        return;
      }

      setTerms((prev) => prev.filter((item) => item.id !== term.id));
      if (editingId === term.id) {
        cancelEdit();
      }
      setListMessage("시간표가 삭제되었습니다.");
    } catch {
      setListMessage("서버에 연결할 수 없습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  async function saveEdit(termId: string) {
    if (!draft) return;

    const timetableName = draft.timetableName.trim().replace(/\s+/g, " ");
    const school = draft.school.trim();
    const academicYear = Number(draft.academicYear);

    if (!timetableName) {
      setEditError("시간표명을 입력해 주세요.");
      return;
    }
    if (!school) {
      setEditError("학교를 입력해 주세요.");
      return;
    }
    if (
      !Number.isInteger(academicYear) ||
      academicYear < 2000 ||
      academicYear > 2100
    ) {
      setEditError("학년도는 2000~2100 사이의 정수여야 합니다.");
      return;
    }

    setSavingId(termId);
    setEditError("");

    try {
      const response = await fetch(`/api/terms/${termId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timetableName,
          school,
          academicYear,
          semester: draft.semester,
        }),
      });

      const data = (await response.json()) as Partial<TermListItem> & {
        error?: string;
      };

      if (!response.ok) {
        setEditError(data.error ?? "수정에 실패했습니다.");
        return;
      }

      setTerms((prev) =>
        prev.map((term) =>
          term.id === termId
            ? {
                ...term,
                timetableName: data.timetableName ?? timetableName,
                school: data.school ?? school,
                academicYear: data.academicYear ?? academicYear,
                semester: data.semester ?? draft.semester,
              }
            : term,
        ),
      );
      cancelEdit();
    } catch {
      setEditError("서버에 연결할 수 없습니다.");
    } finally {
      setSavingId(null);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent, termId: string) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      void saveEdit(termId);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>, termId: string) {
    event.preventDefault();
    void saveEdit(termId);
  }

  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">시작하기</h2>
        <p className="mt-2 text-sm text-zinc-600">
          새로운 시간표 작업을 만듭니다.
        </p>
        <Link
          href="/new"
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          새 시간표 작성
        </Link>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">시간표 목록</h2>
          <span className="text-xs text-zinc-500">{terms.length}개</span>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600" role="status">
            불러오는 중…
          </p>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {listMessage ? (
          <p
            className={`mb-3 text-sm ${
              listMessage.includes("삭제되었습니다")
                ? "text-emerald-700"
                : "text-red-600"
            }`}
            role="status"
          >
            {listMessage}
          </p>
        ) : null}

        {!loading && !error && terms.length === 0 ? (
          <p className="text-sm text-zinc-500">
            아직 생성된 시간표가 없습니다. 왼쪽에서 새 시간표를 작성해 주세요.
          </p>
        ) : null}

        {!loading && !error && terms.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {terms.map((term) => {
              const isEditing = editingId === term.id && draft;

              return (
                <li key={term.id}>
                  <div
                    className={`flex items-start gap-2 rounded-lg px-2 py-3 transition-colors ${
                      isEditing
                        ? "border-l-2 border-blue-300 bg-blue-50"
                        : "border-l-2 border-transparent hover:bg-zinc-50"
                    }`}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleSubmit(e, term.id)}
                        onKeyDown={(e) => handleEditKeyDown(e, term.id)}
                        className="min-w-0 flex-1"
                      >
                        <input
                          type="text"
                          required
                          autoFocus
                          aria-label="시간표명"
                          value={draft.timetableName}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, timetableName: e.target.value }
                                : prev,
                            )
                          }
                          className={titleInputClassName}
                        />
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm text-zinc-600">
                          <input
                            type="text"
                            required
                            aria-label="학교"
                            value={draft.school}
                            size={Math.max(draft.school.length, 4)}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? { ...prev, school: e.target.value }
                                  : prev,
                              )
                            }
                            className={`min-w-[3ch] ${metaInputClassName}`}
                          />
                          <span aria-hidden>·</span>
                          <input
                            type="number"
                            required
                            min={2000}
                            max={2100}
                            aria-label="학년도"
                            value={draft.academicYear}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? { ...prev, academicYear: e.target.value }
                                  : prev,
                              )
                            }
                            className={`w-[5.5ch] ${metaInputClassName}`}
                          />
                          <span>학년도</span>
                          <span aria-hidden>·</span>
                          <select
                            aria-label="학기"
                            value={draft.semester}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      semester: Number(
                                        e.target.value,
                                      ) as Semester,
                                    }
                                  : prev,
                              )
                            }
                            className={metaSelectClassName}
                          >
                            <option value={1}>1학기</option>
                            <option value={2}>2학기</option>
                          </select>
                        </div>
                        {term.createdAt ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            {formatDate(term.createdAt)}
                          </p>
                        ) : null}
                        {editError ? (
                          <p className="mt-1 text-xs text-red-600" role="alert">
                            {editError}
                          </p>
                        ) : null}
                      </form>
                    ) : (
                      <Link
                        href={`/terms/${term.id}/days`}
                        className="min-w-0 flex-1"
                      >
                        <p className="font-medium text-zinc-900">
                          {term.timetableName || "(이름 없음)"}
                        </p>
                        <p className="mt-1 text-sm text-zinc-600">
                          {term.school} · {term.academicYear}학년도 ·{" "}
                          {term.semester}학기
                        </p>
                        {term.createdAt ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            {formatDate(term.createdAt)}
                          </p>
                        ) : null}
                      </Link>
                    )}

                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveEdit(term.id)}
                          disabled={savingId === term.id}
                          className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
                          aria-label="저장"
                          title="저장"
                        >
                          {savingId === term.id ? "…" : "💾"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingId === term.id}
                          className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
                          aria-label="취소"
                          title="취소"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(term)}
                          disabled={deletingId === term.id}
                          className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
                          aria-label={`${term.timetableName || "시간표"} 수정`}
                          title="수정"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTerm(term)}
                          disabled={deletingId === term.id}
                          className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          aria-label={`${term.timetableName || "시간표"} 삭제`}
                          title="삭제"
                        >
                          {deletingId === term.id ? "…" : "🗑️"}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
