import {
  DEFAULT_ASSIGNMENT_HOURS,
  DEFAULT_SUBJECT_SET,
  GRADES,
  MAX_ASSIGNMENT_HOURS,
  MAX_CELL_HOURS,
  MIN_ASSIGNMENT_HOURS,
  MIN_CELL_HOURS,
  createDefaultTeachers,
  createEmptyTeacher,
  createEmptyTeacherAssignments,
  type AssignmentItem,
  type Grade,
  type GradeClassCounts,
  type GradeSubjects,
  type Subject,
  type Teacher,
  type TeacherAssignments,
} from "@/lib/types";

const HEADER_NAMES = new Set([
  "교사명",
  "선생님",
  "성명",
  "이름",
  "교사",
  "name",
  "teacher",
]);

function clampTotalHours(value: unknown, fallback = DEFAULT_ASSIGNMENT_HOURS): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < 0) return 0;
  if (rounded > MAX_ASSIGNMENT_HOURS) return MAX_ASSIGNMENT_HOURS;
  return rounded;
}

export function clampCellHours(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(n)) return MIN_CELL_HOURS;
  const rounded = Math.round(n);
  if (rounded < MIN_CELL_HOURS) return MIN_CELL_HOURS;
  if (rounded > MAX_CELL_HOURS) return MAX_CELL_HOURS;
  return rounded;
}

export function sumClassHours(classHours: number[]): number {
  return classHours.reduce((sum, h) => sum + h, 0);
}

export function cycleCellHours(current: number): number {
  const next = clampCellHours(current) + 1;
  return next > MAX_CELL_HOURS ? MIN_CELL_HOURS : next;
}

export function isSetSubject(subject: Subject | undefined): boolean {
  return Boolean(subject && subject.set !== DEFAULT_SUBJECT_SET);
}

export function targetClassHourLength(
  subject: Subject | undefined,
  gradeClassCount?: number,
): number {
  if (isSetSubject(subject)) return 1;
  // 공통: 학년 전체 학반 수 (학반 설정). fallback to subject.classCount then 1
  const fromGrade =
    typeof gradeClassCount === "number" && Number.isFinite(gradeClassCount)
      ? Math.max(1, Math.round(gradeClassCount))
      : null;
  if (fromGrade !== null) return fromGrade;
  if (subject) return Math.max(1, subject.classCount);
  return 1;
}

export function syncAssignmentItem(
  name: string,
  classHours: number[],
): AssignmentItem {
  const cells = classHours.map(clampCellHours);
  const hours = clampTotalHours(sumClassHours(cells), 0);
  return { name, classHours: cells, hours };
}

export function alignAssignmentToSubject(
  item: AssignmentItem,
  subject: Subject | undefined,
  gradeClassCount?: number,
): AssignmentItem {
  const len = targetClassHourLength(subject, gradeClassCount);
  const prev =
    Array.isArray(item.classHours) && item.classHours.length > 0
      ? item.classHours.map(clampCellHours)
      : [clampCellHours(item.hours)];

  if (isSetSubject(subject)) {
    const collapsed = clampCellHours(sumClassHours(prev));
    return syncAssignmentItem(item.name, [collapsed]);
  }

  const next = Array.from({ length: len }, (_, i) => prev[i] ?? MIN_CELL_HOURS);
  // Legacy single total → put on first cell when expanding
  if (
    prev.length === 1 &&
    len > 1 &&
    prev[0] > 0 &&
    next.slice(1).every((h) => h === 0)
  ) {
    next[0] = clampCellHours(prev[0]);
  }
  return syncAssignmentItem(item.name, next);
}

function parseClassHoursFromRaw(item: unknown, fallbackHours: number): number[] {
  if (item && typeof item === "object" && Array.isArray((item as { classHours?: unknown }).classHours)) {
    const raw = (item as { classHours: unknown[] }).classHours;
    if (raw.length > 0) return raw.map(clampCellHours);
  }
  return [clampCellHours(fallbackHours)];
}

