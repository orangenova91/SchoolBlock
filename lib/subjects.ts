import {
  DEFAULT_SUBJECT_CLASS_COUNT,
  DEFAULT_SUBJECT_SET,
  GRADES,
  MAX_SUBJECT_CLASS_COUNT,
  MAX_SUBJECT_UNITS,
  MIN_SUBJECT_CLASS_COUNT,
  MIN_SUBJECT_UNITS,
  SUBJECT_SETS,
  type Grade,
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

export function ensureGradeSubjects(
  value: Partial<Record<Grade | string, Subject[]>> | null | undefined,
): GradeSubjects {
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    const list = value?.[grade] ?? value?.[String(grade)] ?? [];
    next[grade] = (Array.isArray(list) ? list : []).map((s) => ({
      set: parseSubjectSet((s as Subject | undefined)?.set),
      name: typeof s?.name === "string" ? s.name : "",
      units:
        parsePositiveIntInRange(s?.units, MIN_SUBJECT_UNITS, MAX_SUBJECT_UNITS) ??
        MIN_SUBJECT_UNITS,
      classCount:
        parsePositiveIntInRange(
          s?.classCount,
          MIN_SUBJECT_CLASS_COUNT,
          MAX_SUBJECT_CLASS_COUNT,
        ) ?? DEFAULT_SUBJECT_CLASS_COUNT,
    }));
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
        const { name, units, classCount, set } = item as Record<
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
          // allow unknown sets to be coerced in ensure; only reject non-string non-undefined weird types
          if (typeof set !== "string") return null;
        }
      }
    }
  }

  return ensureGradeSubjects(value as GradeSubjects);
}

export function sanitizeGradeSubjects(subjects: GradeSubjects): GradeSubjects {
  const ensured = ensureGradeSubjects(subjects);
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    next[grade] = ensured[grade]
      .map((s) => ({
        set: parseSubjectSet(s.set),
        name: s.name.trim(),
        units: s.units,
        classCount: s.classCount,
      }))
      .filter((s) => s.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
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

/** Paste a single column of class counts onto existing subject rows (by order). */
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

  return subjects.map((row, index) =>
    index < values.length ? { ...row, classCount: values[index] } : row,
  );
}
