import {
  DEFAULT_SUBJECT_CLASS_COUNT,
  DEFAULT_SUBJECT_SET,
  ELECTIVE_SETS,
  GRADES,
  MAX_SUBJECT_CLASS_COUNT,
  MAX_SUBJECT_UNITS,
  MIN_SUBJECT_CLASS_COUNT,
  MIN_SUBJECT_UNITS,
  SUBJECT_SETS,
  type ElectiveSet,
  type Grade,
  type GradeClassCounts,
  type GradeSubjects,
  type Subject,
  type SubjectSet,
} from "@/lib/types";

const HEADER_NAMES = new Set(["교과명", "과목명", "과목", "교과", "수업명", "name"]);

function parsePositiveIntInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function parseSubjectSet(value: unknown): SubjectSet {
  if (typeof value === "string" && (SUBJECT_SETS as string[]).includes(value)) {
    return value as SubjectSet;
  }
  return DEFAULT_SUBJECT_SET;
}

export function isElectiveSubjectSet(
  set: SubjectSet | string | undefined,
): set is ElectiveSet {
  return parseSubjectSet(set) !== DEFAULT_SUBJECT_SET;
}

export function nextSubjectSet(current: SubjectSet): SubjectSet {
  const index = SUBJECT_SETS.indexOf(current);
  const safeIndex = index >= 0 ? index : 0;
  return SUBJECT_SETS[(safeIndex + 1) % SUBJECT_SETS.length];
}

/** Badge / button colors per subject set (A–I distinct). */
export function subjectSetBadgeClass(set: SubjectSet | string | undefined): string {
  switch (parseSubjectSet(set)) {
    case "A":
      return "border-rose-300 bg-rose-50 text-rose-800";
    case "B":
      return "border-orange-300 bg-orange-50 text-orange-800";
    case "C":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "D":
      return "border-lime-300 bg-lime-50 text-lime-900";
    case "E":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "F":
      return "border-teal-300 bg-teal-50 text-teal-800";
    case "G":
      return "border-sky-300 bg-sky-50 text-sky-800";
    case "H":
      return "border-indigo-300 bg-indigo-50 text-indigo-800";
    case "I":
      return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800";
    case "공통":
    default:
      return "border-zinc-400 bg-zinc-100 text-zinc-700";
  }
}

function parseClassNo(value: unknown, maxClass: number): number | undefined {
  const n = parsePositiveIntInRange(value, 1, Math.max(1, maxClass));
  return n ?? undefined;
}

/** +α slot for partial SET (one overflow section beyond home rooms). */
export function alphaClassNo(gradeClassCount: number): number {
  return gradeClassCount + 1;
}

export function isAlphaClassNo(
  classNo: number,
  gradeClassCount: number,
): boolean {
  return classNo === alphaClassNo(gradeClassCount);
}

export function classNoLabel(classNo: number, gradeClassCount: number): string {
  if (isAlphaClassNo(classNo, gradeClassCount)) return "+α";
  return `${classNo}반`;
}

/** Partial SET dropdown values: 1…N then +α (N+1). */
export function partialClassNoOptions(gradeClassCount: number): number[] {
  return Array.from({ length: gradeClassCount + 1 }, (_, i) => i + 1);
}

/** Normalize one subject: SET → classCount 1; 공통 → no classNo. */
export function normalizeSubject(
  raw: Partial<Subject> | null | undefined,
  maxClass = MAX_SUBJECT_CLASS_COUNT,
): Subject {
  const set = parseSubjectSet(raw?.set);
  const name = typeof raw?.name === "string" ? raw.name : "";
  const units =
    parsePositiveIntInRange(raw?.units, MIN_SUBJECT_UNITS, MAX_SUBJECT_UNITS) ??
    MIN_SUBJECT_UNITS;

  if (isElectiveSubjectSet(set)) {
    // Allow +α (= home rooms + 1) when maxClass is grade class count.
    const electiveMax = Math.min(MAX_SUBJECT_CLASS_COUNT, maxClass + 1);
    return {
      set,
      name,
      units,
      classCount: DEFAULT_SUBJECT_CLASS_COUNT,
      classNo: parseClassNo(raw?.classNo, electiveMax),
    };
  }

  return {
    set,
    name,
    units,
    classCount:
      parsePositiveIntInRange(
        raw?.classCount,
        MIN_SUBJECT_CLASS_COUNT,
        MAX_SUBJECT_CLASS_COUNT,
      ) ?? DEFAULT_SUBJECT_CLASS_COUNT,
  };
}

