import {
  DEFAULT_ASSIGNMENT_HOURS,
  DEFAULT_SUBJECT_SET,
  GRADES,
  MAX_ASSIGNMENT_HOURS,
  MAX_CELL_HOURS,
  MAX_TEACHER_GROUP_NAME,
  MIN_ASSIGNMENT_HOURS,
  MIN_CELL_HOURS,
  createDefaultClassCounts,
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
    ...groupField(t?.group),
  }));
}

/** 그룹명이 있을 때만 group 필드를 붙인다 */
function groupField(value: unknown): { group?: string } {
  const group = typeof value === "string" ? value.trim().slice(0, MAX_TEACHER_GROUP_NAME) : "";
  return group ? { group } : {};
}

export type TeacherSection = {
  /** null = 그룹 없음 (그룹을 하나도 안 만들었으면 전체가 이 한 구역) */
  group: string | null;
  names: string[];
};

/**
 * 시간표 보기·엑셀의 교사 줄 순서.
 * 그룹이 있으면 그룹 순서 → 그룹 안은 교사 배정 명단 순서, 그룹 없는 교사는 맨 끝. 빈 구역은 뺀다.
 * 그룹이 없으면 (v1·v2 포함) 가나다순 한 구역.
 */
export function teacherSections(teachers: Teacher[], groups: string[] = []): TeacherSection[] {
  const seen = new Set<string>();
  const list: { name: string; group: string | null }[] = [];
  for (const t of teachers) {
    const name = t.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push({ name, group: t.group && groups.includes(t.group) ? t.group : null });
  }
  if (groups.length === 0) {
    return [{ group: null, names: list.map((x) => x.name).sort((a, b) => a.localeCompare(b, "ko")) }];
  }
  return [...groups, null]
    .map((group) => ({ group, names: list.filter((x) => x.group === group).map((x) => x.name) }))
    .filter((section) => section.names.length > 0);
}

/** 구역 머리줄을 보일지: 실제 그룹에 든 교사가 있을 때만 */
export const hasTeacherGroupSections = (sections: TeacherSection[]) => sections.some((s) => s.group !== null);

/** 저장할 그룹 목록: 이름 정리·중복 제거 후, 교사가 쓰는데 목록에 없는 그룹을 덧붙인다 */
export function sanitizeTeacherGroups(value: unknown, teachers: Teacher[]): string[] {
  const names = (Array.isArray(value) ? value : [])
    .map((v) => groupField(v).group)
    .concat(teachers.map((t) => groupField(t.group).group))
    .filter((v): v is string => Boolean(v));
  return [...new Set(names)];
}

export function parseTeachersFromClipboard(text: string): Teacher[] {
  const lines = text
    .replace(/^﻿/, "")
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
    const { name, assignments, group } = item as Record<string, unknown>;
    if (typeof name !== "string") return null;
    if (group !== undefined && group !== null && typeof group !== "string") return null;
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
      ...groupField(t.group),
    }))
    .filter((t) => t.name.length > 0);
}

export function withEditTeacherRows(teachers: Teacher[]): Teacher[] {
  const sanitized = sanitizeTeachers(teachers);
  return sanitized.length > 0
    ? sanitized.map((t) => ({
        name: t.name,
        assignments: ensureAssignments(t.assignments),
        ...groupField(t.group),
      }))
    : [createEmptyTeacher()];
}

const NAME_HEADER_ALIASES = new Set(
  [...HEADER_NAMES].map((h) => h.toLowerCase()),
);

const GRADE_COLUMN_ALIASES = new Set(["학년", "grade"]);

const SUBJECT_COLUMN_ALIASES = new Set([
  "교과명",
  "과목명",
  "과목",
  "교과",
  "수업명",
  "subject",
]);

const SET_HOURS_ALIASES = new Set([
  "set시수",
  "set 시수",
  "set",
  "이동수업시수",
  "선택시수",
]);

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
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

function maxClassColumnCount(gradeClassCounts?: GradeClassCounts): number {
  const counts = gradeClassCounts ?? createDefaultClassCounts();
  return Math.max(1, counts[1] ?? 0, counts[2] ?? 0, counts[3] ?? 0);
}

