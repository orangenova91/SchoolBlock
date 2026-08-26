import {
  GRADES,
  MAX_CLASS_COUNT,
  MAX_PERIODS,
  MIN_CLASS_COUNT,
  MIN_PERIODS,
  WEEKDAYS,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Weekday,
  type WeekdayPeriods,
} from "@/lib/types";

function isWeekdayPeriods(value: unknown): value is WeekdayPeriods {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return WEEKDAYS.every(({ key }) => {
    const n = record[key];
    return (
      typeof n === "number" &&
      Number.isInteger(n) &&
      n >= MIN_PERIODS &&
      n <= MAX_PERIODS
    );
  });
}

export function parseGradeDaySchedules(
  value: unknown,
): GradeDaySchedules | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const grades = {} as GradeDaySchedules;

  for (const grade of GRADES) {
    const raw = record[grade] ?? record[String(grade)];
    if (!isWeekdayPeriods(raw)) return null;
    grades[grade] = { ...(raw as WeekdayPeriods) };
  }

  return grades;
}

export function parseClassCounts(value: unknown): GradeClassCounts | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const counts = {} as GradeClassCounts;

  for (const grade of GRADES) {
    const raw = record[grade] ?? record[String(grade)];
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < MIN_CLASS_COUNT ||
      raw > MAX_CLASS_COUNT
    ) {
      return null;
    }
    counts[grade] = raw;
  }

  return counts;
}

export function normalizePeriodInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_PERIODS || n > MAX_PERIODS) return null;
  return n;
}

export function setPeriod(
  grades: GradeDaySchedules,
  grade: 1 | 2 | 3,
  day: Weekday,
  periods: number,
): GradeDaySchedules {
  return {
    ...grades,
    [grade]: {
      ...grades[grade],
      [day]: periods,
    },
  };
}

/** Sum of Mon–Fri periods for one grade. */
export function sumWeekdayPeriods(periods: WeekdayPeriods): number {
  return WEEKDAYS.reduce((sum, { key }) => sum + periods[key], 0);
}