export function ensureGradeSubjects(
  value: Partial<Record<Grade | string, Subject[]>> | null | undefined,
  classCounts?: GradeClassCounts,
): GradeSubjects {
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    const list = value?.[grade] ?? value?.[String(grade)] ?? [];
    const maxClass = classCounts?.[grade] ?? MAX_SUBJECT_CLASS_COUNT;
    next[grade] = (Array.isArray(list) ? list : []).map((s) =>
      normalizeSubject(s, maxClass),
    );
  }
  return next;
}

export function parseSubjectsFromClipboard(text: string): Subject[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const subjects: Subject[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split("\t").map((c) => c.trim());
    if (cols.length === 0) continue;

    const name = cols[0] ?? "";
    const unitsRaw = cols[1] ?? "";
    const classCountRaw = cols[2] ?? "";

    if (i === 0 && HEADER_NAMES.has(name.toLowerCase())) {
      continue;
    }

    if (!name) continue;

    const units = parsePositiveIntInRange(
      unitsRaw,
      MIN_SUBJECT_UNITS,
      MAX_SUBJECT_UNITS,
    );
    if (units === null) continue;

    const classCount =
      parsePositiveIntInRange(
        classCountRaw,
        MIN_SUBJECT_CLASS_COUNT,
        MAX_SUBJECT_CLASS_COUNT,
      ) ?? DEFAULT_SUBJECT_CLASS_COUNT;

    subjects.push({
      set: DEFAULT_SUBJECT_SET,
      name,
      units,
      classCount,
    });
  }

  return subjects;
}

export function parseGradeSubjects(value: unknown): GradeSubjects | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  for (const grade of GRADES) {
    const raw = record[grade] ?? record[String(grade)];
    if (raw !== undefined && !Array.isArray(raw)) return null;

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== "object") return null;
        const { name, units, classCount, set, classNo } = item as Record<
          string,
          unknown
        >;
        if (typeof name !== "string") return null;
        if (
          parsePositiveIntInRange(units, MIN_SUBJECT_UNITS, MAX_SUBJECT_UNITS) ===
          null
        ) {
          return null;
        }
        if (
          classCount !== undefined &&
          parsePositiveIntInRange(
            classCount,
            MIN_SUBJECT_CLASS_COUNT,
            MAX_SUBJECT_CLASS_COUNT,
          ) === null
        ) {
          return null;
        }
        if (set !== undefined && parseSubjectSet(set) !== set) {
          if (typeof set !== "string") return null;
        }
        if (
          classNo !== undefined &&
          classNo !== null &&
          parsePositiveIntInRange(classNo, 1, MAX_SUBJECT_CLASS_COUNT) === null
        ) {
          return null;
        }
      }
    }
  }

  return ensureGradeSubjects(value as GradeSubjects);
}

