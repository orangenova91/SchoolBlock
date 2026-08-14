"use client";

import {
  DEFAULT_SUBJECT_SET,
  MAX_SUBJECT_UNITS,
  MIN_SUBJECT_UNITS,
  createEmptySubject,
  type Grade,
  type Subject,
} from "@/lib/types";
import { nextSubjectSet, parseSubjectsFromClipboard, subjectSetBadgeClass } from "@/lib/subjects";

type SubjectGradeTableProps = {
  grade: Grade;
  subjects: Subject[];
  onChange: (subjects: Subject[]) => void;
};

export function SubjectGradeTable({
  grade,
  subjects,
  onChange,
}: SubjectGradeTableProps) {
  const rows = subjects.length > 0 ? subjects : [createEmptySubject()];

  function updateRow(index: number, patch: Partial<Subject>) {
    const base = subjects.length > 0 ? subjects : [createEmptySubject()];
    onChange(base.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function cycleSet(index: number) {
    const base = subjects.length > 0 ? subjects : [createEmptySubject()];
    const current = base[index]?.set ?? DEFAULT_SUBJECT_SET;
    const next = nextSubjectSet(current);
    if (next === DEFAULT_SUBJECT_SET) {
      updateRow(index, { set: next, classNo: undefined });
    } else {
      updateRow(index, {
        set: next,
        classCount: 1,
        classNo: undefined,
      });
    }
  }

  function addRow() {
    onChange([...(subjects.length > 0 ? subjects : []), createEmptySubject()]);
  }

  function removeRow(index: number) {
    const base = subjects.length > 0 ? subjects : [createEmptySubject()];
    if (base.length <= 1) {
      onChange([createEmptySubject()]);
      return;
    }
    onChange(base.filter((_, i) => i !== index));
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTableElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;

    const parsed = parseSubjectsFromClipboard(text);
    if (parsed.length === 0) return;

    event.preventDefault();
    onChange(parsed);
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-center text-base font-semibold text-zinc-900">
        {grade}학년
      </h2>

      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-sm"
          onPaste={handlePaste}
        >
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-600">
              <th className="w-14 px-1 py-2 text-center font-medium">set</th>
              <th className="px-2 py-2 font-medium">교과명</th>
              <th className="w-12 px-1 py-2 text-center font-medium">단위수</th>
              <th className="w-14 px-2 py-2 font-medium">
                <span className="sr-only">삭제</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-zinc-100">
                <td className="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => cycleSet(index)}
                    aria-label={`${grade}학년 set 변경, 현재 ${row.set ?? DEFAULT_SUBJECT_SET}`}
                    title="클릭하여 set 변경"
                    className={`min-w-[2.5rem] rounded-md border px-1.5 py-1.5 text-xs font-medium transition hover:opacity-90 ${subjectSetBadgeClass(row.set)}`}
                  >
                    {row.set ?? DEFAULT_SUBJECT_SET}
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    placeholder="예: 국어"
                    aria-label={`${grade}학년 교과명 ${index + 1}`}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <input
                    type="number"
                    min={MIN_SUBJECT_UNITS}
                    max={MAX_SUBJECT_UNITS}
                    value={row.units}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isInteger(n)) return;
                      if (n < MIN_SUBJECT_UNITS || n > MAX_SUBJECT_UNITS) return;
                      updateRow(index, { units: n });
                    }}
                    aria-label={`${grade}학년 단위수 ${index + 1}`}
                    className="w-full rounded-md border border-zinc-300 px-1 py-1.5 text-center text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-zinc-500 hover:text-red-600"
                    aria-label={`${grade}학년 ${index + 1}행 삭제`}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50"
      >
        행 추가
      </button>
    </section>
  );
}
