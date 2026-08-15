export type Semester = 1 | 2;

export type TermInput = {
  timetableName: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

export type TermDocument = TermInput & {
  createdAt: Date;
};

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri";

export type Grade = 1 | 2 | 3;

export type WeekdayPeriods = Record<Weekday, number>;

export type GradeDaySchedules = Record<Grade, WeekdayPeriods>;

export type GradeClassCounts = Record<Grade, number>;

export type DayScheduleDocument = {
  termId: string;
  classCounts: GradeClassCounts;
  grades: GradeDaySchedules;
  updatedAt: Date;
};

export const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
];

export const GRADES: Grade[] = [1, 2, 3];

export const DEFAULT_PERIODS = 7;
export const MIN_PERIODS = 0;
export const MAX_PERIODS = 10;

export const DEFAULT_CLASS_COUNT = 8;
export const MIN_CLASS_COUNT = 1;
export const MAX_CLASS_COUNT = 20;

export function createDefaultWeekdayPeriods(
  value = DEFAULT_PERIODS,
): WeekdayPeriods {
  return {
    mon: value,
    tue: value,
    wed: value,
    thu: value,
    fri: value,
  };
}

export function createDefaultGradeDaySchedules(): GradeDaySchedules {
  return {
    1: createDefaultWeekdayPeriods(),
    2: createDefaultWeekdayPeriods(),
    3: createDefaultWeekdayPeriods(),
  };
}

export function createDefaultClassCounts(
  value = DEFAULT_CLASS_COUNT,
): GradeClassCounts {
  return {
    1: value,
    2: value,
    3: value,
  };
}

export type SubjectSet =
  | "공통"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I";

export const SUBJECT_SETS: SubjectSet[] = [
  "공통",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
];

export const DEFAULT_SUBJECT_SET: SubjectSet = "공통";

export type ElectiveSet = Exclude<SubjectSet, typeof DEFAULT_SUBJECT_SET>;

export const ELECTIVE_SETS: ElectiveSet[] = SUBJECT_SETS.filter(
  (set): set is ElectiveSet => set !== DEFAULT_SUBJECT_SET,
);

export type Subject = {
  set: SubjectSet;
  name: string;
  units: number;
  classCount: number;
  /**
   * Partial SET: section id (1-based).
   * 1…gradeClassCount = home room; gradeClassCount+1 = +α (이동 분반, one slot).
   * SET subjects always use classCount = 1.
   */
  classNo?: number;
};

export type GradeSubjects = Record<Grade, Subject[]>;

export type SubjectsDocument = {
  termId: string;
  subjects: GradeSubjects;
  updatedAt: Date;
};

export const MIN_SUBJECT_UNITS = 1;
export const MAX_SUBJECT_UNITS = 20;

export const MIN_SUBJECT_CLASS_COUNT = 1;
export const MAX_SUBJECT_CLASS_COUNT = 20;
export const DEFAULT_SUBJECT_CLASS_COUNT = 1;

export function createEmptySubject(): Subject {
  return {
    set: DEFAULT_SUBJECT_SET,
    name: "",
    units: MIN_SUBJECT_UNITS,
    classCount: DEFAULT_SUBJECT_CLASS_COUNT,
  };
}

export function createDefaultGradeSubjects(): GradeSubjects {
  return {
    1: [createEmptySubject()],
    2: [createEmptySubject()],
    3: [createEmptySubject()],
  };
}

export type AssignmentItem = {
  name: string;
  /** Per-class hours for 공통; length 1 for SET. */
  classHours: number[];
  /** Sum of classHours (kept for totals / CSV). */
  hours: number;
};

export type TeacherAssignments = Record<Grade, AssignmentItem[]>;

export type Teacher = {
  name: string;
  assignments: TeacherAssignments;
};

export type TeachersDocument = {
  termId: string;
  teachers: Teacher[];
  updatedAt: Date;
};

export const MIN_ASSIGNMENT_HOURS = 1;
export const MAX_ASSIGNMENT_HOURS = 40;
export const DEFAULT_ASSIGNMENT_HOURS = 1;

/** Per-class / SET badge click cycle: 0 … MAX → 0 */
export const MIN_CELL_HOURS = 0;
export const MAX_CELL_HOURS = 10;

export function createEmptyTeacherAssignments(): TeacherAssignments {
  return { 1: [], 2: [], 3: [] };
}

export function createEmptyTeacher(): Teacher {
  return { name: "", assignments: createEmptyTeacherAssignments() };
}

export function createDefaultTeachers(): Teacher[] {
  return [createEmptyTeacher()];
}

export type SetBlockCell = {
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
};

export type SetBlocksDocument = {
  termId: string;
  cells: SetBlockCell[];
  /** Partial SET placements; multiple SETs may share a slot if home-rooms do not overlap. */
  partialCells?: SetBlockCell[];
  updatedAt: Date;
};

export type TimetableCellKind = "common" | "set";

export type TimetableCell = {
  grade: Grade;
  classNo: number;
  day: Weekday;
  period: number;
  subjectName: string;
  teacherName: string;
  kind: TimetableCellKind;
  set?: ElectiveSet;
};

export type TimetableUnplaced = {
  teacherName: string;
  grade: Grade;
  classNo: number;
  subjectName: string;
  remaining: number;
};

export type TimetableDocument = {
  termId: string;
  status: "idle" | "ready" | "failed";
  cells: TimetableCell[];
  unplaced: TimetableUnplaced[];
  generatedAt?: Date;
  updatedAt: Date;
  message?: string;
};

/** Teacher cannot be assigned any lesson at this weekday + period. */
export type TeacherForbiddenSlot = {
  teacherName: string;
  day: Weekday;
  period: number;
};

export type TeacherConstraintsDocument = {
  termId: string;
  forbiddenSlots: TeacherForbiddenSlot[];
  updatedAt: Date;
};

/** Pre-locked common lesson (교과 블록). */
export type SubjectBlockCell = {
  grade: Grade;
  classNo: number;
  subjectName: string;
  teacherName: string;
  day: Weekday;
  period: number;
};

export type SubjectBlocksDocument = {
  termId: string;
  cells: SubjectBlockCell[];
  updatedAt: Date;
};