function classColumnHeader(classNo: number): string {
  return `${classNo}반`;
}

/** Match a header cell to a 학반 column number: "1반", "반1", "class1", "c1". */
function matchClassColumn(headerCell: string): number | null {
  const trimmed = headerCell.trim();
  const patterns = [/^(\d+)\s*반$/, /^반\s*(\d+)$/, /^class\s*(\d+)$/i, /^c(\d+)$/i];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function addAssignment(
  byTeacher: Map<string, Teacher>,
  name: string,
  grade: Grade,
  item: AssignmentItem,
): void {
  let teacher = byTeacher.get(name);
  if (!teacher) {
    teacher = { name, assignments: createEmptyTeacherAssignments() };
    byTeacher.set(name, teacher);
  }
  teacher.assignments[grade].push(item);
}

/**
 * Build UTF-8 CSV (with BOM when downloaded) for teacher assignments.
 * One row per (교사, 학년, 교과) 배정. 공통 과목은 학반별 열(1반, 2반, …)에
 * 시수를, SET(이동수업/선택) 과목은 특정 반에 속하지 않으므로 "SET시수" 한
 * 칸에만 값을 채운다.
 */
export function teachersToCsv(
  teachers: Teacher[],
  subjects: GradeSubjects,
  gradeClassCounts?: GradeClassCounts,
): string {
  const maxClassCount = maxClassColumnCount(gradeClassCounts);

  const headerCols = [
    "교사명",
    "학년",
    "교과명",
    ...Array.from({ length: maxClassCount }, (_, i) => classColumnHeader(i + 1)),
    "SET시수",
  ];

  const lines: string[] = [headerCols.map(escapeCsvField).join(",")];

  for (const teacher of sanitizeTeachers(teachers)) {
    const assignments = ensureAssignments(teacher.assignments);
    for (const grade of GRADES) {
      for (const item of assignments[grade]) {
        const subject = subjects[grade]?.find((s) => s.name === item.name);
        const set = isSetSubject(subject);
        const classCols = Array.from({ length: maxClassCount }, (_, i) =>
          !set && i < item.classHours.length ? String(item.classHours[i]) : "",
        );
        const row = [teacher.name, String(grade), item.name, ...classCols, set ? String(item.hours) : ""];
        lines.push(row.map(escapeCsvField).join(","));
      }
    }
  }

  return lines.join("\n");
}

/**
 * Parse teacher-assignment CSV produced by `teachersToCsv` (or edited by hand).
 * Required header columns: 교사명, 학년, 교과명 (별칭 허용). 학반 열은 "N반"
 * 형태로 인식하고, 공통이 아닌(SET) 과목은 "SET시수" 열 값을 사용한다.
 * 오류가 하나라도 있으면 호출부에서 결과를 반영하지 않아야 한다(전체 거부).
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

  const nameIdx = headerLower.findIndex((h) => NAME_HEADER_ALIASES.has(h));
  const gradeIdx = headerLower.findIndex((h) => GRADE_COLUMN_ALIASES.has(h));
  const subjectIdx = headerLower.findIndex((h) => SUBJECT_COLUMN_ALIASES.has(h));
  const setHoursIdx = headerLower.findIndex((h) => SET_HOURS_ALIASES.has(h));

  if (nameIdx < 0 || gradeIdx < 0 || subjectIdx < 0) {
    return {
      teachers: [],
      errors: [
        {
          row: 1,
          message: '헤더에 "교사명", "학년", "교과명" 열이 모두 있어야 합니다.',
        },
      ],
    };
  }

  const classColIdx = new Map<number, number>();
  headerCells.forEach((cell, idx) => {
    const classNo = matchClassColumn(cell);
    if (classNo !== null) classColIdx.set(classNo, idx);
  });

  const counts: GradeClassCounts = gradeClassCounts ?? createDefaultClassCounts();
  const allowed: Record<Grade, Map<string, Subject>> = {
    1: new Map(subjects[1].map((s) => [s.name, s])),
    2: new Map(subjects[2].map((s) => [s.name, s])),
    3: new Map(subjects[3].map((s) => [s.name, s])),
  };

  const byTeacher = new Map<string, Teacher>();
  const seenAssignment = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const rowNumber = i + 1;

    const name = (cols[nameIdx] ?? "").trim();
    const gradeRaw = (cols[gradeIdx] ?? "").trim();
    const subjectName = (cols[subjectIdx] ?? "").trim();

    if (!name && !gradeRaw && !subjectName) continue; // 완전히 빈 행

    if (!name) {
      errors.push({ row: rowNumber, message: "교사명이 비어 있습니다." });
      continue;
    }

    const gradeNum = Number(gradeRaw);
    if (!GRADES.includes(gradeNum as Grade)) {
      errors.push({
        row: rowNumber,
        message: `학년 값이 올바르지 않습니다: "${gradeRaw}" (1, 2, 3 중 하나)`,
      });
      continue;
    }
    const grade = gradeNum as Grade;

    if (!subjectName) {
      errors.push({ row: rowNumber, message: "교과명이 비어 있습니다." });
      continue;
    }

    const subject = allowed[grade].get(subjectName);
    if (!subject) {
      errors.push({
        row: rowNumber,
        message: `${grade}학년에 없는 과목 "${subjectName}" (${name})`,
      });
      continue;
    }

    const key = `${name} ${grade} ${subjectName}`;
    if (seenAssignment.has(key)) {
      errors.push({
        row: rowNumber,
        message: `"${name}"의 ${grade}학년 "${subjectName}" 배정이 중복됩니다.`,
      });
      continue;
    }
    seenAssignment.add(key);

    const set = isSetSubject(subject);
    const setRaw = setHoursIdx >= 0 ? (cols[setHoursIdx] ?? "").trim() : "";
    const classRaw = new Map<number, string>();
    for (const [classNo, colIdx] of classColIdx) {
      const raw = (cols[colIdx] ?? "").trim();
      if (raw) classRaw.set(classNo, raw);
    }

    let rowHasError = false;
    const fail = (message: string) => {
      errors.push({ row: rowNumber, message });
      rowHasError = true;
    };

    if (set) {
      if (classRaw.size > 0) {
        fail(`"${subjectName}"은(는) SET 과목이라 반별 칸이 아니라 "SET시수" 칸에 입력해야 합니다.`);
      }
      if (!setRaw) {
        fail(`"${subjectName}"의 SET시수가 비어 있습니다.`);
      } else {
        const n = Number(setRaw);
        if (!Number.isFinite(n) || n < MIN_CELL_HOURS || n > MAX_CELL_HOURS) {
          fail(`SET시수 값이 올바르지 않습니다: "${setRaw}" (${MIN_CELL_HOURS}~${MAX_CELL_HOURS})`);
        }
      }
      if (rowHasError) continue;

      addAssignment(byTeacher, name, grade, syncAssignmentItem(subjectName, [clampCellHours(Number(setRaw))]));
      continue;
    }

    // 공통 과목
    if (setRaw) {
      fail(`"${subjectName}"은(는) 공통 과목이라 "SET시수" 칸에는 값을 넣을 수 없습니다.`);
    }

    const gradeClassCount = counts[grade] ?? 0;
    for (const classNo of classRaw.keys()) {
      if (classNo > gradeClassCount) {
        fail(`${grade}학년은 ${gradeClassCount}개 반까지만 있는데 "${classNo}반" 칸에 값이 있습니다.`);
      }
    }

    const classHours: number[] = [];
    for (let classNo = 1; classNo <= gradeClassCount; classNo++) {
      const raw = classRaw.get(classNo);
      if (raw === undefined) {
        classHours.push(0);
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < MIN_CELL_HOURS || n > MAX_CELL_HOURS) {
        fail(`"${classNo}반" 시수 값이 올바르지 않습니다: "${raw}" (${MIN_CELL_HOURS}~${MAX_CELL_HOURS})`);
        classHours.push(0);
        continue;
      }
      classHours.push(n);
    }

    if (rowHasError) continue;

    addAssignment(byTeacher, name, grade, syncAssignmentItem(subjectName, classHours));
  }

  return { teachers: Array.from(byTeacher.values()), errors };
}