export function sanitizeGradeSubjects(
  subjects: GradeSubjects,
  classCounts?: GradeClassCounts,
): GradeSubjects {
  const ensured = ensureGradeSubjects(subjects, classCounts);
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    const maxClass = classCounts?.[grade] ?? MAX_SUBJECT_CLASS_COUNT;
    next[grade] = ensured[grade]
      .map((s) => normalizeSubject(s, maxClass))
      .map((s) => {
        if (!isElectiveSubjectSet(s.set)) {
          return {
            set: s.set,
            name: s.name.trim(),
            units: s.units,
            classCount: s.classCount,
          };
        }
        const electiveMax = Math.min(MAX_SUBJECT_CLASS_COUNT, maxClass + 1);
        const classNo =
          s.classNo !== undefined &&
          s.classNo >= 1 &&
          s.classNo <= electiveMax
            ? s.classNo
            : undefined;
        return {
          set: s.set,
          name: s.name.trim(),
          units: s.units,
          classCount: DEFAULT_SUBJECT_CLASS_COUNT,
          ...(classNo !== undefined ? { classNo } : {}),
        };
      })
      .filter((s) => s.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return next;
}

export type SetClassKind = "whole" | "partial" | "overflow";

export function setClassKind(
  subjects: Subject[],
  set: ElectiveSet,
  gradeClassCount: number,
): SetClassKind | null {
  const count = subjects.filter((s) => s.set === set).length;
  if (count === 0) return null;
  if (count === gradeClassCount) return "whole";
  if (count < gradeClassCount) return "partial";
  return "overflow";
}

/** Classes already taken by other subjects in the same SET (excluding index). */
export function usedClassNosInSet(
  subjects: Subject[],
  set: ElectiveSet,
  excludeIndex?: number,
): Set<number> {
  const used = new Set<number>();
  subjects.forEach((row, index) => {
    if (excludeIndex !== undefined && index === excludeIndex) return;
    if (row.set !== set) return;
    if (typeof row.classNo === "number") used.add(row.classNo);
  });
  return used;
}

export function validateSetClassAssignments(
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): string | null {
  for (const grade of GRADES) {
    const rows = subjects[grade] ?? [];
    const gradeClassCount = classCounts[grade];

    for (const set of ELECTIVE_SETS) {
      const kind = setClassKind(rows, set, gradeClassCount);
      if (!kind) continue;

      if (kind === "overflow") {
        const count = rows.filter((s) => s.set === set).length;
        return `${grade}학년 SET ${set} 과목 수(${count})가 학급 수(${gradeClassCount})보다 많습니다. 분반마다 한 줄로 맞추거나 학급 수를 확인해 주세요.`;
      }

      if (kind === "partial") {
        const setRows = rows
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => row.set === set);
        const maxNo = alphaClassNo(gradeClassCount);
        const seen = new Set<number>();
        for (const { row } of setRows) {
          if (row.classNo === undefined) {
            return `${grade}학년 SET ${set}의 "${row.name}"에 학반(또는 +α)을 지정해 주세요.`;
          }
          if (row.classNo < 1 || row.classNo > maxNo) {
            return `${grade}학년 SET ${set}의 "${row.name}" 학반 번호가 올바르지 않습니다.`;
          }
          if (seen.has(row.classNo)) {
            const label = classNoLabel(row.classNo, gradeClassCount);
            return `${grade}학년 SET ${set}에서 ${label}이(가) 중복 지정되었습니다.`;
          }
          seen.add(row.classNo);
        }
      }
    }
  }
  return null;
}

/**
 * Drop classNo on whole-grade SET rows; keep only for partial SET.
 * Call when grade class counts are known (step 2 save / next).
 */
export function alignSetClassNos(
  subjects: GradeSubjects,
  classCounts: GradeClassCounts,
): GradeSubjects {
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    const gradeClassCount = classCounts[grade];
    next[grade] = (subjects[grade] ?? []).map((row) => {
      if (!isElectiveSubjectSet(row.set)) {
        const { classNo: _drop, ...rest } = row;
        void _drop;
        return rest;
      }
      const kind = setClassKind(subjects[grade], row.set, gradeClassCount);
      if (kind !== "partial") {
        return {
          set: row.set,
          name: row.name,
          units: row.units,
          classCount: DEFAULT_SUBJECT_CLASS_COUNT,
        };
      }
      const maxNo = alphaClassNo(gradeClassCount);
      const classNo =
        row.classNo !== undefined &&
        row.classNo >= 1 &&
        row.classNo <= maxNo
          ? row.classNo
          : undefined;
      return {
        set: row.set,
        name: row.name,
        units: row.units,
        classCount: DEFAULT_SUBJECT_CLASS_COUNT,
        ...(classNo !== undefined ? { classNo } : {}),
      };
    });
  }
  return next;
}

const CLASS_COUNT_HEADERS = new Set([
  "수업 학반 수",
  "수업학반수",
  "학반수",
  "학반 수",
  "classcount",
  "class count",
]);

/** Paste a single column of class counts onto existing subject rows (by order). SET rows stay at 1. */
export function applyClassCountsFromClipboard(
  subjects: Subject[],
  text: string,
): Subject[] | null {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return null;

  const values: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = (lines[i].split("\t")[0] ?? "").trim();
    if (i === 0 && CLASS_COUNT_HEADERS.has(first.toLowerCase())) continue;

    const n = parsePositiveIntInRange(
      first,
      MIN_SUBJECT_CLASS_COUNT,
      MAX_SUBJECT_CLASS_COUNT,
    );
    if (n === null) return null;
    values.push(n);
  }

  if (values.length === 0) return null;

  return subjects.map((row, index) => {
    if (isElectiveSubjectSet(row.set)) {
      return { ...row, classCount: DEFAULT_SUBJECT_CLASS_COUNT };
    }
    return index < values.length ? { ...row, classCount: values[index] } : row;
  });
}