function ensureAssignments(
  value: Partial<TeacherAssignments> | null | undefined,
): TeacherAssignments {
  const next = createEmptyTeacherAssignments();
  for (const grade of GRADES) {
    const raw = value?.[grade] ?? value?.[String(grade) as unknown as Grade];
    if (!Array.isArray(raw)) {
      next[grade] = [];
      continue;
    }
    const rawUnknown = raw as unknown[];
    const seen = new Set<string>();
    const list: AssignmentItem[] = [];
    for (const item of rawUnknown) {
      const name =
        typeof item === "string"
          ? item.trim()
          : item &&
              typeof item === "object" &&
              typeof (item as { name?: unknown }).name === "string"
            ? (item as { name: string }).name.trim()
            : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const legacyHours =
        typeof item === "object" && item
          ? clampTotalHours((item as { hours?: unknown }).hours, DEFAULT_ASSIGNMENT_HOURS)
          : DEFAULT_ASSIGNMENT_HOURS;
      const classHours = parseClassHoursFromRaw(item, legacyHours);
      list.push(syncAssignmentItem(name, classHours));
    }
    next[grade] = list;
  }
  return next;
}

export function assignmentNames(items: AssignmentItem[]): string[] {
  return items.map((item) => item.name);
}

export function sumAssignmentHours(items: AssignmentItem[]): number {
  return items.reduce((sum, item) => sum + item.hours, 0);
}

export function teacherTotalHours(teacher: Teacher): number {
  return GRADES.reduce(
    (sum, grade) => sum + sumAssignmentHours(teacher.assignments[grade] ?? []),
    0,
  );
}

export function createAssignmentForSubject(
  subjects: GradeSubjects,
  grade: Grade,
  name: string,
  gradeClassCounts?: GradeClassCounts,
): AssignmentItem {
  const subject = subjects[grade]?.find((s) => s.name === name);
  const len = targetClassHourLength(subject, gradeClassCounts?.[grade]);
  return syncAssignmentItem(
    name,
    Array.from({ length: len }, () => MIN_CELL_HOURS),
  );
}

export function ensureTeachers(
  value: Teacher[] | null | undefined,
): Teacher[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) return createDefaultTeachers();
  return list.map((t) => ({
    name: typeof t?.name === "string" ? t.name : "",
    assignments: ensureAssignments(
      (t as Teacher | undefined)?.assignments ?? createEmptyTeacherAssignments(),
    ),
  }));
}

export function parseTeachersFromClipboard(text: string): Teacher[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const teachers: Teacher[] = [];

  for (let i = 0; i < lines.length; i++) {
    const first = (lines[i].split("\t")[0] ?? "").trim();
    if (i === 0 && HEADER_NAMES.has(first.toLowerCase())) continue;
    if (!first) continue;
    teachers.push({
      name: first,
      assignments: createEmptyTeacherAssignments(),
    });
  }

  return teachers;
}

export function parseTeachers(value: unknown): Teacher[] | null {
  if (!Array.isArray(value)) return null;

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { name, assignments } = item as Record<string, unknown>;
    if (typeof name !== "string") return null;
    if (assignments !== undefined) {
      if (!assignments || typeof assignments !== "object") return null;
      for (const grade of GRADES) {
        const raw =
          (assignments as Record<string, unknown>)[grade] ??
          (assignments as Record<string, unknown>)[String(grade)];
        if (raw !== undefined && !Array.isArray(raw)) return null;
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            if (typeof entry === "string") continue;
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as { name?: unknown }).name === "string"
            ) {
              continue;
            }
            return null;
          }
        }
      }
    }
  }

  return ensureTeachers(value as Teacher[]);
}

/** Keep only subjects that still exist for each grade; align classHours. */
export function filterAssignmentsToSubjects(
  assignments: TeacherAssignments,
  subjects: GradeSubjects,
  gradeClassCounts?: GradeClassCounts,
): TeacherAssignments {
  const next = createEmptyTeacherAssignments();
  for (const grade of GRADES) {
    const byName = new Map(subjects[grade].map((s) => [s.name, s]));
    next[grade] = assignments[grade]
      .filter((item) => byName.has(item.name))
      .map((item) =>
        alignAssignmentToSubject(
          item,
          byName.get(item.name),
          gradeClassCounts?.[grade],
        ),
      );
  }
  return next;
}

export function hasAnyAssignment(teacher: Teacher): boolean {
  return GRADES.some((grade) => teacher.assignments[grade].length > 0);
}

export function hasValidAssignmentHours(teacher: Teacher): boolean {
  return GRADES.every((grade) =>
    teacher.assignments[grade].every((item) => {
      const total = sumClassHours(item.classHours ?? [item.hours]);
      return (
        Number.isFinite(total) &&
        total >= MIN_ASSIGNMENT_HOURS &&
        total <= MAX_ASSIGNMENT_HOURS
      );
    }),
  );
}

