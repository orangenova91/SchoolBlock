"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ForbiddenPaintGrid } from "@/components/forbidden-paint-grid";
import {
  filterForbiddenSlots,
  findForbiddenSetConflicts,
  findForbiddenSubjectBlockConflicts,
  formatForbiddenConflict,
  formatForbiddenSubjectBlockConflict,
  isForbidden,
  maxPeriodsByWeekday,
  setBlockSlotKeysForTeacher,
  stripForbiddenOverlappingLockedLessons,
  subjectBlockSlotKeysForTeacher,
  toggleForbiddenSlot,
} from "@/lib/teacher-constraints";
import type { ForbiddenLockedLabel } from "@/components/forbidden-paint-grid";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { FLOW_CHAPTER, lockTermFlow } from "@/lib/term-flow-lock";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type Semester,
  type SetBlockCell,
  type SubjectBlockCell,
  type Teacher,
  type TeacherForbiddenSlot,
  type Weekday,
} from "@/lib/types";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type TeacherConstraintsFormProps = {
  termId: string;
};

export function TeacherConstraintsForm({ termId }: TeacherConstraintsFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>(createDefaultTeachers());
  const [subjects, setSubjects] = useState<GradeSubjects>(
    createDefaultGradeSubjects(),
  );
  const [schedules, setSchedules] = useState<GradeDaySchedules>(
    createDefaultGradeDaySchedules(),
  );
  const [classCounts, setClassCounts] = useState<GradeClassCounts>(
    createDefaultClassCounts(),
  );
  const [wholeCells, setWholeCells] = useState<SetBlockCell[]>([]);
  const [partialCells, setPartialCells] = useState<SetBlockCell[]>([]);
  const [subjectBlocks, setSubjectBlocks] = useState<SubjectBlockCell[]>([]);
  const [forbiddenSlots, setForbiddenSlots] = useState<TeacherForbiddenSlot[]>(
    [],
  );
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [teacherQuery, setTeacherQuery] = useState("");
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
        const [
          constraintsRes,
          teachersRes,
          subjectsRes,
          scheduleRes,
          blocksRes,
          subjectBlocksRes,
        ] = await Promise.all([
          fetch(`/api/terms/${termId}/teacher-constraints`),
          fetch(`/api/terms/${termId}/teachers`),
          fetch(`/api/terms/${termId}/subjects`),
          fetch(`/api/terms/${termId}/day-schedule`),
          fetch(`/api/terms/${termId}/set-blocks`),
          fetch(`/api/terms/${termId}/subject-blocks`),
        ]);

        const constraintsData = (await constraintsRes.json()) as {
          term?: TermSummary;
          forbiddenSlots?: TeacherForbiddenSlot[];
          error?: string;
        };
        const teachersData = (await teachersRes.json()) as {
          teachers?: Teacher[];
        };
        const subjectsData = (await subjectsRes.json()) as {
          subjects?: GradeSubjects;
        };
        const scheduleData = (await scheduleRes.json()) as {
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
        };
        const blocksData = (await blocksRes.json()) as {
          cells?: SetBlockCell[];
          partialCells?: SetBlockCell[];
        };
        const subjectBlocksData = (await subjectBlocksRes.json()) as {
          cells?: SubjectBlockCell[];
        };

        if (!constraintsRes.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(
              constraintsData.error ?? "배정 불가 조건을 불러오지 못했습니다.",
            );
          }
          return;
        }

        if (!cancelled) {
          const nextTeachers = sanitizeTeachers(
            ensureTeachers(teachersData.teachers ?? createDefaultTeachers()),
          );
          const nextSchedules =
            scheduleData.grades ?? createDefaultGradeDaySchedules();
          const nextClassCounts =
            scheduleData.classCounts ?? createDefaultClassCounts();
          const nextSubjects = sanitizeGradeSubjects(
            ensureGradeSubjects(
              subjectsData.subjects ?? createDefaultGradeSubjects(),
            ),
          );
          const nextSubjectBlocks = filterSubjectBlocksToAssignments(
            subjectBlocksData.cells ?? [],
            nextTeachers,
            nextSubjects,
            nextClassCounts,
            nextSchedules,
          );
          const nextWhole = blocksData.cells ?? [];
          const nextPartial = blocksData.partialCells ?? [];
          const nextSlots = stripForbiddenOverlappingLockedLessons(
            filterForbiddenSlots(
              constraintsData.forbiddenSlots ?? [],
              nextTeachers,
              nextSchedules,
            ),
            nextSubjectBlocks,
            nextWhole,
            nextPartial,
            nextTeachers,
            nextSubjects,
            nextClassCounts,
          );

          setTerm(constraintsData.term ?? null);
          setTeachers(nextTeachers);
          setSubjects(nextSubjects);
          setSchedules(nextSchedules);
          setClassCounts(nextClassCounts);
          setWholeCells(nextWhole);
          setPartialCells(nextPartial);
          setSubjectBlocks(nextSubjectBlocks);
          setForbiddenSlots(nextSlots);

          const named = nextTeachers.map((t) => t.name.trim()).filter(Boolean);
          setSelectedTeacher((prev) =>
            prev && named.includes(prev) ? prev : (named[0] ?? ""),
          );
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

  const teacherNames = useMemo(
    () => teachers.map((t) => t.name.trim()).filter(Boolean),
    [teachers],
  );

  const sortedTeacherNames = useMemo(() => {
    const indexed = teacherNames.map((name, index) => ({
      name,
      index,
      count: forbiddenSlots.filter((s) => s.teacherName === name).length,
    }));
    indexed.sort((a, b) => {
      const aHas = a.count > 0 ? 1 : 0;
      const bHas = b.count > 0 ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      if (b.count !== a.count) return b.count - a.count;
      return a.index - b.index;
    });
    return indexed.map((item) => item.name);
  }, [teacherNames, forbiddenSlots]);

  const filteredTeacherNames = useMemo(() => {
    const q = teacherQuery.trim().toLowerCase();
    if (!q) return sortedTeacherNames;
    return sortedTeacherNames.filter((name) => name.toLowerCase().includes(q));
  }, [sortedTeacherNames, teacherQuery]);

  const maxByDay = useMemo(
    () => maxPeriodsByWeekday(schedules),
    [schedules],
  );

  const forbiddenKeys = useMemo(() => {
    const set = new Set<string>();
    if (!selectedTeacher) return set;
    for (const s of forbiddenSlots) {
      if (s.teacherName === selectedTeacher) {
        set.add(`${s.day}|${s.period}`);
      }
    }
    return set;
  }, [forbiddenSlots, selectedTeacher]);

  const lockedLabels = useMemo(() => {
    const map = new Map<string, ForbiddenLockedLabel>();
    for (const key of subjectBlockSlotKeysForTeacher(
      subjectBlocks,
      selectedTeacher,
    )) {
      map.set(key, "블록");
    }
    for (const key of setBlockSlotKeysForTeacher(
      wholeCells,
      partialCells,
      teachers,
      subjects,
      classCounts,
      selectedTeacher,
    )) {
      map.set(key, "SET");
    }
    return map;
  }, [
    subjectBlocks,
    wholeCells,
    partialCells,
    teachers,
    subjects,
    classCounts,
    selectedTeacher,
  ]);

  const setConflicts = useMemo(
    () =>
      findForbiddenSetConflicts(
        forbiddenSlots,
        wholeCells,
        partialCells,
        teachers,
        subjects,
        classCounts,
      ),
    [
      forbiddenSlots,
      wholeCells,
      partialCells,
      teachers,
      subjects,
      classCounts,
    ],
  );

  const subjectBlockConflicts = useMemo(
    () => findForbiddenSubjectBlockConflicts(forbiddenSlots, subjectBlocks),
    [forbiddenSlots, subjectBlocks],
  );

  const conflicts = useMemo(
    () => [...setConflicts, ...subjectBlockConflicts],
    [setConflicts, subjectBlockConflicts],
  );

  const conflictMessages = useMemo(
    () => [
      ...setConflicts.map(formatForbiddenConflict),
      ...subjectBlockConflicts.map(formatForbiddenSubjectBlockConflict),
    ],
    [setConflicts, subjectBlockConflicts],
  );

  const selectedCount = useMemo(() => {
    if (!selectedTeacher) return 0;
    return forbiddenSlots.filter((s) => s.teacherName === selectedTeacher)
      .length;
  }, [forbiddenSlots, selectedTeacher]);

  function handleToggle(
    day: Weekday,
    period: number,
    mode: "paint" | "erase",
  ) {
    if (!selectedTeacher) return;
    if (lockedLabels.has(`${day}|${period}`)) return;
    const currently = isForbidden(
      forbiddenSlots,
      selectedTeacher,
      day,
      period,
    );
    if (mode === "paint" && currently) return;
    if (mode === "erase" && !currently) return;
    setForbiddenSlots((prev) =>
      toggleForbiddenSlot(prev, selectedTeacher, day, period),
    );
    setStatus("idle");
    setMessage("");
  }

  async function saveConstraints(
    successMessage: string,
    requireNoConflicts: boolean,
  ): Promise<boolean> {
    if (requireNoConflicts && conflicts.length > 0) {
      setStatus("error");
      setMessage(
        "블록·SET과 겹치는 배정 불가가 있습니다. 불가 교시를 지워 주세요.",
      );
      return false;
    }

    setStatus("saving");
    setMessage("");
    const slotsToSave = stripForbiddenOverlappingLockedLessons(
      forbiddenSlots,
      subjectBlocks,
      wholeCells,
      partialCells,
      teachers,
      subjects,
      classCounts,
    );
    try {
      const response = await fetch(
        `/api/terms/${termId}/teacher-constraints`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forbiddenSlots: slotsToSave }),
        },
      );
      const data = (await response.json()) as {
        forbiddenSlots?: TeacherForbiddenSlot[];
        conflicts?: string[];
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }

      setForbiddenSlots(
        stripForbiddenOverlappingLockedLessons(
          filterForbiddenSlots(
            data.forbiddenSlots ?? slotsToSave,
            teachers,
            schedules,
          ),
          subjectBlocks,
          wholeCells,
          partialCells,
          teachers,
          subjects,
          classCounts,
        ),
      );
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
    await saveConstraints("배정 불가 교시가 저장되었습니다.", false);
  }

  function resetForbiddenSlots() {
    if (status === "saving" || forbiddenSlots.length === 0) return;
    const confirmed = window.confirm(
      "칠한 배정 불가 교시를 모두 초기화할까요? 저장을 눌러야 적용됩니다.",
    );
    if (!confirmed) return;
    lockTermFlow(termId, FLOW_CHAPTER.constraints);
    setForbiddenSlots([]);
    setStatus("idle");
    setMessage("배정 불가 교시를 초기화했습니다. 저장을 눌러 반영해 주세요.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await saveConstraints(
      "배정 불가 교시가 저장되었습니다.",
      true,
    );
    // Full navigation so a stale client bundle cannot skip to /timetable.
    if (ok) {
      window.location.assign(`/terms/${termId}/preferences`);
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
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          교사 교시 배정 불가
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          특정 교사가 수업할 수 없는 요일·교시를 칠하세요. 시간표 생성 시 해당
          칸에는 배정되지 않습니다. 블록·SET으로 이미 배정된 시간은 선택할 수
          없습니다.
        </p>
      </header>

      {conflictMessages.length > 0 ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="alert"
        >
          <p className="font-medium">
            블록·SET과 겹치는 배정 불가 ({conflictMessages.length})
          </p>
          <ul className="mt-2 max-h-36 list-inside list-disc overflow-auto text-xs">
            {conflictMessages.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            저장은 가능하지만, 다음으로 가려면 충돌을 해소해야 합니다.
          </p>
        </div>
      ) : null}

      {teacherNames.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          등록된 교사가 없습니다. 교사 배정 단계에서 교사를 추가해 주세요.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs font-medium text-zinc-500">교사</p>
            <label className="mb-2 block">
              <span className="sr-only">교사명 검색</span>
              <input
                type="search"
                value={teacherQuery}
                onChange={(event) => setTeacherQuery(event.target.value)}
                placeholder="교사명 검색"
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </label>
            <ul className="flex max-h-[28rem] flex-col gap-1 overflow-auto">
              {filteredTeacherNames.length === 0 ? (
                <li className="px-2.5 py-4 text-center text-xs text-zinc-500">
                  검색 결과가 없습니다.
                </li>
              ) : (
                filteredTeacherNames.map((name) => {
                  const count = forbiddenSlots.filter(
                    (s) => s.teacherName === name,
                  ).length;
                  const selected = name === selectedTeacher;
                  const started = count > 0;
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => setSelectedTeacher(name)}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition ${
                          selected
                            ? "bg-zinc-900 text-white"
                            : started
                              ? "bg-rose-50 text-zinc-800 hover:bg-rose-100"
                              : "text-zinc-800 hover:bg-zinc-50"
                        }`}
                      >
                        <span className="truncate">{name}</span>
                        {count > 0 ? (
                          <span
                            className={`ml-2 shrink-0 text-[10px] ${
                              selected ? "text-zinc-300" : "text-rose-600"
                            }`}
                          >
                            {count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="mt-2 flex justify-center">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                  forbiddenSlots.length > 0
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-zinc-200 bg-zinc-100 text-zinc-600"
                }`}
              >
                {forbiddenSlots.length > 0
                  ? `전체 배정 불가 ${forbiddenSlots.length}칸`
                  : "배정 불가 0칸"}
              </span>
            </p>
          </aside>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">
                {selectedTeacher || "교사 선택"}
              </h2>
              <p className="text-xs text-zinc-500">
                배정 불가 {selectedCount}칸 · 전체 {forbiddenSlots.length}칸
              </p>
            </div>
            {selectedTeacher ? (
              <ForbiddenPaintGrid
                maxByDay={maxByDay}
                forbiddenKeys={forbiddenKeys}
                lockedLabels={lockedLabels}
                onToggle={handleToggle}
              />
            ) : (
              <p className="py-8 text-center text-sm text-zinc-500">
                왼쪽에서 교사를 선택하세요.
              </p>
            )}
            <p className="mt-3 text-center text-xs text-zinc-500">
              칸을 누르거나 끌어 칠하고, 다시 누르면 지워집니다. 「블록」·「SET」
              칸은 이미 배정된 시간이라 배정 불가로 칠할 수 없습니다.
            </p>
          </section>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/blocks`)}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={resetForbiddenSlots}
          disabled={status === "saving" || forbiddenSlots.length === 0}
          className="rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          초기화
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
        <span
          title={
            conflicts.length > 0
              ? "블록·SET과 겹치는 배정 불가를 해소해 주세요."
              : undefined
          }
        >
          <button
            type="submit"
            disabled={status === "saving" || conflicts.length > 0}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "saving" ? "저장 중…" : "다음"}
          </button>
        </span>
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
