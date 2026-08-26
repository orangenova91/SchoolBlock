"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SetBlockGrid } from "@/components/set-block-grid";
import {
  assignedTeacherAt,
  blockedSlotsForSet,
  catalogGradeSets,
  catalogHasInvalidSets,
  classCapacityIssues,
  countPlaced,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  findGradeSet,
  partialLockedSlots,
  recommendSubjectRotations,
  removeCell,
  setTeacherShares,
  slotKey,
  slotsForGradeSet,
  subjectsNeedingRotation,
  tryPaintCell,
  wholeSetsPlacementComplete,
  type GradeSetInfo,
  type SetTeacherShare,
} from "@/lib/set-blocks";
import {
  ensureGradeSubjects,
  sanitizeGradeSubjects,
  subjectSetBadgeClass,
} from "@/lib/subjects";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import {
  GRADES,
  WEEKDAYS,
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type Semester,
  type SetBlockCell,
  type SetTeacherAssignment,
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

type SetBlocksFormProps = {
  termId: string;
};

function kindLabel(kind: GradeSetInfo["kind"]): string {
  if (kind === "whole") return "전학년";
  if (kind === "partial") return "부분 · 다음 단계";
  return "단위 불일치";
}

export function SetBlocksForm({ termId }: SetBlocksFormProps) {
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
  const [cells, setCells] = useState<SetBlockCell[]>([]);
  const [partialCells, setPartialCells] = useState<SetBlockCell[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<
    SetTeacherAssignment[]
  >([]);
  const [selectedSet, setSelectedSet] = useState<ElectiveSet | null>(null);
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
        const [blocksRes, teachersRes, subjectsRes, scheduleRes] =
          await Promise.all([
            fetch(`/api/terms/${termId}/set-blocks`),
            fetch(`/api/terms/${termId}/teachers`),
            fetch(`/api/terms/${termId}/subjects`),
            fetch(`/api/terms/${termId}/day-schedule`),
          ]);

        const blocksData = (await blocksRes.json()) as {
          term?: TermSummary;
          cells?: SetBlockCell[];
          partialCells?: SetBlockCell[];
          teacherAssignments?: SetTeacherAssignment[];
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

        if (!blocksRes.ok) {
          if (!cancelled) {
            setStatus("error");
            setMessage(blocksData.error ?? "SET 블록을 불러오지 못했습니다.");
          }
          return;
        }

        if (!cancelled) {
          const loadedSubjects = subjectsRes.ok
            ? sanitizeGradeSubjects(
                ensureGradeSubjects(
                  subjectsData.subjects ?? createDefaultGradeSubjects(),
                ),
              )
            : createDefaultGradeSubjects();
          const loadedSchedules = scheduleRes.ok
            ? (scheduleData.grades ?? createDefaultGradeDaySchedules())
            : createDefaultGradeDaySchedules();
          const loadedClassCounts = scheduleRes.ok
            ? (scheduleData.classCounts ?? createDefaultClassCounts())
            : createDefaultClassCounts();
          const loadedTeachers = teachersRes.ok
            ? sanitizeTeachers(
                ensureTeachers(teachersData.teachers ?? createDefaultTeachers()),
              )
            : createDefaultTeachers();
          const catalog = catalogGradeSets(loadedSubjects, loadedClassCounts);

          setTerm(blocksData.term ?? null);
          setSubjects(loadedSubjects);
          setSchedules(loadedSchedules);
          setClassCounts(loadedClassCounts);
          setTeachers(loadedTeachers);
          setCells(
            filterCellsToCatalog(
              Array.isArray(blocksData.cells) ? blocksData.cells : [],
              loadedSchedules,
              catalog,
            ),
          );
          setPartialCells(
            filterPartialCellsToCatalog(
              Array.isArray(blocksData.partialCells)
                ? blocksData.partialCells
                : [],
              loadedSchedules,
              catalog,
            ),
          );
          setTeacherAssignments(
            Array.isArray(blocksData.teacherAssignments)
              ? blocksData.teacherAssignments
              : [],
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

  const catalog = useMemo(
    () => catalogGradeSets(subjects, classCounts),
    [subjects, classCounts],
  );

  const capacityIssues = useMemo(
    () =>
      classCapacityIssues(
        teachers,
        subjects,
        classCounts,
        schedules,
        catalog,
      ),
    [teachers, subjects, classCounts, schedules, catalog],
  );

  const invalidSets = catalogHasInvalidSets(catalog);
  const placementComplete = wholeSetsPlacementComplete(cells, catalog);
  const canProceed =
    capacityIssues.length === 0 && !invalidSets && placementComplete;

  const blockedByGrade = useMemo(() => {
    const next = {} as Record<Grade, Map<string, string[]>>;
    for (const grade of GRADES) {
      next[grade] = selectedSet
        ? blockedSlotsForSet(
            cells,
            partialCells,
            teachers,
            catalog,
            schedules,
            grade,
            selectedSet,
          )
        : new Map();
    }
    return next;
  }, [cells, partialCells, teachers, catalog, schedules, selectedSet]);

  const placedByGrade = useMemo(() => {
    const next = {} as Record<Grade, Map<string, ElectiveSet>>;
    for (const grade of GRADES) {
      const map = new Map<string, ElectiveSet>();
      for (const cell of cells) {
        if (cell.grade === grade) map.set(slotKey(cell.day, cell.period), cell.set);
      }
      next[grade] = map;
    }
    return next;
  }, [cells]);

  const partialLockedByGrade = useMemo(() => {
    const next = {} as Record<Grade, Map<string, ElectiveSet[]>>;
    for (const grade of GRADES) {
      next[grade] = partialLockedSlots(partialCells, schedules, grade);
    }
    return next;
  }, [partialCells, schedules]);

  const selectedInfo = useMemo(() => {
    if (!selectedSet) return null;
    return catalog.filter((item) => item.set === selectedSet);
  }, [catalog, selectedSet]);

  function paint(grade: Grade, day: Weekday, period: number) {
    if (!selectedSet || status === "saving") return;
    const result = tryPaintCell({
      cells,
      partialCells,
      catalog,
      teachers,
      schedules,
      grade,
      set: selectedSet,
      day,
      period,
    });
    if (result.error) {
      setStatus("error");
      setMessage(result.error);
      return;
    }
    setCells(result.cells);
    setStatus("idle");
    setMessage("");
  }

  function erase(grade: Grade, day: Weekday, period: number) {
    if (status === "saving") return;
    setCells(removeCell(cells, grade, day, period));
    setStatus("idle");
    setMessage("");
  }

  function applyRotation(entries: SetTeacherAssignment[]) {
    if (entries.length === 0 || status === "saving") return;
    setTeacherAssignments((prev) => {
      const keep = prev.filter(
        (a) =>
          !entries.some(
            (e) =>
              e.grade === a.grade &&
              e.set === a.set &&
              e.day === a.day &&
              e.period === a.period &&
              e.subjectName === a.subjectName,
          ),
      );
      return [...keep, ...entries];
    });
    setStatus("idle");
    setMessage("담당 교사 조합을 적용했습니다. 저장을 눌러 반영해 주세요.");
  }

  function resetCells() {
    if (status === "saving" || cells.length === 0) return;
    const confirmed = window.confirm(
      "배치한 전학년 SET 블록을 모두 초기화할까요? 저장을 눌러야 적용됩니다.",
    );
    if (!confirmed) return;
    setCells([]);
    setStatus("idle");
    setMessage("전학년 SET 블록을 초기화했습니다. 저장을 눌러 반영해 주세요.");
  }

  async function saveCells(successMessage: string, requireComplete: boolean) {
    if (requireComplete && !canProceed) {
      setStatus("error");
      if (capacityIssues.length > 0) {
        const first = capacityIssues[0];
        setMessage(
          `학반 시수가 부족합니다. 예: ${first.grade}학년 ${first.classNo}반 공통 ${first.commonHours} + SET ${first.setHours} > ${first.weekdaySum}`,
        );
      } else if (invalidSets) {
        setMessage("같은 SET 안 과목의 단위가 서로 다릅니다. 교과 설정을 확인해 주세요.");
      } else {
        setMessage("전학년 SET를 필요 교시만큼 모두 배치해 주세요.");
      }
      return false;
    }

    setStatus("saving");
    setMessage("");

    const nextCells = filterCellsToCatalog(cells, schedules, catalog);

    try {
      const response = await fetch(`/api/terms/${termId}/set-blocks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: nextCells, teacherAssignments }),
      });
      const data = (await response.json()) as {
        cells?: SetBlockCell[];
        teacherAssignments?: SetTeacherAssignment[];
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return false;
      }

      setCells(
        filterCellsToCatalog(data.cells ?? nextCells, schedules, catalog),
      );
      setTeacherAssignments(
        Array.isArray(data.teacherAssignments)
          ? data.teacherAssignments
          : teacherAssignments,
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
    await saveCells("SET 블록이 저장되었습니다.", false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await saveCells("SET 블록이 저장되었습니다.", true);
    if (ok) router.push(`/terms/${termId}/sets/partial`);
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
          SET 블록 배치(1/2)
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          전학년 SET를 요일·교시에 배치하세요. 이미 부분 SET가 배치된 칸은
          잠겨 있고, 다른 학년의 전학년·부분 SET와 교사가 겹치는 시간은
          자동으로 막힙니다. 다음에서 부분 SET를 배치합니다.
        </p>
      </header>

      {term ? (
        <p className="text-center text-sm text-zinc-600">
          {term.timetableName ? `${term.timetableName} · ` : null}
          {term.school} · {term.academicYear}학년도 · {term.semester}학기
        </p>
      ) : null}

      {capacityIssues.length > 0 ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <p className="font-medium">
            공통 시수와 전학년 SET 시수가 주간 교시를 넘는 학반이 있습니다. 교사
            배정을 수정한 뒤 다시 와 주세요.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
            {capacityIssues.map((issue) => (
              <li key={`${issue.grade}-${issue.classNo}`}>
                {issue.grade}학년 {issue.classNo}반: 공통 {issue.commonHours} +
                SET {issue.setHours} = {issue.commonHours + issue.setHours}{" "}
                &gt; 주간 {issue.weekdaySum}교시
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-6">
        {GRADES.map((grade) => {
          const gradeSets = catalog.filter((item) => item.grade === grade);
          const wholes = gradeSets.filter((item) => item.kind === "whole");

          return (
            <section
              key={grade}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
                {grade}학년
              </h2>

              {gradeSets.length === 0 ? (
                <p className="text-center text-sm text-zinc-500">
                  SET 교과 없음
                </p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap justify-center gap-2">
                    {gradeSets.map((item) => {
                      const placed =
                        item.units !== null
                          ? countPlaced(cells, grade, item.set)
                          : 0;
                      const clickable = item.kind === "whole";
                      const selected = selectedSet === item.set;
                      return (
                        <button
                          key={`${grade}-${item.set}`}
                          type="button"
                          disabled={!clickable || status === "saving"}
                          onClick={() =>
                            setSelectedSet((prev) =>
                              prev === item.set ? null : item.set,
                            )
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${subjectSetBadgeClass(item.set)} ${
                            selected ? "ring-2 ring-zinc-700" : ""
                          }`}
                          title={
                            clickable
                              ? `${item.set}세트 선택`
                              : kindLabel(item.kind)
                          }
                        >
                          {item.set} {placed}/{item.units ?? "?"} ·{" "}
                          {kindLabel(item.kind)}
                        </button>
                      );
                    })}
                  </div>

                  {wholes.length === 0 ? (
                    <p className="mb-3 text-center text-xs text-zinc-500">
                      이 학년의 전학년 SET가 없습니다.
                    </p>
                  ) : null}

                  <SetBlockGrid
                    grade={grade}
                    periods={schedules[grade]}
                    placed={placedByGrade[grade]}
                    partialLocked={partialLockedByGrade[grade]}
                    selectedSet={
                      selectedSet &&
                      findGradeSet(catalog, grade, selectedSet)?.kind ===
                        "whole"
                        ? selectedSet
                        : null
                    }
                    blocked={blockedByGrade[grade]}
                    disabled={status === "saving"}
                    onPaint={(day, period) => paint(grade, day, period)}
                    onErase={(day, period) => erase(grade, day, period)}
                    onSelectPlacedSet={setSelectedSet}
                  />

                  {selectedSet &&
                  findGradeSet(catalog, grade, selectedSet)?.kind ===
                    "whole" ? (
                    <SetShareList
                      teachers={teachers}
                      info={findGradeSet(catalog, grade, selectedSet)}
                      catalog={catalog}
                      wholeCells={cells}
                      partialCells={partialCells}
                      assignments={teacherAssignments}
                      onApplyRotation={applyRotation}
                      disabled={status === "saving"}
                    />
                  ) : null}
                </>
              )}
            </section>
          );
        })}
      </div>

      {selectedInfo && selectedInfo.length > 0 ? (
        <p className="text-center text-xs text-zinc-500">
          선택한 SET {selectedSet}: 빈 칸을 누르거나 끌어 배치하고, 같은 색 칸을
          다시 누르면 지워집니다.
        </p>
      ) : (
        <p className="text-center text-xs text-zinc-500">
          전학년 SET 배지를 선택한 뒤 칸을 칠하세요.
        </p>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(`/terms/${termId}/teachers`)}
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
        <span
          title={
            canProceed
              ? undefined
              : capacityIssues.length > 0
                ? "학반 시수가 주간 교시를 넘습니다."
                : invalidSets
                  ? "SET 단위가 일치하지 않습니다."
                  : "전학년 SET를 필요 교시만큼 배치해 주세요."
          }
        >
          <button
            type="submit"
            disabled={status === "saving" || !canProceed}
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

function SetShareList({
  teachers,
  info,
  catalog,
  wholeCells,
  partialCells,
  assignments,
  onApplyRotation,
  disabled,
}: {
  teachers: Teacher[];
  info: GradeSetInfo | undefined;
  catalog: GradeSetInfo[];
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  assignments: SetTeacherAssignment[];
  onApplyRotation: (entries: SetTeacherAssignment[]) => void;
  disabled: boolean;
}) {
  if (!info) return null;
  const shares = setTeacherShares(teachers, info);
  if (shares.length === 0) {
    return (
      <p className="mt-3 text-center text-xs text-zinc-500">
        SET {info.set} 담당 교사가 없습니다.
      </p>
    );
  }

  const rotations = subjectsNeedingRotation(teachers, info);
  const slots = slotsForGradeSet(wholeCells, partialCells, info.grade, info.set);
  const placementComplete = info.units !== null && slots.length === info.units;

  return (
    <div className="mt-3 flex flex-col items-center gap-3">
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
        {shares.map((share) => (
          <li key={`${share.teacherName}-${share.subjectName}`}>
            {share.subjectName} · {share.teacherName} {share.hours}
          </li>
        ))}
      </ul>

      {placementComplete
        ? rotations.map((rotation) => (
            <RotationRecommendation
              key={rotation.subjectName}
              teachers={teachers}
              catalog={catalog}
              wholeCells={wholeCells}
              partialCells={partialCells}
              assignments={assignments}
              grade={info.grade}
              set={info.set}
              subjectName={rotation.subjectName}
              shares={rotation.shares}
              slots={slots}
              onApply={onApplyRotation}
              disabled={disabled}
            />
          ))
        : rotations.length > 0
          ? (
              <p className="max-w-md text-center text-[11px] text-amber-700">
                {info.set}세트를 {info.units}교시 모두 배치하면, 여러 교사가
                나눠 담당하는 과목의 교시별 담당자를 추천받을 수 있습니다.
              </p>
            )
          : null}
    </div>
  );
}

function RotationRecommendation({
  teachers,
  catalog,
  wholeCells,
  partialCells,
  assignments,
  grade,
  set,
  subjectName,
  shares,
  slots,
  onApply,
  disabled,
}: {
  teachers: Teacher[];
  catalog: GradeSetInfo[];
  wholeCells: SetBlockCell[];
  partialCells: SetBlockCell[];
  assignments: SetTeacherAssignment[];
  grade: Grade;
  set: ElectiveSet;
  subjectName: string;
  shares: SetTeacherShare[];
  slots: { day: Weekday; period: number }[];
  onApply: (entries: SetTeacherAssignment[]) => void;
  disabled: boolean;
}) {
  const dayLabel = (day: Weekday) =>
    WEEKDAYS.find((d) => d.key === day)?.label ?? day;
  const slotLabel = (slot: { day: Weekday; period: number }) =>
    `${dayLabel(slot.day)}${slot.period}`;

  const current = slots.map((slot) =>
    assignedTeacherAt(
      assignments,
      grade,
      set,
      slot.day,
      slot.period,
      subjectName,
    ),
  );
  const resolvedCount = current.filter(Boolean).length;

  const combos = useMemo(
    () =>
      recommendSubjectRotations({
        teachers,
        catalog,
        wholeCells,
        partialCells,
        assignments,
        grade,
        set,
        shares,
        slots,
        limit: 5,
      }),
    [teachers, catalog, wholeCells, partialCells, assignments, grade, set, shares, slots],
  );

  return (
    <div className="w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-[11px] text-amber-900">
      <p className="font-medium">
        &quot;{subjectName}&quot;은 여러 교사가 나눠 담당합니다 (
        {resolvedCount}/{slots.length}교시 지정됨)
      </p>
      <ul className="mt-1 space-y-0.5">
        {slots.map((slot, i) => (
          <li key={slotLabel(slot)}>
            {slotLabel(slot)}교시: {current[i] ?? "미지정 (전원 배제로 처리)"}
          </li>
        ))}
      </ul>

      {combos.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium">추천 조합 (겹칠 수 있는 여지가 큰 순)</p>
          <ul className="mt-1 space-y-1">
            {combos.map((combo, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onApply(
                      slots.map((slot, i) => ({
                        grade,
                        set,
                        day: slot.day,
                        period: slot.period,
                        subjectName,
                        teacherName: combo.teacherNames[i],
                      })),
                    )
                  }
                  className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-left transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {slots
                    .map(
                      (slot, i) =>
                        `${slotLabel(slot)}:${combo.teacherNames[i]}`,
                    )
                    .join(" · ")}
                  <span className="ml-2 text-amber-600">
                    점수 {combo.score}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-amber-700">
          현재 배치된 슬롯 조합에서는 추천할 조합이 없습니다.
        </p>
      )}
    </div>
  );
}
