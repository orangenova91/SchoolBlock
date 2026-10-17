import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  formatSameSetInternalTeacherConflict,
  partialSetsPlacementComplete,
  sameSetInternalTeacherConflicts,
  wholeSetsPlacementComplete,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { getAccountId } from "@/lib/session";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { findOwnedTerm } from "@/lib/term-access";
import { buildSeedTimetableCells, generateTimetable } from "@/lib/timetable";
import { runPlacementCheckCached } from "@/lib/timetable-check-cache";
import {
  effectiveMinUnplaced,
  isPlacementBlocked,
} from "@/lib/timetable-exact-check";
import { explainUnplaced } from "@/lib/timetable-feasibility";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type GenerationPreferencesDocument,
  type SetBlocksDocument,
  type SubjectBlocksDocument,
  type SubjectsDocument,
  type TeacherConstraintsDocument,
  type TeachersDocument,
  type TimetableDocument,
} from "@/lib/types";
import { normalizeV2Weights } from "@/lib/v2-weights";

/**
 * v2 생성은 정확 판정(최대 20초, 보통 저장값 재사용) + 교환 개선(최대 30초)이라 배포 플랫폼의
 * 기본 실행 시간 제한보다 길 수 있다. v1에는 상한만 넓어질 뿐 동작 변화가 없다.
 */
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ termId: string }>;
};

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export async function GET(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId } = await context.params;

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    const isV2 = term.logicVersion === "v2";
    const [
      doc,
      teachersDoc,
      subjectsDoc,
      scheduleDoc,
      setBlocksDoc,
      subjectBlocksDoc,
      v2PreferencesDoc,
    ] = await Promise.all([
      db.collection<TimetableDocument>("timetables").findOne({ termId }),
      db.collection<TeachersDocument>("teachers").findOne({ termId }),
      db.collection<SubjectsDocument>("subjects").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
      db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
      db
        .collection<SubjectBlocksDocument>("subjectBlocks")
        .findOne({ termId }),
      isV2
        ? db
            .collection<GenerationPreferencesDocument>("generationPreferences")
            .findOne({ termId })
        : null,
    ]);

    // Structural check, independent of whether a timetable has been
    // generated yet: a teacher required by two different subjects of the
    // same SET (different home rooms) at the same occurrence is physically
    // impossible. Surfaced here so it's visible as soon as the page loads,
    // even before hitting "시간표 배치".
    const teachers = sanitizeTeachers(
      ensureTeachers(teachersDoc?.teachers ?? createDefaultTeachers()),
    );
    const subjects = sanitizeGradeSubjects(
      ensureGradeSubjects(subjectsDoc?.subjects ?? createDefaultGradeSubjects()),
    );
    const schedules =
      parseGradeDaySchedules(scheduleDoc?.grades) ??
      createDefaultGradeDaySchedules();
    const classCounts =
      parseClassCounts(scheduleDoc?.classCounts) ?? createDefaultClassCounts();
    const catalog = catalogGradeSets(subjects, classCounts);
    const wholeCells = filterCellsToCatalog(
      setBlocksDoc?.cells ?? [],
      schedules,
      catalog,
    );
    const partialCells = filterPartialCellsToCatalog(
      setBlocksDoc?.partialCells ?? [],
      schedules,
      catalog,
    );
    const internalConflicts = sameSetInternalTeacherConflicts(
      wholeCells,
      partialCells,
      teachers,
      catalog,
      setBlocksDoc?.teacherAssignments ?? [],
    );
    const seedCells = buildSeedTimetableCells({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
      subjectBlocks: subjectBlocksDoc?.cells ?? [],
    });

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
        logicVersion: term.logicVersion ?? null,
      },
      // v2 사전 검사는 화면이 열린 뒤 브라우저가 /timetable/feasibility로 요청한다.
      v2Weights: isV2 ? normalizeV2Weights(v2PreferencesDoc?.v2Weights) : null,
      status: doc?.status ?? "idle",
      cells: doc?.cells ?? [],
      seedCells,
      unplaced: doc?.unplaced ?? [],
      generatedAt: doc?.generatedAt ?? null,
      message: doc?.message ?? null,
      lunchDoubleCount: doc?.lunchDoubleCount ?? 0,
      lunchDoubles: doc?.lunchDoubles ?? [],
      tripleRunCount: doc?.tripleRunCount ?? 0,
      tripleRuns: doc?.tripleRuns ?? [],
      lunchStatus: doc?.lunchStatus ?? "idle",
      lunchMessage: doc?.lunchMessage ?? null,
      lunchGeneratedAt: doc?.lunchGeneratedAt ?? null,
      lunchLockCount: doc?.lunchLockCells?.length ?? 0,
      sameDaySubjectViolationCount: doc?.sameDaySubjectViolationCount ?? 0,
      sameDaySubjectViolations: doc?.sameDaySubjectViolations ?? [],
      sameDaySubjectStatus: doc?.sameDaySubjectStatus ?? "idle",
      sameDaySubjectMessage: doc?.sameDaySubjectMessage ?? null,
      sameDaySubjectGeneratedAt: doc?.sameDaySubjectGeneratedAt ?? null,
      sameDaySubjectLockCount: doc?.sameDaySubjectLockCells?.length ?? 0,
      sameSetTeacherConflictCount: internalConflicts.length,
      sameSetTeacherConflictMessages: internalConflicts.map((c) =>
        formatSameSetInternalTeacherConflict(c),
      ),
    });
  } catch (error) {
    console.error("timetable GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId } = await context.params;

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const db = await getDb();
    // 작업본만 초기화: 배치 결과와 점심시간·동일 교과 우선 배치 잠금을 지운다.
    // 확정 버전(timetableVersions)은 남긴다.
    await db.collection<TimetableDocument>("timetables").deleteOne({ termId });

    return NextResponse.json({ termId, status: "idle" });
  } catch (error) {
    console.error("timetable DELETE failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId } = await context.params;

  try {
    const term = await findOwnedTerm(termId, accountId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    // v3 시간표는 v3 생성 화면(작업 대기열)에서 만든다
    if (term.logicVersion === "v3") {
      return NextResponse.json({ error: "v3 시간표는 v3 생성 화면에서 만들어 주세요." }, { status: 400 });
    }

    const db = await getDb();
    const [
      teachersDoc,
      subjectsDoc,
      scheduleDoc,
      setBlocksDoc,
      subjectBlocksDoc,
      constraintsDoc,
      preferencesDoc,
      existingTimetableDoc,
    ] = await Promise.all([
      db.collection<TeachersDocument>("teachers").findOne({ termId }),
      db.collection<SubjectsDocument>("subjects").findOne({ termId }),
      db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
      db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
      db
        .collection<SubjectBlocksDocument>("subjectBlocks")
        .findOne({ termId }),
      db
        .collection<TeacherConstraintsDocument>("teacherConstraints")
        .findOne({ termId }),
      db
        .collection<GenerationPreferencesDocument>("generationPreferences")
        .findOne({ termId }),
      db.collection<TimetableDocument>("timetables").findOne({ termId }),
    ]);

    const teachers = sanitizeTeachers(
      ensureTeachers(teachersDoc?.teachers ?? createDefaultTeachers()),
    );
    const subjects = sanitizeGradeSubjects(
      ensureGradeSubjects(subjectsDoc?.subjects ?? createDefaultGradeSubjects()),
    );
    const schedules =
      parseGradeDaySchedules(scheduleDoc?.grades) ??
      createDefaultGradeDaySchedules();
    const classCounts =
      parseClassCounts(scheduleDoc?.classCounts) ?? createDefaultClassCounts();
    const catalog = catalogGradeSets(subjects, classCounts);

    const wholeCells = filterCellsToCatalog(
      setBlocksDoc?.cells ?? [],
      schedules,
      catalog,
    );
    const partialCells = filterPartialCellsToCatalog(
      setBlocksDoc?.partialCells ?? [],
      schedules,
      catalog,
    );
    // 점심시간 우선 배치·동일 교과 우선 배치(1단계) 결과가 저장되어 있으면
    // 교과 블록과 함께 고정 셀로 취급해, "남은 시간 시간표 배치"가 그 위에서만
    // 나머지를 채우게 한다.
    const subjectBlocks = filterSubjectBlocksToAssignments(
      [
        ...(subjectBlocksDoc?.cells ?? []),
        ...(existingTimetableDoc?.sameDaySubjectLockCells ?? []),
        ...(existingTimetableDoc?.lunchLockCells ?? []),
      ],
      teachers,
      subjects,
      classCounts,
      schedules,
    );
    const forbiddenSlots = filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    );
    const preferences = normalizeGenerationPreferences(preferencesDoc);

    if (!wholeSetsPlacementComplete(wholeCells, catalog)) {
      return NextResponse.json(
        { error: "전학년 SET 블록을 모두 배치한 뒤 생성해 주세요." },
        { status: 400 },
      );
    }
    if (!partialSetsPlacementComplete(partialCells, catalog)) {
      return NextResponse.json(
        { error: "부분 SET 블록을 모두 배치한 뒤 생성해 주세요." },
        { status: 400 },
      );
    }

    const generateInput = {
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
      subjectBlocks,
      forbiddenSlots,
      preferences,
      timeLimitMs: 15_000,
      restarts: 24,
    };
    // v2 시간표(비교 검토용)는 우선 배치 버튼을 쓰지 않는다. 저장된 우선 배치
    // 잠금은 무시하고, 사용자가 칠한 선 수업만 고정한 채 추가 조건을 생성
    // 안에서 자동으로 반영한다.
    const isV2 = term.logicVersion === "v2";
    const pinnedSubjectBlocks = filterSubjectBlocksToAssignments(
      subjectBlocksDoc?.cells ?? [],
      teachers,
      subjects,
      classCounts,
      schedules,
    );
    // v2: 모든 수업이 배치될 수 없는 조건이면 배치 자체를 진행하지 않는다.
    // 저장된 이전 결과도 건드리지 않는다. 배치 가능하면 판정이 찾은 미배치
    // 0 배치안을 초기 배치로 쓴다.
    // 사전 검사와 같은 입력이면 저장된 판정을 다시 쓴다 (조건이 그대로면 한 번만 판정).
    const check = isV2
      ? await runPlacementCheckCached(db, termId, {
          teachers,
          subjects,
          classCounts,
          schedules,
          wholeCells,
          partialCells,
          teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
          subjectBlocks: pinnedSubjectBlocks,
          forbiddenSlots,
        })
      : null;
    const feasibility = check
      ? {
          ...check.report,
          checkedAt: check.checkedAt.toISOString(),
          cached: check.cached,
        }
      : null;
    if (feasibility && isPlacementBlocked(feasibility)) {
      return NextResponse.json(
        {
          error: `사전 검사를 통과하지 못해 배치하지 않았습니다. 현재 조건에서는 최소 ${effectiveMinUnplaced(feasibility)}교시가 배치될 수 없습니다. 선 수업·배정 불가·SET 배치를 조정한 뒤 다시 검사해 주세요.`,
          feasibility,
        },
        { status: 409 },
      );
    }
    const generated = isV2
      ? generateTimetableV2({
          ...generateInput,
          // v2: 점수가 더 내려가지 않을 때까지 반복하되 최대 30초.
          timeLimitMs: 30_000,
          subjectBlocks: pinnedSubjectBlocks,
          pinnedSubjectBlocks,
          v2: {
            weights: normalizeV2Weights(preferencesDoc?.v2Weights),
            initialCommonCells:
              feasibility?.exact.status === "feasible"
                ? check?.solutionCells
                : undefined,
          },
        })
      : generateTimetable(generateInput);
    const unplacedCount = generated.unplaced.reduce(
      (sum, u) => sum + u.remaining,
      0,
    );
    const result =
      feasibility && unplacedCount > 0
        ? {
            ...generated,
            message: `${generated.message}\n${explainUnplaced(unplacedCount, {
              ...feasibility,
              minUnplaced: effectiveMinUnplaced(feasibility),
            })}`,
          }
        : generated;

    const now = new Date();
    const doc: TimetableDocument = {
      termId,
      status: result.status,
      cells: result.cells,
      unplaced: result.unplaced,
      generatedAt: now,
      updatedAt: now,
      message: result.message,
      lunchDoubleCount: result.lunchDoubleCount,
      lunchDoubles: result.lunchDoubles,
      tripleRunCount: result.tripleRunCount,
      tripleRuns: result.tripleRuns,
      sameDaySubjectViolationCount: result.sameDaySubjectViolationCount,
      sameDaySubjectViolations: result.sameDaySubjectViolations,
    };

    await db.collection<TimetableDocument>("timetables").updateOne(
      { termId },
      { $set: doc },
      { upsert: true },
    );

    return NextResponse.json({
      termId,
      status: doc.status,
      cells: doc.cells,
      unplaced: doc.unplaced,
      generatedAt: doc.generatedAt,
      message: doc.message,
      attemptsUsed: result.attemptsUsed,
      lunchLockUsed: (existingTimetableDoc?.lunchLockCells?.length ?? 0) > 0,
      lunchDoubleCount: doc.lunchDoubleCount,
      lunchDoubles: doc.lunchDoubles,
      tripleRunCount: doc.tripleRunCount,
      tripleRuns: doc.tripleRuns,
      sameDaySubjectLockUsed:
        (existingTimetableDoc?.sameDaySubjectLockCells?.length ?? 0) > 0,
      sameDaySubjectViolationCount: doc.sameDaySubjectViolationCount,
      sameDaySubjectViolations: doc.sameDaySubjectViolations,
      feasibility,
    });
  } catch (error) {
    console.error("timetable POST generate failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
