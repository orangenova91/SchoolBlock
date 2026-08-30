"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SubjectBlockGrid } from "@/components/subject-block-grid";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
} from "@/lib/set-blocks";
import {
  eraseSubjectBlockAt,
  filterSubjectBlocksToAssignments,
  findSubjectBlockSetConflicts,
  formatSubjectBlockSetConflict,
  formatTeacherClassPlacement,
  lessonTargetKey,
  listSubjectBlockLessons,
  setLockedSlotsForClass,
  subjectBlockSetConflictSlotKey,
  subjectBlocksBySlotForClass,
  teacherBusyElsewhereBySlot,
  teacherPlacementsByClass,
  tryPaintSubjectBlock,
  withPlacedCounts,
  type SubjectBlockLessonOption,
} from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { FLOW_CHAPTER, lockTermFlow } from "@/lib/term-flow-lock";
import {
  GRADES,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type Semester,
  type SetBlockCell,
  type SubjectBlockCell,
  type Teacher,
  type Weekday,
} from "@/lib/types";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type SubjectBlocksFormProps = {
  termId: string;
};

function paintErrorMessage(
  error: string | undefined,
): string {
  switch (error) {
    case "full":
      return "이 교과·학반의 배정 시수를 모두 배치했습니다.";
    case "set-lock":
      return "SET이 고정된 칸입니다.";
    case "set-teacher":
      return "해당 시간에 교사가 SET 수업 중입니다.";
    case "class-busy":
      return "이미 다른 블록이 있는 칸입니다.";
    case "teacher-busy":
      return "교사가 다른 학반 블록과 겹칩니다.";
    case "off-schedule":
      return "수업이 없는 교시입니다.";
    default:
      return "배치할 수 없습니다.";
  }
}

