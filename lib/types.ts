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

export type Subject = {
  name: string;
  units: number;
};

export type GradeSubjects = Record<Grade, Subject[]>;

export type SubjectsDocument = {
  termId: string;
  subjects: GradeSubjects;
  updatedAt: Date;
};

export const MIN_SUBJECT_UNITS = 1;
export const MAX_SUBJECT_UNITS = 20;

export function createEmptySubject(): Subject {
  return { name: "", units: MIN_SUBJECT_UNITS };
}

export function createDefaultGradeSubjects(): GradeSubjects {
  return {
    1: [createEmptySubject()],
    2: [createEmptySubject()],
    3: [createEmptySubject()],
  };
}