export function sanitizeTeachers(teachers: Teacher[]): Teacher[] {
  return ensureTeachers(teachers)
    .map((t) => ({
      name: t.name.trim(),
      assignments: ensureAssignments(t.assignments),
    }))
    .filter((t) => t.name.length > 0);
}

export function withEditTeacherRows(teachers: Teacher[]): Teacher[] {
  const sanitized = sanitizeTeachers(teachers);
  return sanitized.length > 0
    ? sanitized.map((t) => ({
        name: t.name,
        assignments: ensureAssignments(t.assignments),
      }))
    : [createEmptyTeacher()];
}

const CSV_HEADERS = {
  name: "교사명",
  1: "1학년",
  2: "2학년",
  3: "3학년",
} as const;

const NAME_HEADER_ALIASES = new Set(
  [...HEADER_NAMES].map((h) => h.toLowerCase()),
);

const GRADE_HEADER_ALIASES: Record<Grade, Set<string>> = {
  1: new Set(["1학년", "1", "학년1", "grade1", "g1"]),
  2: new Set(["2학년", "2", "학년2", "grade2", "g2"]),
  3: new Set(["3학년", "3", "학년3", "grade3", "g3"]),
};

export type TeachersCsvError = {
  row: number;
  message: string;
};

export type TeachersCsvParseResult = {
  teachers: Teacher[];
  errors: TeachersCsvError[];
};

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvRows(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function splitAssignmentItems(
  cell: string,
  subjects: GradeSubjects,
  grade: Grade,
  gradeClassCounts?: GradeClassCounts,
): AssignmentItem[] {
  const seen = new Set<string>();
  const items: AssignmentItem[] = [];
  for (const part of cell.split(/[,;]/)) {
    const raw = part.trim();
    if (!raw) continue;

    let name = raw;
    let hours: number | undefined;
    const colon = raw.lastIndexOf(":");
    if (colon > 0) {
      const maybeHours = Number(raw.slice(colon + 1).trim());
      if (Number.isFinite(maybeHours)) {
        name = raw.slice(0, colon).trim();
        hours = maybeHours;
      }
    }

    if (!name || seen.has(name)) continue;
    seen.add(name);
    const subject = subjects[grade]?.find((s) => s.name === name);
    const base = createAssignmentForSubject(
      subjects,
      grade,
      name,
      gradeClassCounts,
    );
    if (hours !== undefined) {
      if (isSetSubject(subject) || base.classHours.length === 1) {
        items.push(syncAssignmentItem(name, [clampCellHours(hours)]));
      } else {
        const cells = [...base.classHours];
        cells[0] = clampCellHours(hours);
        items.push(syncAssignmentItem(name, cells));
      }
    } else {
      items.push(base);
    }
  }
  return items;
}

function formatSubjectsCell(items: AssignmentItem[]): string {
  return items.map((item) => `${item.name}:${item.hours}`).join(",");
}

/** Build UTF-8 CSV (with BOM when downloaded) for teacher assignments. */
export function teachersToCsv(
  teachers: Teacher[],
  subjects?: GradeSubjects,
): string {
  const refNames: Record<Grade, string[]> = {
    1: [],
    2: [],
    3: [],
  };
  if (subjects) {
    for (const grade of GRADES) {
      refNames[grade] = subjects[grade]
        .map((s) => s.name.trim())
        .filter((n) => n.length > 0);
    }
  }

  const hasRefs = GRADES.some((g) => refNames[g].length > 0);
  const headerCols: string[] = [
    CSV_HEADERS.name,
    CSV_HEADERS[1],
    CSV_HEADERS[2],
    CSV_HEADERS[3],
  ];
  if (hasRefs) {
    headerCols.push("", "참고1학년", "참고2학년", "참고3학년");
  }

  const teacherRows = sanitizeTeachers(teachers).map((t) => {
    const assignments = ensureAssignments(t.assignments);
    return [
      t.name,
      formatSubjectsCell(assignments[1]),
      formatSubjectsCell(assignments[2]),
      formatSubjectsCell(assignments[3]),
    ];
  });

  const refRowCount = hasRefs
    ? Math.max(refNames[1].length, refNames[2].length, refNames[3].length, 0)
    : 0;
  const rowCount = Math.max(teacherRows.length, refRowCount);

  const lines: string[] = [headerCols.map(escapeCsvField).join(",")];

  for (let i = 0; i < rowCount; i++) {
    const teacherCols = teacherRows[i] ?? ["", "", "", ""];
    const cols = [...teacherCols];
    if (hasRefs) {
      cols.push(
        "",
        refNames[1][i] ?? "",
        refNames[2][i] ?? "",
        refNames[3][i] ?? "",
      );
    }
    lines.push(cols.map(escapeCsvField).join(","));
  }

  return lines.join("\n");
}

/**
 * Parse teacher-assignment CSV.
 * Expected columns: 교사명, 1학년, 2학년, 3학년 (aliases accepted).
 * Subject cells: comma/semicolon-separated names; must match subjects exactly.
 */
export function parseTeachersFromCsv(
  text: string,
  subjects: GradeSubjects,
  gradeClassCounts?: GradeClassCounts,
): TeachersCsvParseResult {
  const errors: TeachersCsvError[] = [];
  const rows = parseCsvRows(text).filter((cols) => {
    const joined = cols.join("").trim();
    if (!joined) return false;
    if (joined.startsWith("#")) return false;
    return true;
  });

  if (rows.length === 0) {
    return {
      teachers: [],
      errors: [{ row: 0, message: "CSV에 데이터가 없습니다." }],
    };
  }

  const headerCells = rows[0].map((c) => c.trim());
  const headerLower = headerCells.map((c) => c.toLowerCase());

  let nameIdx = headerLower.findIndex((h) => NAME_HEADER_ALIASES.has(h));
  const gradeIdx: Partial<Record<Grade, number>> = {};
  for (const grade of GRADES) {
    const idx = headerLower.findIndex((h) =>
      GRADE_HEADER_ALIASES[grade].has(h),
    );
    if (idx >= 0) gradeIdx[grade] = idx;
  }

  const hasHeader =
    nameIdx >= 0 || GRADES.some((g) => gradeIdx[g] !== undefined);

  let dataStart = 0;
  if (hasHeader) {
    dataStart = 1;
    if (nameIdx < 0) nameIdx = 0;
  } else {
    nameIdx = 0;
    gradeIdx[1] = 1;
    gradeIdx[2] = 2;
    gradeIdx[3] = 3;
  }

  if (GRADES.every((g) => gradeIdx[g] === undefined)) {
    gradeIdx[1] = nameIdx + 1;
    gradeIdx[2] = nameIdx + 2;
    gradeIdx[3] = nameIdx + 3;
  }

  const allowed: Record<Grade, Set<string>> = {
    1: new Set(subjects[1].map((s) => s.name)),
    2: new Set(subjects[2].map((s) => s.name)),
    3: new Set(subjects[3].map((s) => s.name)),
  };

  const teachers: Teacher[] = [];
  const seenNames = new Set<string>();

  for (let i = dataStart; i < rows.length; i++) {
    const cols = rows[i];
    const rowNumber = i + 1;
    const name = (cols[nameIdx] ?? "").trim();

    const assignmentCells = GRADES.map((grade) => {
      const idx = gradeIdx[grade];
      return idx !== undefined ? (cols[idx] ?? "").trim() : "";
    });
    const hasAssignmentText = assignmentCells.some((c) => c.length > 0);

    // Reference-subject padding rows (right-side columns only)
    if (!name && !hasAssignmentText) continue;

    if (!name) {
      errors.push({ row: rowNumber, message: "교사명이 비어 있습니다." });
      continue;
    }
    if (seenNames.has(name)) {
      errors.push({
        row: rowNumber,
        message: `교사명 "${name}"이(가) 중복됩니다.`,
      });
      continue;
    }
    seenNames.add(name);

    const assignments = createEmptyTeacherAssignments();
    for (const grade of GRADES) {
      const idx = gradeIdx[grade];
      const cell = idx !== undefined ? (cols[idx] ?? "") : "";
      const items = splitAssignmentItems(
        cell,
        subjects,
        grade,
        gradeClassCounts,
      );
      for (const item of items) {
        if (!allowed[grade].has(item.name)) {
          errors.push({
            row: rowNumber,
            message: `${grade}학년에 없는 과목 "${item.name}" (${name})`,
          });
          continue;
        }
        if (!assignments[grade].some((a) => a.name === item.name)) {
          assignments[grade].push(item);
        }
      }
    }

    teachers.push({ name, assignments });
  }

  return { teachers, errors };
}