export function SubjectBlocksForm({ termId }: SubjectBlocksFormProps) {
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
  const [cells, setCells] = useState<SubjectBlockCell[]>([]);
  const [grade, setGrade] = useState<Grade>(1);
  const [classNo, setClassNo] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
          blocksRes,
          setBlocksRes,
          teachersRes,
          subjectsRes,
          scheduleRes,
        ] = await Promise.all([
          fetch(`/api/terms/${termId}/subject-blocks`),
          fetch(`/api/terms/${termId}/set-blocks`),
          fetch(`/api/terms/${termId}/teachers`),
          fetch(`/api/terms/${termId}/subjects`),
          fetch(`/api/terms/${termId}/day-schedule`),
        ]);

        const blocksData = (await blocksRes.json()) as {
          term?: TermSummary;
          cells?: SubjectBlockCell[];
          error?: string;
        };
        const setBlocksData = (await setBlocksRes.json()) as {
          cells?: SetBlockCell[];
          partialCells?: SetBlockCell[];
          error?: string;
        };
        const teachersData = (await teachersRes.json()) as {
          teachers?: Teacher[];
          error?: string;
        };
        const subjectsData = (await subjectsRes.json()) as {
          subjects?: GradeSubjects;
          error?: string;
        };
        const scheduleData = (await scheduleRes.json()) as {
          grades?: GradeDaySchedules;
          classCounts?: GradeClassCounts;
          error?: string;
        };

        if (cancelled) return;

        if (!blocksRes.ok) {
          setStatus("error");
          setMessage(blocksData.error ?? "선 수업 배치 내용을 불러오지 못했습니다.");
          setLoading(false);
          return;
        }

        const nextTeachers = sanitizeTeachers(
          ensureTeachers(teachersData.teachers ?? createDefaultTeachers()),
        );
        const nextSubjects = sanitizeGradeSubjects(
          ensureGradeSubjects(
            subjectsData.subjects ?? createDefaultGradeSubjects(),
          ),
        );
        const nextSchedules =
          scheduleData.grades ?? createDefaultGradeDaySchedules();
        const nextCounts =
          scheduleData.classCounts ?? createDefaultClassCounts();
        const catalog = catalogGradeSets(nextSubjects, nextCounts);
        const wholes = filterCellsToCatalog(
          setBlocksData.cells ?? [],
          nextSchedules,
          catalog,
        );
        const partials = filterPartialCellsToCatalog(
          setBlocksData.partialCells ?? [],
          nextSchedules,
          catalog,
        );
        const nextCells = filterSubjectBlocksToAssignments(
          blocksData.cells ?? [],
          nextTeachers,
          nextSubjects,
          nextCounts,
          nextSchedules,
        );

        setTerm(blocksData.term ?? null);
        setTeachers(nextTeachers);
        setSubjects(nextSubjects);
        setSchedules(nextSchedules);
        setClassCounts(nextCounts);
        setWholeCells(wholes);
        setPartialCells(partials);
        setCells(nextCells);
        setClassNo(1);
        setStatus("idle");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
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

  useEffect(() => {
    const max = classCounts[grade] ?? 1;
    if (classNo > max) setClassNo(1);
  }, [grade, classCounts, classNo]);

  const lessonOptions = useMemo(
    () =>
      withPlacedCounts(
        listSubjectBlockLessons(teachers, subjects, classCounts),
        cells,
      ),
    [teachers, subjects, classCounts, cells],
  );

  const classLessons = useMemo(() => {
    const list = lessonOptions.filter(
      (opt) => opt.grade === grade && opt.classNo === classNo,
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (opt) =>
            opt.subjectName.toLowerCase().includes(q) ||
            opt.teacherName.toLowerCase().includes(q),
        )
      : list;
    return [...filtered]
      .map((opt, index) => ({ opt, index }))
      .sort((a, b) => {
        const aPlaced = a.opt.placed > 0 ? 1 : 0;
        const bPlaced = b.opt.placed > 0 ? 1 : 0;
        if (bPlaced !== aPlaced) return bPlaced - aPlaced;
        const aDone = a.opt.placed >= a.opt.required ? 1 : 0;
        const bDone = b.opt.placed >= b.opt.required ? 1 : 0;
        if (bDone !== aDone) return bDone - aDone;
        return a.index - b.index;
      })
      .map((item) => item.opt);
  }, [lessonOptions, grade, classNo, query]);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    return (
      lessonOptions.find(
        (opt) =>
          lessonTargetKey(
            opt.teacherName,
            opt.grade,
            opt.classNo,
            opt.subjectName,
          ) === selectedKey,
      ) ?? null
    );
  }, [lessonOptions, selectedKey]);

  const setLocked = useMemo(
    () =>
      setLockedSlotsForClass(
        wholeCells,
        partialCells,
        subjects,
        classCounts,
        grade,
        classNo,
      ),
    [wholeCells, partialCells, subjects, classCounts, grade, classNo],
  );

  const blocksBySlot = useMemo(
    () => subjectBlocksBySlotForClass(cells, grade, classNo),
    [cells, grade, classNo],
  );

  const setConflicts = useMemo(
    () =>
      findSubjectBlockSetConflicts(
        cells,
        wholeCells,
        partialCells,
        teachers,
        subjects,
        classCounts,
      ),
    [cells, wholeCells, partialCells, teachers, subjects, classCounts],
  );

  const conflictMessages = useMemo(
    () => setConflicts.map(formatSubjectBlockSetConflict),
    [setConflicts],
  );

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of setConflicts) {
      if (item.grade !== grade || item.classNo !== classNo) continue;
      keys.add(subjectBlockSetConflictSlotKey(item));
    }
    return keys;
  }, [setConflicts, grade, classNo]);

  const placedTotal = cells.length;

  const otherPlacedByTeacherSubject = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    for (const cell of cells) {
      if (cell.grade === grade && cell.classNo === classNo) continue;
      const key = `${cell.teacherName.trim()}|${cell.subjectName}`;
      const classes = groups.get(key) ?? new Set<string>();
      classes.add(`${cell.grade}|${cell.classNo}`);
      groups.set(key, classes);
    }
    const map = new Map<string, number>();
    for (const [key, classes] of groups) {
      map.set(key, classes.size);
    }
    return map;
  }, [cells, grade, classNo]);

  const selectedOtherPlacements = useMemo(() => {
    if (!selected) return [];
    return teacherPlacementsByClass(cells, selected.teacherName).filter(
      (item) =>
        item.subjectName === selected.subjectName &&
        (item.grade !== selected.grade || item.classNo !== selected.classNo),
    );
  }, [cells, selected]);

  const selectedOtherCount = selectedOtherPlacements.length;

  const teacherBusyElsewhere = useMemo(() => {
    if (!selected) return new Map<string, SubjectBlockCell>();
    return teacherBusyElsewhereBySlot(
      cells,
      selected.teacherName,
      grade,
      classNo,
    );
  }, [cells, selected, grade, classNo]);

  async function saveCells(successMessage: string, requireOk = false) {
    if (requireOk && setConflicts.length > 0) {
      setStatus("error");
      setMessage(
        "SET과 겹치는 교과 블록이 있습니다. 겹친 칸의 교과 블록을 지운 뒤 다음으로 가 주세요.",
      );
      return false;
    }
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/terms/${termId}/subject-blocks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
      const data = (await response.json()) as {
        cells?: SubjectBlockCell[];
        error?: string;
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }
      setCells(
        filterSubjectBlocksToAssignments(
          data.cells ?? cells,
          teachers,
          subjects,
          classCounts,
          schedules,
        ),
      );
      setStatus("success");
      setMessage(successMessage);
      return true;
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  async function handleSave() {
    await saveCells("선 수업 배치가 저장되었습니다.");
  }

  function resetCells() {
    if (status === "saving" || cells.length === 0) return;
    const confirmed = window.confirm(
      "배치한 선 수업 블록을 모두 초기화할까요? 저장을 눌러야 적용됩니다.",
    );
    if (!confirmed) return;
    lockTermFlow(termId, FLOW_CHAPTER.blocks);
    setCells([]);
    setStatus("idle");
    setMessage("선 수업 블록을 초기화했습니다. 저장을 눌러 반영해 주세요.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await saveCells("선 수업 배치가 저장되었습니다.", true);
    if (ok) router.push(`/terms/${termId}/constraints`);
  }

  function handlePaint(day: Weekday, period: number) {
    if (!selected) {
      setStatus("error");
      setMessage("왼쪽에서 배치할 교과를 선택해 주세요.");
      return;
    }
    const result = tryPaintSubjectBlock({
      cells,
      target: selected,
      day,
      period,
      schedules,
      teachers,
      subjects,
      classCounts,
      wholeCells,
      partialCells,
    });
    if (result.error) {
      setStatus("error");
      setMessage(paintErrorMessage(result.error));
      return;
    }
    setCells(result.cells);
    setStatus("idle");
    setMessage("");
  }

  function handleErase(day: Weekday, period: number) {
    const existing = blocksBySlot.get(`${day}|${period}`);
    if (!existing) return;
    const isConflict = conflictKeys.has(`${day}|${period}`);
    if (
      !isConflict &&
      selected &&
      (existing.teacherName !== selected.teacherName ||
        existing.subjectName !== selected.subjectName)
    ) {
      setSelectedKey(
        lessonTargetKey(
          existing.teacherName,
          existing.grade,
          existing.classNo,
          existing.subjectName,
        ),
      );
      return;
    }
    setCells(
      eraseSubjectBlockAt(
        cells,
        grade,
        classNo,
        day,
        period,
        isConflict ? undefined : selected?.teacherName,
        isConflict ? undefined : selected?.subjectName,
      ),
    );
    setStatus("idle");
    setMessage("");
  }

  function selectLesson(opt: SubjectBlockLessonOption) {
    setSelectedKey(
      lessonTargetKey(
        opt.teacherName,
        opt.grade,
        opt.classNo,
        opt.subjectName,
      ),
    );
    setGrade(opt.grade);
    setClassNo(opt.classNo);
    setStatus("idle");
    setMessage("");
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

  const classOptions = Array.from(
    { length: classCounts[grade] ?? 0 },
    (_, i) => i + 1,
  );

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          선 수업 배치(블록·고정 수업 등..)
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          선 수업 배치처럼 미리 정해 둘 공통 수업을 요일·교시에 고정합니다. SET이
          있는 칸에는 배치할 수 없으며, 나머지 시수는 이후 시간표 배치에서
          자동으로 채워집니다.
        </p>
      </header>

      {conflictMessages.length > 0 ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="alert"
        >
          <p className="font-medium">
            SET과 겹치는 교과 블록 ({conflictMessages.length})
          </p>
          <ul className="mt-2 max-h-36 list-inside list-disc overflow-auto text-xs">
            {conflictMessages.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            빨간 칸을 누르면 교과 블록이 지워집니다. 저장은 가능하지만, 다음으로
            가려면 충돌을 해소해야 합니다.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setGrade(g);
              setClassNo(1);
              setSelectedKey(null);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              grade === g
                ? "border-zinc-800 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {g}학년
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {classOptions.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setClassNo(n);
              setSelectedKey(null);
            }}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              classNo === n
                ? "border-sky-400 bg-sky-50 text-sky-900"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {n}반
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs font-medium text-zinc-500">
            {grade}학년 {classNo}반 공통 교과
          </p>
          <label className="mb-2 block">
            <span className="sr-only">교과·교사 검색</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="교과·교사 검색"
              className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </label>
          <ul className="flex max-h-[28rem] flex-col gap-1 overflow-auto">
            {classLessons.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-zinc-500">
                배치할 공통 수업이 없습니다.
              </li>
            ) : (
              classLessons.map((opt) => {
                const key = lessonTargetKey(
                  opt.teacherName,
                  opt.grade,
                  opt.classNo,
                  opt.subjectName,
                );
                const active = key === selectedKey;
                const done = opt.placed >= opt.required;
                const started = opt.placed > 0;
                const otherPlaced =
                  otherPlacedByTeacherSubject.get(
                    `${opt.teacherName.trim()}|${opt.subjectName}`,
                  ) ?? 0;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => selectLesson(opt)}
                      className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left text-sm transition ${
                        active
                          ? "bg-zinc-900 text-white"
                          : done
                            ? "bg-emerald-50 text-zinc-800 hover:bg-emerald-100"
                            : started
                              ? "bg-amber-50 text-zinc-800 hover:bg-amber-100"
                              : "text-zinc-800 hover:bg-zinc-50"
                      }`}
                    >
                      <span className="truncate font-medium">
                        {opt.subjectName}
                      </span>
                      <span
                        className={`truncate text-xs ${
                          active ? "text-zinc-300" : "text-zinc-500"
                        }`}
                      >
                        {opt.teacherName}
                      </span>
                      <span className="mt-0.5 text-[10px] tabular-nums">
                        <span
                          className={
                            done
                              ? active
                                ? "text-emerald-300"
                                : "text-emerald-700"
                              : active
                                ? "text-amber-200"
                                : "text-amber-700"
                          }
                        >
                          {opt.placed}/{opt.required}
                        </span>
                        {otherPlaced > 0 ? (
                          <span
                            className={
                              active ? "text-zinc-300" : "text-zinc-500"
                            }
                          >
                            {" "}
                            · 다른 반 {otherPlaced}개
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <p className="mt-2 flex justify-center">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                placedTotal > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-zinc-200 bg-zinc-100 text-zinc-600"
              }`}
            >
              {placedTotal > 0
                ? `전체 선 배정된 수업 ${placedTotal}칸`
                : "선 배정된 수업 0칸"}
            </span>
          </p>
        </aside>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">
              {grade}학년 {classNo}반
              {selected ? ` · ${selected.subjectName}` : ""}
            </h2>
            <div className="max-w-full text-right text-xs text-zinc-500">
              {selected ? (
                <>
                  <p>
                    {selected.teacherName} · {selected.placed}/{selected.required}
                    {selectedOtherCount > 0
                      ? ` · 다른 반 ${selectedOtherCount}개`
                      : ""}
                  </p>
                  {selectedOtherPlacements.length > 0 ? (
                    <p className="mt-1 flex flex-wrap justify-end gap-1">
                      {selectedOtherPlacements.map((item) => (
                        <button
                          key={`${item.grade}-${item.classNo}-${item.subjectName}`}
                          type="button"
                          onClick={() =>
                            selectLesson({
                              teacherName: selected.teacherName,
                              grade: item.grade,
                              classNo: item.classNo,
                              subjectName: item.subjectName,
                              required: item.placed,
                              placed: item.placed,
                            })
                          }
                          className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100"
                        >
                          {formatTeacherClassPlacement(item)}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </>
              ) : (
                <p>왼쪽에서 교과를 선택하세요</p>
              )}
            </div>
          </div>
          <SubjectBlockGrid
            periods={schedules[grade]}
            setLocked={setLocked}
            conflictKeys={conflictKeys}
            blocksBySlot={blocksBySlot}
            teacherBusyElsewhere={teacherBusyElsewhere}
            selectedKey={selectedKey}
            disabled={status === "saving"}
            onPaint={handlePaint}
            onErase={handleErase}
          />
          <p className="mt-3 text-center text-xs text-zinc-500">
            칸을 눌러 배치하고, 같은 칸을 다시 누르면 지워집니다. 보라색은 SET
            고정, 회색 타반은 선택한 교사가 다른 학반에 있는 시간입니다.
          </p>
        </section>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/sets/partial`)}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <button
          type="button"
          onClick={resetCells}
          disabled={status === "saving" || cells.length === 0}
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
        <button
          type="submit"
          disabled={status === "saving" || setConflicts.length > 0}
          title={
            setConflicts.length > 0
              ? "SET과 겹치는 교과 블록을 해소해 주세요."
              : undefined
          }
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
