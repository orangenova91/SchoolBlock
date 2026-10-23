/**
 * v3 입력: 학기 데이터를 읽어 v3 방식으로 해석한다 (docs/v3-model-spec.md 1절).
 *
 * - 저장 형식은 v1·v2와 같다. 해석만 다르다:
 *   칠한 SET 회차 = 고정, 지정한 순환 담당 = 유지 (나머지는 생성기가 정함).
 * - 입력 지문(해시)이 같아야 중단점·진단을 다시 쓸 수 있다.
 */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type GenerationPreferences,
  type GenerationPreferencesDocument,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type SetBlockCell,
  type SetBlocksDocument,
  type SetTeacherAssignment,
  type SubjectBlockCell,
  type SubjectBlocksDocument,
  type SubjectsDocument,
  type Teacher,
  type TeacherConstraintsDocument,
  type TeacherForbiddenSlot,
  type TeachersDocument,
} from "@/lib/types";

/** 선호 항목 중요도 (1·2·3·5·10). 꺼진 항목은 0으로 본다. */
export type V3Weights = { lunch: number; triple: number; sameDay: number };

export const V3_WEIGHT_CHOICES = [1, 2, 3, 5, 10] as const;
export const DEFAULT_V3_WEIGHTS: V3Weights = { lunch: 3, triple: 2, sameDay: 3 };

export type V3Input = {
  teachers: Teacher[];
  subjects: GradeSubjects;
  classCounts: GradeClassCounts;
  schedules: GradeDaySchedules;
  /** 사용자가 칠한 학년 전체 SET 회차 = 고정 */
  fixedWholeCells: SetBlockCell[];
  /** 사용자가 칠한 부분 SET 회차 = 고정 */
  fixedPartialCells: SetBlockCell[];
  /** 사용자가 지정한 순환 담당 = 유지 */
  teacherAssignments: SetTeacherAssignment[];
  /** 선 수업 */
  pins: SubjectBlockCell[];
  forbiddenSlots: TeacherForbiddenSlot[];
  preferences: GenerationPreferences;
  /** 선호 중요도 (꺼진 항목 반영 전 값) */
  weights: V3Weights;
};

/** 문서 값에서 중요도를 읽는다. 허용 값이 아니면 기본값. */
export function parseV3Weights(value: unknown): V3Weights {
  const pick = (v: unknown, fallback: number) =>
    typeof v === "number" && (V3_WEIGHT_CHOICES as readonly number[]).includes(v) ? v : fallback;
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    lunch: pick(o.lunch, DEFAULT_V3_WEIGHTS.lunch),
    triple: pick(o.triple, DEFAULT_V3_WEIGHTS.triple),
    sameDay: pick(o.sameDay, DEFAULT_V3_WEIGHTS.sameDay),
  };
}

/** 점수 계산에 실제로 쓰는 중요도: 추가 조건에서 끈 항목은 0. */
export function effectiveWeights(input: Pick<V3Input, "preferences" | "weights">): V3Weights {
  const { preferences: p, weights: w } = input;
  return {
    lunch: p.avoidLunchDouble ? w.lunch : 0,
    triple: p.avoidTriplePeriod ? w.triple : 0,
    sameDay: p.avoidSameDaySubject && p.sameDaySubjectBans.length > 0 ? w.sameDay : 0,
  };
}

type RawDocs = {
  teachers?: Pick<TeachersDocument, "teachers"> | null;
  subjects?: Pick<SubjectsDocument, "subjects"> | null;
  daySchedule?: Pick<DayScheduleDocument, "grades" | "classCounts"> | null;
  setBlocks?: Partial<Pick<SetBlocksDocument, "cells" | "partialCells" | "teacherAssignments">> | null;
  subjectBlocks?: Pick<SubjectBlocksDocument, "cells"> | null;
  constraints?: Pick<TeacherConstraintsDocument, "forbiddenSlots"> | null;
  preferences?: (Partial<GenerationPreferences> & { v3Weights?: unknown }) | null;
};

