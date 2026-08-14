"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  alignAssignmentToSubject,
  createAssignmentForSubject,
  cycleCellHours,
  ensureTeachers,
  filterAssignmentsToSubjects,
  hasAnyAssignment,
  hasValidAssignmentHours,
  isSetSubject,
  parseTeachersFromClipboard,
  parseTeachersFromCsv,
  sanitizeTeachers,
  syncAssignmentItem,
  teacherTotalHours,
  teachersToCsv,
  withEditTeacherRows,
  type TeachersCsvError,
} from "@/lib/teachers";
import {
  ensureGradeSubjects,
  sanitizeGradeSubjects,
  subjectSetBadgeClass,
} from "@/lib/subjects";
import {
  DEFAULT_SUBJECT_SET,
  GRADES,
  MAX_ASSIGNMENT_HOURS,
  MIN_ASSIGNMENT_HOURS,
  createDefaultClassCounts,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  createEmptyTeacher,
  createEmptyTeacherAssignments,
  type AssignmentItem,
  type Grade,
  type GradeClassCounts,
  type GradeSubjects,
  type Semester,
  type Subject,
  type Teacher,
} from "@/lib/types";

type TermSummary = {
  id: string;
  timetableName?: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

type TeachersFormProps = {
  termId: string;
};

type DragSubjectPayload = {
  grade: Grade;
  name: string;
};

const DRAG_MIME = "application/x-timetable-subject";
const TEACHER_DRAG_MIME = "application/x-timetable-teacher-row";

function subjectBadgeLabel(subject: Subject) {
  const setLabel =
    subject.set && subject.set !== "공통" ? `${subject.set}·` : "";
  return {
    name: `${setLabel}${subject.name}`,
    detail: `${subject.units}단위 × ${subject.classCount}학급 = ${subject.units * subject.classCount}`,
  };
}

function requiredHoursForSubject(subject: Subject): number {
  return subject.units * Math.max(1, subject.classCount);
}

function unmatchedSubjectHours(
  subjects: GradeSubjects,
  hoursBySubject: Map<string, number>,
): { grade: Grade; name: string; assigned: number; required: number }[] {
  const unmatched: {
    grade: Grade;
    name: string;
    assigned: number;
    required: number;
  }[] = [];
  for (const grade of GRADES) {
    for (const subject of subjects[grade] ?? []) {
      const assigned = hoursBySubject.get(`${grade}:${subject.name}`) ?? 0;
      const required = requiredHoursForSubject(subject);
      if (assigned !== required) {
        unmatched.push({
          grade,
          name: subject.name,
          assigned,
          required,
        });
      }
    }
  }
  return unmatched;
}

function assignedHoursMap(teachers: Teacher[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const teacher of teachers) {
    for (const grade of GRADES) {
      for (const item of teacher.assignments[grade] ?? []) {
        const key = `${grade}:${item.name}`;
        map.set(key, (map.get(key) ?? 0) + (item.hours ?? 0));
      }
    }
  }
  return map;
}

function assignmentFillClass(assigned: number, required: number): string {
  if (required <= 0) return "text-zinc-600";
  if (assigned === required) return "font-semibold text-emerald-700";
  if (assigned > required) return "font-semibold text-red-600";
  if (assigned > 0) return "font-semibold text-amber-700";
  return "text-zinc-500";
}

function parseDragPayload(event: React.DragEvent): DragSubjectPayload | null {
  const raw =
    event.dataTransfer.getData(DRAG_MIME) ||
    event.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragSubjectPayload;
    if (
      (parsed.grade === 1 || parsed.grade === 2 || parsed.grade === 3) &&
      typeof parsed.name === "string" &&
      parsed.name.trim().length > 0
    ) {
      return { grade: parsed.grade, name: parsed.name.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

function AssignmentHoursPanel({
  selected,
  options,
  disabled,
  onAdd,
  onRemove,
  children,
}: {
  selected: { grade: Grade; name: string }[];
  options: { grade: Grade; subject: Subject }[];
  disabled?: boolean;
  onAdd: (grade: Grade, name: string) => void;
  onRemove: (grade: Grade, name: string) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    searchRef.current?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions =
    normalizedQuery.length === 0
      ? options
      : options.filter(({ grade, subject }) => {
          const haystack = `${grade}학년 ${subject.name}`.toLowerCase();
          return (
            subject.name.toLowerCase().includes(normalizedQuery) ||
            haystack.includes(normalizedQuery)
          );
        });

  function isSelected(grade: Grade, name: string) {
    return selected.some((item) => item.grade === grade && item.name === name);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (disabled) return;
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
    setOpen(false);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setOver(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    if (disabled) return;

    const payload = parseDragPayload(event);
    if (!payload) return;
    if (isSelected(payload.grade, payload.name)) return;
    onAdd(payload.grade, payload.name);
  }

  function toggleItem(grade: Grade, name: string) {
    if (isSelected(grade, name)) {
      onRemove(grade, name);
    } else {
      onAdd(grade, name);
    }
  }

  function openPicker() {
    if (disabled || options.length === 0) return;
    setOpen(true);
  }

  return (
    <div
      ref={rootRef}
      className={`relative min-h-[4.5rem] min-w-0 rounded-md border px-2 py-1.5 transition ${
        over
          ? "border-sky-400 bg-sky-50"
          : open
            ? "border-zinc-400 bg-white"
            : "border-zinc-200 bg-white"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {selected.length === 0 ? (
        <button
          type="button"
          disabled={disabled || options.length === 0}
          onClick={openPicker}
          className="flex min-h-[3.25rem] w-full items-center justify-center rounded px-1 py-2 text-center text-[11px] text-zinc-500 outline-none hover:bg-zinc-50 disabled:cursor-not-allowed"
        >
          {options.length === 0 ? (
            "교과 없음"
          ) : (
            <>
              교과를 끌어다 놓거나
              <br />
              클릭하여 선택하세요
            </>
          )}
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          {children}
          <button
            type="button"
            disabled={disabled || options.length === 0}
            onClick={openPicker}
            className="self-start rounded px-1 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 disabled:cursor-not-allowed"
          >
            + 교과 추가
          </button>
        </div>
      )}

      {open && options.length > 0 ? (
        <div
          className="absolute z-20 mt-1 w-max min-w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-zinc-100 p-1.5">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder="과목명 검색"
              aria-label="과목명 검색"
              className="w-full rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
            />
          </div>
          <div
            role="listbox"
            aria-label="교과 목록"
            className="max-h-52 overflow-auto py-1"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-zinc-500">
                검색 결과 없음
              </p>
            ) : (
              filteredOptions.map(({ grade, subject }) => {
                const checked = isSelected(grade, subject.name);
                const label = subjectBadgeLabel(subject);
                return (
                  <label
                    key={`${grade}-${subject.name}`}
                    className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleItem(grade, subject.name)}
                      className="mt-0.5"
                    />
                    <span className="whitespace-nowrap text-zinc-800">
                      <span className="text-zinc-500">{grade}학년 </span>
                      <span className="font-medium">{label.name}</span>
                      <span className="text-zinc-500"> ({label.detail})</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DraggableSubjectBadge({
  grade,
  subject,
  assignedHours,
  requiredHours,
}: {
  grade: Grade;
  subject: Subject;
  assignedHours: number;
  requiredHours: number;
}) {
  const label = subjectBadgeLabel(subject);

  function handleDragStart(event: React.DragEvent<HTMLSpanElement>) {
    const payload: DragSubjectPayload = { grade, name: subject.name };
    const json = JSON.stringify(payload);
    event.dataTransfer.setData(DRAG_MIME, json);
    event.dataTransfer.setData("text/plain", json);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <span
      draggable
      onDragStart={handleDragStart}
      className={`inline-flex cursor-grab items-center rounded-full border px-3 py-1 text-xs active:cursor-grabbing ${subjectSetBadgeClass(subject.set)}`}
      title={`${label.detail} · 배정 ${assignedHours}/${requiredHours}`}
    >
      <span className="font-medium">{label.name}</span>
      <span className="mx-0.5 opacity-40">(</span>
      <span
        className={`tabular-nums ${assignmentFillClass(assignedHours, requiredHours)}`}
      >
        {assignedHours}/{requiredHours}
      </span>
      <span className="mx-0.5 opacity-40">)</span>
    </span>
  );
}

function AssignmentHoursEditor({
  item,
  subject,
  disabled,
  showClassLabels = false,
  onCycleCell,
}: {
  item: AssignmentItem;
  subject: Subject | undefined;
  disabled?: boolean;
  showClassLabels?: boolean;
  onCycleCell: (cellIndex: number) => void;
}) {
  const classHours = item.classHours ?? [item.hours];
  const setMode = isSetSubject(subject);

  return (
    <div className="flex flex-wrap gap-0.5">
      {classHours.map((value, cellIndex) => {
        const classNo = cellIndex + 1;
        const label = setMode
          ? `SET 시수 ${value}`
          : `${classNo}반 시수 ${value}`;

        return (
          <div
            key={cellIndex}
            className="flex w-6 flex-col items-center gap-0.5"
          >
            {showClassLabels && !setMode ? (
              <span className="text-[9px] leading-none tabular-nums text-zinc-400">
                {classNo}
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCycleCell(cellIndex)}
              className={`flex h-6 w-6 items-center justify-center rounded border text-[10px] font-medium tabular-nums transition disabled:opacity-50 ${
                setMode
                  ? subjectSetBadgeClass(subject?.set)
                  : value > 0
                    ? "border-zinc-400 bg-zinc-100 text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300"
              }`}
              aria-label={label}
              title={`${label} · 클릭하여 변경 (0~10)`}
            >
              {value}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function TeachersForm({ termId }: TeachersFormProps) {
  const router = useRouter();
  const [term, setTerm] = useState<TermSummary | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>(createDefaultTeachers());
  const [subjects, setSubjects] = useState<GradeSubjects>(
    createDefaultGradeSubjects(),
  );
  const [gradeClassCounts, setGradeClassCounts] = useState<GradeClassCounts>(
    createDefaultClassCounts(),
  );
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [csvPreview, setCsvPreview] = useState<{
    teachers: Teacher[];
    errors: TeachersCsvError[];
  } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [dragTeacherIndex, setDragTeacherIndex] = useState<number | null>(null);
  const [dropTeacherIndex, setDropTeacherIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMessage("");

      try {
        const [teachersRes, subjectsRes, scheduleRes] = await Promise.all([
          fetch(`/api/terms/${termId}/teachers`),
          fetch(`/api/terms/${termId}/subjects`),
          fetch(`/api/terms/${termId}/day-schedule`),
        ]);

        const teachersData = (await teachersRes.json()) as {
          term?: TermSummary;
          teachers?: Teacher[];
          error?: string;
        };
        const subjectsData = (await subjectsRes.json()) as {
          subjects?: GradeSubjects;
          error?: string;
        };
        const scheduleData = (await scheduleRes.json()) as {
          classCounts?: GradeClassCounts;
          error?: string;
        };

        if (!teachersRes.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(
              teachersData.error ?? "교사 명단을 불러오지 못했습니다.",
            );
          }
          return;
        }

        if (!cancelled) {
          setTerm(teachersData.term ?? null);

          const loadedSubjects = subjectsRes.ok
            ? sanitizeGradeSubjects(
                ensureGradeSubjects(
                  subjectsData.subjects ?? createDefaultGradeSubjects(),
                ),
              )
            : createDefaultGradeSubjects();
          setSubjects(loadedSubjects);

          const loadedClassCounts = scheduleRes.ok
            ? (scheduleData.classCounts ?? createDefaultClassCounts())
            : createDefaultClassCounts();
          setGradeClassCounts(loadedClassCounts);

          const loadedTeachers = sanitizeTeachers(
            ensureTeachers(teachersData.teachers ?? createDefaultTeachers()),
          ).map((t) => ({
            ...t,
            assignments: filterAssignmentsToSubjects(
              t.assignments,
              loadedSubjects,
              loadedClassCounts,
            ),
          }));

          setTeachers(
            loadedTeachers.length > 0
              ? withEditTeacherRows(loadedTeachers)
              : createDefaultTeachers(),
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
  }, [termId]);

  function updateRowName(index: number, name: string) {
    setTeachers((prev) => {
      const base = prev.length > 0 ? prev : [createEmptyTeacher()];
      return base.map((row, i) => (i === index ? { ...row, name } : row));
    });
    setStatus("idle");
    setMessage("");
  }

  function addAssignment(index: number, grade: Grade, name: string) {
    setTeachers((prev) => {
      const base = prev.length > 0 ? prev : [createEmptyTeacher()];
      return base.map((row, i) => {
        if (i !== index) return row;
        const current = row.assignments[grade] ?? [];
        if (current.some((item) => item.name === name)) return row;
        return {
          ...row,
          assignments: {
            ...row.assignments,
            [grade]: [
              ...current,
              createAssignmentForSubject(
                subjects,
                grade,
                name,
                gradeClassCounts,
              ),
            ],
          },
        };
      });
    });
    setStatus("idle");
    setMessage("");
  }

  function removeAssignment(index: number, grade: Grade, name: string) {
    setTeachers((prev) => {
      const base = prev.length > 0 ? prev : [createEmptyTeacher()];
      return base.map((row, i) =>
        i === index
          ? {
              ...row,
              assignments: {
                ...row.assignments,
                [grade]: (row.assignments[grade] ?? []).filter(
                  (item) => item.name !== name,
                ),
              },
            }
          : row,
      );
    });
    setStatus("idle");
    setMessage("");
  }

  function updateAssignmentClassHour(
    index: number,
    grade: Grade,
    name: string,
    cellIndex: number,
  ) {
    setTeachers((prev) => {
      const base = prev.length > 0 ? prev : [createEmptyTeacher()];
      return base.map((row, i) => {
        if (i !== index) return row;
        return {
          ...row,
          assignments: {
            ...row.assignments,
            [grade]: (row.assignments[grade] ?? []).map((item) => {
              if (item.name !== name) return item;
              const subject = subjects[grade]?.find((s) => s.name === name);
              const aligned = alignAssignmentToSubject(
                item,
                subject,
                gradeClassCounts[grade],
              );
              const classHours = [...aligned.classHours];
              if (cellIndex < 0 || cellIndex >= classHours.length) {
                return aligned;
              }
              classHours[cellIndex] = cycleCellHours(classHours[cellIndex]);
              return syncAssignmentItem(name, classHours);
            }),
          },
        };
      });
    });
    setStatus("idle");
    setMessage("");
  }

  function addRow() {
    setTeachers((prev) => [
      ...(prev.length > 0 ? prev : []),
      createEmptyTeacher(),
    ]);
    setStatus("idle");
    setMessage("");
  }

  function removeRow(index: number) {
    setTeachers((prev) => {
      const base = prev.length > 0 ? prev : [createEmptyTeacher()];
      if (base.length <= 1) return [createEmptyTeacher()];
      return base.filter((_, i) => i !== index);
    });
    setStatus("idle");
    setMessage("");
  }

  function moveTeacher(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setTeachers((prev) => {
      const base = prev.length > 0 ? [...prev] : [createEmptyTeacher()];
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= base.length ||
        toIndex >= base.length
      ) {
        return base;
      }
      const [moved] = base.splice(fromIndex, 1);
      base.splice(toIndex, 0, moved);
      return base;
    });
    setStatus("idle");
    setMessage("");
  }

  function handleTeacherDragStart(
    event: React.DragEvent<HTMLElement>,
    index: number,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TEACHER_DRAG_MIME, String(index));
    event.dataTransfer.setData("text/plain", String(index));
    setDragTeacherIndex(index);
  }

  function handleTeacherDragOver(
    event: React.DragEvent<HTMLElement>,
    index: number,
  ) {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes(TEACHER_DRAG_MIME) && !types.includes("text/plain")) {
      return;
    }
    // Subject badge drag uses DRAG_MIME — don't steal those drops
    if (types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTeacherIndex(index);
  }

  function handleTeacherDrop(
    event: React.DragEvent<HTMLElement>,
    index: number,
  ) {
    event.preventDefault();
    const raw =
      event.dataTransfer.getData(TEACHER_DRAG_MIME) ||
      event.dataTransfer.getData("text/plain");
    const fromIndex = Number(raw);
    setDragTeacherIndex(null);
    setDropTeacherIndex(null);
    if (!Number.isInteger(fromIndex)) return;
    moveTeacher(fromIndex, index);
  }

  function handleTeacherDragEnd() {
    setDragTeacherIndex(null);
    setDropTeacherIndex(null);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    if (!text.includes("\n") && !text.includes("\r") && !text.includes("\t")) {
      return;
    }

    const parsed = parseTeachersFromClipboard(text);
    if (parsed.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    setTeachers(parsed);
    setStatus("idle");
    setMessage("");
  }

  function handleDownloadCsv() {
    const csv = teachersToCsv(teachers, subjects);
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `교사배정_${stamp}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleCsvFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = parseTeachersFromCsv(text, subjects, gradeClassCounts);
      setCsvPreview(result);
      setStatus("idle");
      setMessage("");
    };
    reader.onerror = () => {
      setStatus("error");
      setMessage("CSV 파일을 읽을 수 없습니다.");
    };
    reader.readAsText(file, "UTF-8");
  }

  function applyCsvPreview() {
    if (!csvPreview || csvPreview.errors.length > 0) return;
    if (csvPreview.teachers.length === 0) {
      setStatus("error");
      setMessage("적용할 교사 데이터가 없습니다.");
      return;
    }

    const next = csvPreview.teachers.map((t) => ({
      ...t,
      assignments: filterAssignmentsToSubjects(
        t.assignments,
        subjects,
        gradeClassCounts,
      ),
    }));
    setTeachers(withEditTeacherRows(next));
    setCsvPreview(null);
    setStatus("idle");
    setMessage(
      `CSV에서 교사 ${next.length}명의 배정을 불러왔습니다. 저장을 눌러 반영하세요.`,
    );
  }

  async function saveTeachers(successMessage: string) {
    setStatus("saving");
    setMessage("");

    const withFiltered = ensureTeachers(teachers).map((t) => ({
      ...t,
      name: t.name.trim(),
      assignments: filterAssignmentsToSubjects(
        t.assignments,
        subjects,
        gradeClassCounts,
      ),
    }));

    const sanitized = sanitizeTeachers(withFiltered);
    if (sanitized.length === 0) {
      setStatus("error");
      setMessage("교사명을 한 명 이상 입력해 주세요.");
      return false;
    }

    const missing = sanitized.find((t) => !hasAnyAssignment(t));
    if (missing) {
      setStatus("error");
      setMessage(
        `"${missing.name}" 교사에게 담당 교과를 한 과목 이상 지정해 주세요.`,
      );
      return false;
    }

    const badHours = sanitized.find((t) => !hasValidAssignmentHours(t));
    if (badHours) {
      setStatus("error");
      setMessage(
        `"${badHours.name}" 교사의 교과 시수를 ${MIN_ASSIGNMENT_HOURS}~${MAX_ASSIGNMENT_HOURS} 사이로 입력해 주세요.`,
      );
      return false;
    }

    try {
      const response = await fetch(`/api/terms/${termId}/teachers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teachers: sanitized }),
      });

      const data = (await response.json()) as {
        teachers?: Teacher[];
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }

      const saved = sanitizeTeachers(
        ensureTeachers(data.teachers ?? sanitized),
      ).map((t) => ({
        ...t,
        assignments: filterAssignmentsToSubjects(
          t.assignments,
          subjects,
          gradeClassCounts,
        ),
      }));
      setTeachers(withEditTeacherRows(saved));
      setStatus("success");
      setMessage(successMessage);
      return true;
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  async function handleSaveTeachers() {
    await saveTeachers("교사 명단이 저장되었습니다.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const unmatched = unmatchedSubjectHours(
      subjects,
      assignedHoursMap(teachers),
    );
    if (unmatched.length > 0) {
      const first = unmatched[0];
      setStatus("error");
      setMessage(
        `모든 교과의 배정 시수가 필요 시수와 같아야 합니다. 예: ${first.grade}학년 ${first.name} ${first.assigned}/${first.required}`,
      );
      return;
    }
    const ok = await saveTeachers("교사 명단이 저장되었습니다.");
    if (ok) router.push(`/terms/${termId}/sets`);
  }

  const hoursBySubject = useMemo(() => assignedHoursMap(teachers), [teachers]);
  const hoursComplete = useMemo(
    () => unmatchedSubjectHours(subjects, hoursBySubject).length === 0,
    [subjects, hoursBySubject],
  );

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

  const rows =
    teachers.length > 0
      ? teachers.map((t) => ({
          ...t,
          assignments: t.assignments ?? createEmptyTeacherAssignments(),
        }))
      : [createEmptyTeacher()];

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          교사 배정
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          학년별 담당 교과를 지정한 뒤, 교과별 시수를 입력하세요. 교과별 시수
          칸을 클릭하거나 교과 배지를 끌어다 놓을 수 있고, CSV로 일괄 편집할
          수도 있습니다. 교사마다 담당 교과를 한 과목 이상 지정해야 합니다.
        </p>
      </header>

      {term ? (
        <p className="text-center text-sm text-zinc-600">
          {term.timetableName ? `${term.timetableName} · ` : null}
          {term.school} · {term.academicYear}학년도 · {term.semester}학기
        </p>
      ) : null}

      <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
            교사 명단
          </h2>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={status === "saving"}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              CSV 내려받기
            </button>
            <button
              type="button"
              onClick={() => csvFileRef.current?.click()}
              disabled={status === "saving"}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              CSV 올리기
            </button>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvFileChange}
            />
          </div>

          <div className="overflow-x-auto" onPaste={handlePaste}>
            <div className="mb-2 grid min-w-[40rem] grid-cols-[1.25rem_1.5rem_3.5rem_minmax(18rem,1fr)_2.5rem] items-center gap-x-1 gap-y-2 border border-transparent p-2 text-xs font-medium text-zinc-500">
              <span aria-hidden="true" />
              <span className="text-center">순</span>
              <span>교사명</span>
              <span>교과별 시수</span>
              <span aria-hidden="true" />
            </div>
            <div className="flex min-w-[40rem] flex-col gap-3">
              {rows.map((row, index) => {
                const flatItems = GRADES.flatMap((grade) =>
                  (row.assignments[grade] ?? []).map((item) => {
                    const subject = subjects[grade]?.find(
                      (s) => s.name === item.name,
                    );
                    return {
                      grade,
                      ...alignAssignmentToSubject(
                        item,
                        subject,
                        gradeClassCounts[grade],
                      ),
                    };
                  }),
                );
                const isDragging = dragTeacherIndex === index;
                const isDropTarget =
                  dropTeacherIndex === index &&
                  dragTeacherIndex !== null &&
                  dragTeacherIndex !== index;

                return (
                  <article
                    key={index}
                    onDragOver={(event) => handleTeacherDragOver(event, index)}
                    onDrop={(event) => handleTeacherDrop(event, index)}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node)) {
                        return;
                      }
                      if (dropTeacherIndex === index) setDropTeacherIndex(null);
                    }}
                    className={`grid grid-cols-[1.25rem_1.5rem_3.5rem_minmax(18rem,1fr)_2.5rem] items-start gap-x-1 gap-y-2 rounded-xl border bg-zinc-50/40 p-2 transition ${
                      isDragging
                        ? "border-sky-300 opacity-60"
                        : isDropTarget
                          ? "border-sky-400 bg-sky-50/70"
                          : "border-zinc-200"
                    }`}
                  >
                    <button
                      type="button"
                      draggable={status !== "saving"}
                      onDragStart={(event) =>
                        handleTeacherDragStart(event, index)
                      }
                      onDragEnd={handleTeacherDragEnd}
                      disabled={status === "saving"}
                      className="mt-1 cursor-grab touch-none select-none rounded px-0 py-1 text-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${index + 1}번 교사 순서 이동`}
                      title="드래그하여 순서 변경"
                    >
                      ⋮⋮
                    </button>

                    <span className="pt-2 text-center text-xs tabular-nums text-zinc-500">
                      {index + 1}
                    </span>

                    <div className="pt-0.5">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateRowName(index, e.target.value)}
                        onPaste={handlePaste}
                        placeholder="예: 김선생"
                        aria-label={`교사명 ${index + 1}`}
                        className="w-full rounded-md border border-zinc-300 bg-white px-1 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                      />
                      <p
                        className="mt-1 text-center text-xl font-medium tabular-nums text-zinc-700"
                        aria-label={`${row.name || "교사"} 총 시수 ${teacherTotalHours(row)}`}
                      >
                        {teacherTotalHours(row)}
                      </p>
                    </div>

                    <AssignmentHoursPanel
                      selected={flatItems.map((item) => ({
                        grade: item.grade,
                        name: item.name,
                      }))}
                      options={GRADES.flatMap((grade) =>
                        (subjects[grade] ?? []).map((subject) => ({
                          grade,
                          subject,
                        })),
                      )}
                      disabled={status === "saving"}
                      onAdd={(grade, name) =>
                        addAssignment(index, grade, name)
                      }
                      onRemove={(grade, name) =>
                        removeAssignment(index, grade, name)
                      }
                    >
                      <ul className="flex flex-col gap-1.5">
                        {(() => {
                          const firstCommonIndex = flatItems.findIndex(
                            (fi) => {
                              const s = subjects[fi.grade]?.find(
                                (sub) => sub.name === fi.name,
                              );
                              return !isSetSubject(s);
                            },
                          );
                          return flatItems.map((item, itemIndex) => {
                            const subject = subjects[item.grade]?.find(
                              (s) => s.name === item.name,
                            );
                            const setLabel =
                              subject && subject.set !== DEFAULT_SUBJECT_SET
                                ? `${subject.set}·`
                                : "";
                            return (
                              <li
                                key={`${item.grade}-${item.name}`}
                                className="flex items-center gap-1.5 text-xs"
                              >
                                <span className="w-8 shrink-0 text-zinc-500">
                                  {item.grade}학년
                                </span>
                                <span className="w-40 shrink-0 truncate font-medium text-zinc-800">
                                  {setLabel}
                                  {item.name}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <AssignmentHoursEditor
                                    item={item}
                                    subject={subject}
                                    disabled={status === "saving"}
                                    showClassLabels={
                                      firstCommonIndex === itemIndex
                                    }
                                    onCycleCell={(cellIndex) =>
                                      updateAssignmentClassHour(
                                        index,
                                        item.grade,
                                        item.name,
                                        cellIndex,
                                      )
                                    }
                                  />
                                </div>
                                <span className="w-6 shrink-0 text-right tabular-nums font-semibold text-zinc-900">
                                  {item.hours}
                                </span>
                                <button
                                  type="button"
                                  disabled={status === "saving"}
                                  onClick={() =>
                                    removeAssignment(
                                      index,
                                      item.grade,
                                      item.name,
                                    )
                                  }
                                  className="shrink-0 text-zinc-400 hover:text-red-600 disabled:opacity-50"
                                  aria-label={`${item.name} 제거`}
                                >
                                  ×
                                </button>
                              </li>
                            );
                          });
                        })()}
                      </ul>
                    </AssignmentHoursPanel>

                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="text-xs text-zinc-500 hover:text-red-600"
                        aria-label={`${index + 1}행 삭제`}
                      >
                        삭제
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50"
          >
            행 추가
          </button>

          <button
            type="button"
            onClick={() => {
              void handleSaveTeachers();
            }}
            disabled={status === "saving"}
            className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "saving" ? "저장 중…" : "저장"}
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
            교과 목록
          </h2>
          <p className="mb-3 text-center text-xs text-zinc-500">
            배정 시수 / 필요 시수 · 드래그해 교과별 시수 칸에 놓으세요
          </p>
          <div className="flex flex-col gap-4">
            {GRADES.map((grade) => {
              const list = subjects[grade] ?? [];
              return (
                <div key={grade}>
                  <h3 className="mb-2 text-sm font-semibold text-zinc-800">
                    {grade}학년
                  </h3>
                  {list.length === 0 ? (
                    <p className="text-xs text-zinc-500">저장된 교과 없음</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {list.map((subject, index) => (
                        <DraggableSubjectBadge
                          key={`${grade}-${index}-${subject.name}`}
                          grade={grade}
                          subject={subject}
                          assignedHours={
                            hoursBySubject.get(`${grade}:${subject.name}`) ?? 0
                          }
                          requiredHours={requiredHoursForSubject(subject)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/subjects?step=2`)}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
        >
          이전
        </button>
        <span
          title={
            hoursComplete
              ? undefined
              : "모든 교과의 배정 시수가 필요 시수와 같아야 합니다."
          }
        >
          <button
            type="submit"
            disabled={status === "saving" || !hoursComplete}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "saving" ? "저장 중…" : "다음"}
          </button>
        </span>
      </div>

      {!hoursComplete ? (
        <p className="text-center text-xs text-zinc-500">
          교과 목록의 배정 시수와 필요 시수가 모두 일치해야 다음으로 진행할 수
          있습니다.
        </p>
      ) : null}

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

      {csvPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="csv-preview-title"
          onClick={() => setCsvPreview(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-zinc-100 px-4 py-3">
              <h3
                id="csv-preview-title"
                className="text-base font-semibold text-zinc-900"
              >
                CSV 미리보기
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                교사 {csvPreview.teachers.length}명
                {csvPreview.errors.length > 0
                  ? ` · 오류 ${csvPreview.errors.length}건`
                  : " · 오류 없음"}
              </p>
            </div>

            <div className="max-h-[55vh] overflow-auto px-4 py-3">
              {csvPreview.errors.length > 0 ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="mb-1 text-xs font-semibold text-red-700">
                    오류를 수정한 뒤 다시 올려 주세요.
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-red-700">
                    {csvPreview.errors.slice(0, 30).map((err, i) => (
                      <li key={`${err.row}-${i}`}>
                        {err.row > 0 ? `${err.row}행: ` : null}
                        {err.message}
                      </li>
                    ))}
                    {csvPreview.errors.length > 30 ? (
                      <li>…외 {csvPreview.errors.length - 30}건</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {csvPreview.teachers.length === 0 ? (
                <p className="text-sm text-zinc-500">불러온 교사가 없습니다.</p>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-600">
                      <th className="px-1 py-1.5 font-medium">교사명</th>
                      <th className="px-1 py-1.5 font-medium">1학년</th>
                      <th className="px-1 py-1.5 font-medium">2학년</th>
                      <th className="px-1 py-1.5 font-medium">3학년</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.teachers.map((t) => (
                      <tr
                        key={t.name}
                        className="border-b border-zinc-100 align-top"
                      >
                        <td className="px-1 py-1.5 font-medium text-zinc-900">
                          {t.name}
                        </td>
                        {GRADES.map((grade) => (
                          <td key={grade} className="px-1 py-1.5 text-zinc-700">
                            {(t.assignments[grade] ?? [])
                              .map((a) => `${a.name}:${a.hours}`)
                              .join(", ") || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={
                  csvPreview.errors.length > 0 ||
                  csvPreview.teachers.length === 0
                }
                onClick={applyCsvPreview}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
