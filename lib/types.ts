export type Semester = 1 | 2;

export type TermInput = {
  timetableName: string;
  school: string;
  academicYear: number;
  semester: Semester;
};

export type TermDocument = TermInput & {
  /** 소유 계정의 accounts._id (문자열). 서버가 세션에서 채우며 클라이언트가 보내지 않는다. */
  ownerId: string;
  createdAt: Date;
};

export type AccountDocument = {
  username: string;
  passwordHash: string;
  createdAt: Date;
  /** "체험해보기" 클릭마다 새로 만들어지는 격리된 데모 계정 표시. */
  isDemo?: boolean;
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

export function dayLabel(day: Weekday): string {
  return WEEKDAYS.find((d) => d.key === day)?.label ?? day;
}

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

/**
 * When a SET subject is shared by multiple teachers who rotate (e.g. 3
 * teachers covering 1 period each of a 3-period subject), only one of them
 * actually teaches — and is therefore "busy" — at any given occurrence.
 * This records which specific teacher covers a specific placed slot for a
 * specific subject, so busy-marking doesn't conservatively assume all of
 * the subject's teachers are occupied at every occurrence.
 */
export type SetTeacherAssignment = {
  grade: Grade;
  set: ElectiveSet;
  day: Weekday;
  period: number;
  subjectName: string;
  teacherName: string;
};

export type SetBlocksDocument = {
  termId: string;
  cells: SetBlockCell[];
  /** Partial SET placements; multiple SETs may share a slot if home-rooms do not overlap. */
  partialCells?: SetBlockCell[];
  /** Per-slot teacher resolution for multi-teacher rotating SET subjects. */
  teacherAssignments?: SetTeacherAssignment[];
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
  /**
   * Diagnostic classification of why this lesson stayed unplaced, computed
   * against the final committed schedule:
   * - "impossible": zero slots exist where both the class and teacher are
   *   free — retrying/waiting longer will not help, the layout must change.
   * - "contention": at least one free slot exists in isolation, but other
   *   lessons ended up occupying it — a matching/ordering limitation.
   */
  reason?: "impossible" | "contention";
};

/** One instance of a soft-preference violation (lunch double or triple run). */
export type SoftRunDetail = {
  kind: "lunch" | "triple";
  grade: Grade;
  classNo: number;
  day: Weekday;
  subjectName: string;
  teacherName: string;
  /** Inclusive start/end period of the run. */
  startPeriod: number;
  endPeriod: number;
};

/** A (grade, subject) pair selected as "같은 날 중복 배치 금지" target. */
export type SameDaySubjectBan = {
  grade: Grade;
  subjectName: string;
};

/** One instance of the same subject landing twice (or more) on the same day. */
export type SameDaySubjectViolation = {
  grade: Grade;
  classNo: number;
  day: Weekday;
  subjectName: string;
  teacherName: string;
  /** Periods this subject occupies on this day (2+, ascending). */
  periods: number[];
};

export type TimetableDocument = {
  termId: string;
  status: "idle" | "ready" | "failed";
  cells: TimetableCell[];
  unplaced: TimetableUnplaced[];
  generatedAt?: Date;
  updatedAt: Date;
  message?: string;
  /**
   * Lunch-double diagnostics for the committed `cells`, computed regardless
   * of whether the 점심시간 연강 배제 preference was on — so users can check
   * how many lunch doubles remain even when generating with it off.
   */
  lunchDoubleCount?: number;
  lunchDoubles?: SoftRunDetail[];
  /**
   * Same-teacher 3+ consecutive-period diagnostics for the committed `cells`,
   * computed regardless of whether the 3연강 완화 preference was on.
   */
  tripleRunCount?: number;
  tripleRuns?: SoftRunDetail[];
  /**
   * Lunch-priority stage (테스트용 2단계 배치): lunch-adjacent lessons chosen
   * ahead of the rest of the schedule. Stored in 교과 블록 cell format so they
   * can be merged as fixed cells for the "남은 시간 시간표 배치" step.
   */
  lunchLockCells?: SubjectBlockCell[];
  lunchStatus?: "idle" | "ready" | "failed";
  lunchMessage?: string;
  lunchGeneratedAt?: Date;
  /**
   * Same-day-subject diagnostics for the committed `cells`, computed
   * regardless of whether 동일 교과 같은 날 배치 금지 was on.
   */
  sameDaySubjectViolationCount?: number;
  sameDaySubjectViolations?: SameDaySubjectViolation[];
  /**
   * Same-day-subject priority stage (테스트용 우선 배치): banned-subject
   * lessons spread across distinct days ahead of the rest of the schedule.
   * Stored in 교과 블록 cell format so they can be merged as fixed cells for
   * the "남은 시간 시간표 배치" step.
   */
  sameDaySubjectLockCells?: SubjectBlockCell[];
  sameDaySubjectStatus?: "idle" | "ready" | "failed";
  sameDaySubjectMessage?: string;
  sameDaySubjectGeneratedAt?: Date;
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

/**
 * Soft preferences for timetable generation (not hard bans).
 * Extensible for future weights (e.g. avoid 3-period runs).
 */
export type GenerationPreferences = {
  /** Prefer not assigning the same teacher across lunch (N and N+1). */
  avoidLunchDouble: boolean;
  /** Period immediately before lunch (e.g. 4 → avoid teacher on 4 and 5). */
  lunchAfterPeriod: number;
  /** Prefer not placing same class+subject for 3 consecutive periods. */
  avoidTriplePeriod: boolean;
  /** Master switch: avoid placing the selected subjects twice on the same day. */
  avoidSameDaySubject: boolean;
  /** Per-grade subjects selected for the same-day-duplicate ban. */
  sameDaySubjectBans: SameDaySubjectBan[];
};

export type GenerationPreferencesDocument = GenerationPreferences & {
  termId: string;
  updatedAt: Date;
};
