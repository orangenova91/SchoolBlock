import {
  DEFAULT_SUBJECT_CLASS_COUNT,
  GRADES,
  MAX_SUBJECT_CLASS_COUNT,
  MAX_SUBJECT_UNITS,
  MIN_SUBJECT_CLASS_COUNT,
  MIN_SUBJECT_UNITS,
  type Grade,
  type GradeSubjects,
  type Subject,
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

export function ensureGradeSubjects(
  value: Partial<Record<Grade | string, Subject[]>> | null | undefined,
): GradeSubjects {
  const next = {} as GradeSubjects;
  for (const grade of GRADES) {
    const list = value?.[grade] ?? value?.[String(grade)] ?? [];
    next[grade] = (Array.isArray(list) ? list : []).map((s) => ({
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

    subjects.push({ name, units, classCount });
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
        const { name, units, classCount } = item as Record<string, unknown>;
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
        name: s.name.trim(),
        units: s.units,
        classCount: s.classCount,
      }))
      .filter((s) => s.name.length > 0);
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
