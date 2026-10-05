import {
  MAX_PERIODS,
  type Grade,
  type GenerationPreferences,
  type SameDaySubjectBan,
} from "@/lib/types";

export const DEFAULT_LUNCH_AFTER_PERIOD = 4;

/** Slot / solution score weight for lunch-teacher doubles (fixed; no strength levels). */
export const LUNCH_DOUBLE_PENALTY_WEIGHT = 10;

export function lunchDoubleWeight(
  preferences: Pick<GenerationPreferences, "avoidLunchDouble">,
): number {
  return preferences.avoidLunchDouble ? LUNCH_DOUBLE_PENALTY_WEIGHT : 0;
}

/**
 * Score weight for one 동일 교과 같은 날 중복 (class+day+subject). Same tier as
 * lunch doubles: both are rules the user explicitly turned on, while 3연강
 * (weight 1) is a milder comfort preference.
 */
export const SAME_DAY_SUBJECT_PENALTY_WEIGHT = 10;

export function sameDaySubjectWeight(
  preferences: Pick<GenerationPreferences, "avoidSameDaySubject" | "sameDaySubjectBans">,
): number {
  return preferences.avoidSameDaySubject && preferences.sameDaySubjectBans.length > 0
    ? SAME_DAY_SUBJECT_PENALTY_WEIGHT
    : 0;
}

export function sameDaySubjectBanKey(
  grade: Grade,
  subjectName: string,
): string {
  return `${grade}|${subjectName}`;
}

/** Validate + dedupe a raw same-day-subject ban list; null if malformed. */
function parseSameDaySubjectBans(value: unknown): SameDaySubjectBan[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const bans: SameDaySubjectBan[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { grade, subjectName } = item as Record<string, unknown>;
    if (grade !== 1 && grade !== 2 && grade !== 3) return null;
    if (typeof subjectName !== "string" || !subjectName.trim()) return null;
    const trimmed = subjectName.trim();
    const key = sameDaySubjectBanKey(grade, trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    bans.push({ grade, subjectName: trimmed });
  }
  return bans;
}

function normalizeSameDaySubjectBans(
  value: unknown,
): SameDaySubjectBan[] {
  const parsed = parseSameDaySubjectBans(value);
  if (parsed) return parsed;
  // Fall back to filtering out only the malformed entries instead of
  // discarding the whole list, so a single bad entry can't wipe selections.
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const bans: SameDaySubjectBan[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { grade, subjectName } = item as Record<string, unknown>;
    if (grade !== 1 && grade !== 2 && grade !== 3) continue;
    if (typeof subjectName !== "string" || !subjectName.trim()) continue;
    const trimmed = subjectName.trim();
    const key = sameDaySubjectBanKey(grade, trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    bans.push({ grade, subjectName: trimmed });
  }
  return bans;
}

export function createDefaultGenerationPreferences(): GenerationPreferences {
  return {
    avoidLunchDouble: true,
    lunchAfterPeriod: DEFAULT_LUNCH_AFTER_PERIOD,
    avoidTriplePeriod: true,
    avoidSameDaySubject: false,
    sameDaySubjectBans: [],
  };
}

export function normalizeGenerationPreferences(
  value: Partial<GenerationPreferences> | null | undefined,
): GenerationPreferences {
  const defaults = createDefaultGenerationPreferences();
  if (!value || typeof value !== "object") return defaults;

  const lunchAfterPeriod =
    typeof value.lunchAfterPeriod === "number" &&
    Number.isInteger(value.lunchAfterPeriod) &&
    value.lunchAfterPeriod >= 1 &&
    value.lunchAfterPeriod < MAX_PERIODS
      ? value.lunchAfterPeriod
      : defaults.lunchAfterPeriod;

  return {
    avoidLunchDouble:
      typeof value.avoidLunchDouble === "boolean"
        ? value.avoidLunchDouble
        : defaults.avoidLunchDouble,
    lunchAfterPeriod,
    avoidTriplePeriod:
      typeof value.avoidTriplePeriod === "boolean"
        ? value.avoidTriplePeriod
        : defaults.avoidTriplePeriod,
    avoidSameDaySubject:
      typeof value.avoidSameDaySubject === "boolean"
        ? value.avoidSameDaySubject
        : defaults.avoidSameDaySubject,
    sameDaySubjectBans: normalizeSameDaySubjectBans(value.sameDaySubjectBans),
  };
}

export function parseGenerationPreferences(
  value: unknown,
): GenerationPreferences | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.avoidLunchDouble !== "boolean") return null;
  if (
    typeof raw.lunchAfterPeriod !== "number" ||
    !Number.isInteger(raw.lunchAfterPeriod) ||
    raw.lunchAfterPeriod < 1 ||
    raw.lunchAfterPeriod >= MAX_PERIODS
  ) {
    return null;
  }
  if (
    raw.avoidTriplePeriod !== undefined &&
    typeof raw.avoidTriplePeriod !== "boolean"
  ) {
    return null;
  }
  if (
    raw.avoidSameDaySubject !== undefined &&
    typeof raw.avoidSameDaySubject !== "boolean"
  ) {
    return null;
  }
  const sameDaySubjectBans = parseSameDaySubjectBans(raw.sameDaySubjectBans);
  if (sameDaySubjectBans === null) return null;

  return normalizeGenerationPreferences({
    avoidLunchDouble: raw.avoidLunchDouble,
    lunchAfterPeriod: raw.lunchAfterPeriod,
    avoidTriplePeriod:
      typeof raw.avoidTriplePeriod === "boolean"
        ? raw.avoidTriplePeriod
        : undefined,
    avoidSameDaySubject:
      typeof raw.avoidSameDaySubject === "boolean"
        ? raw.avoidSameDaySubject
        : undefined,
    sameDaySubjectBans,
  });
}

/** Periods that form the lunch-straddling pair (before, after). */
export function lunchPairPeriods(lunchAfterPeriod: number): [number, number] {
  return [lunchAfterPeriod, lunchAfterPeriod + 1];
}

/**
 * True if p and p+1 are adjacent teaching periods (no lunch between).
 * Lunch sits after `lunchAfterPeriod`, so that boundary is not a run step.
 */
export function periodsAreAdjacentRun(
  earlier: number,
  later: number,
  lunchAfterPeriod: number,
): boolean {
  return later === earlier + 1 && earlier !== lunchAfterPeriod;
}

/** Three ascending periods form a consecutive run with no lunch gap. */
export function isTripleRunWindow(
  startPeriod: number,
  lunchAfterPeriod: number,
): boolean {
  return (
    periodsAreAdjacentRun(startPeriod, startPeriod + 1, lunchAfterPeriod) &&
    periodsAreAdjacentRun(startPeriod + 1, startPeriod + 2, lunchAfterPeriod)
  );
}

export function hasSoftPreferences(preferences: GenerationPreferences): boolean {
  return (
    preferences.avoidLunchDouble ||
    preferences.avoidTriplePeriod ||
    sameDaySubjectWeight(preferences) > 0
  );
}