/**
 * 저장 문서들로 v3 입력을 만든다. 기존 생성 API와 같은 정리·필터 함수를 거쳐
 * v3 해석이 실제 저장 데이터와 어긋나지 않게 한다.
 */
export function buildV3Input(docs: RawDocs): V3Input {
  const teachers = sanitizeTeachers(ensureTeachers(docs.teachers?.teachers ?? createDefaultTeachers()));
  const subjects = sanitizeGradeSubjects(ensureGradeSubjects(docs.subjects?.subjects ?? createDefaultGradeSubjects()));
  const schedules = parseGradeDaySchedules(docs.daySchedule?.grades) ?? createDefaultGradeDaySchedules();
  const classCounts = parseClassCounts(docs.daySchedule?.classCounts) ?? createDefaultClassCounts();
  const catalog = catalogGradeSets(subjects, classCounts);
  return {
    teachers,
    subjects,
    classCounts,
    schedules,
    fixedWholeCells: filterCellsToCatalog(docs.setBlocks?.cells ?? [], schedules, catalog),
    fixedPartialCells: filterPartialCellsToCatalog(docs.setBlocks?.partialCells ?? [], schedules, catalog),
    teacherAssignments: docs.setBlocks?.teacherAssignments ?? [],
    pins: filterSubjectBlocksToAssignments(docs.subjectBlocks?.cells ?? [], teachers, subjects, classCounts, schedules),
    forbiddenSlots: filterForbiddenSlots(docs.constraints?.forbiddenSlots ?? [], teachers, schedules),
    preferences: normalizeGenerationPreferences(docs.preferences),
    weights: parseV3Weights(docs.preferences?.v3Weights),
  };
}

export async function loadV3Input(db: Db, termId: string): Promise<V3Input> {
  const [teachers, subjects, daySchedule, setBlocks, subjectBlocks, constraints, preferences] = await Promise.all([
    db.collection<TeachersDocument>("teachers").findOne({ termId }),
    db.collection<SubjectsDocument>("subjects").findOne({ termId }),
    db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
    db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
    db.collection<SubjectBlocksDocument>("subjectBlocks").findOne({ termId }),
    db.collection<TeacherConstraintsDocument>("teacherConstraints").findOne({ termId }),
    db.collection<GenerationPreferencesDocument & { v3Weights?: unknown }>("generationPreferences").findOne({ termId }),
  ]);
  return buildV3Input({ teachers, subjects, daySchedule, setBlocks, subjectBlocks, constraints, preferences });
}

/** 키 순서에 상관없이 같은 내용이면 같은 문자열 (배열 순서는 유지: 반별 시수처럼 순서가 뜻을 가짐) */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * 입력 지문. 생성 결과에 영향을 주는 입력만 넣는다 (docs/v3-data-api-design.md 3.4).
 * 칸 목록(고정 SET·순환 지정·선 수업·배정 불가·금지 과목)은 순서가 뜻이 없으므로 정렬해서 비교한다.
 */
export function v3InputHash(input: V3Input): string {
  const asSet = <T,>(xs: T[]) => xs.map(canonical).sort();
  const material = {
    v: 1,
    teachers: input.teachers,
    subjects: input.subjects,
    classCounts: input.classCounts,
    schedules: input.schedules,
    fixedWholeCells: asSet(input.fixedWholeCells),
    fixedPartialCells: asSet(input.fixedPartialCells),
    teacherAssignments: asSet(input.teacherAssignments),
    pins: asSet(input.pins),
    forbiddenSlots: asSet(input.forbiddenSlots),
    preferences: { ...input.preferences, sameDaySubjectBans: asSet(input.preferences.sameDaySubjectBans) },
    weights: effectiveWeights(input),
  };
  return createHash("sha256").update(canonical(material)).digest("hex");
}
