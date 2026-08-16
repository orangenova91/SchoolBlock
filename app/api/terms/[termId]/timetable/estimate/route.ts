import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import { normalizeGenerationPreferences } from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
  partialSetsPlacementComplete,
  wholeSetsPlacementComplete,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import { estimateTimetableSpace } from "@/lib/timetable";
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
  type TermDocument,
} from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

/** Local estimate can run several generates; allow longer wall time. */
export const maxDuration = 300;

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

async function findTerm(termId: string) {
  if (!ObjectId.isValid(termId)) return null;
  const db = await getDb();
  return db.collection<TermDocument>("terms").findOne({
    _id: new ObjectId(termId),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { termId } = await context.params;

  try {
    const term = await findTerm(termId);
    if (!term) {
      if (!ObjectId.isValid(termId)) return invalidTermIdResponse();
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    let samples = 5;
    try {
      const body = (await request.json()) as { samples?: unknown };
      if (typeof body.samples === "number" && Number.isFinite(body.samples)) {
        samples = Math.min(10, Math.max(1, Math.floor(body.samples)));
      }
    } catch {
      // empty body is fine
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
    const subjectBlocks = filterSubjectBlocksToAssignments(
      subjectBlocksDoc?.cells ?? [],
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
        { error: "전학년 SET 블록을 모두 배치한 뒤 추정해 주세요." },
        { status: 400 },
      );
    }
    if (!partialSetsPlacementComplete(partialCells, catalog)) {
      return NextResponse.json(
        { error: "부분 SET 블록을 모두 배치한 뒤 추정해 주세요." },
        { status: 400 },
      );
    }

    const estimate = estimateTimetableSpace({
      teachers,
      subjects,
      classCounts,
      schedules,
      wholeCells,
      partialCells,
      subjectBlocks,
      forbiddenSlots,
      preferences,
      samples,
      timeLimitMs: 10_000,
      restarts: 20,
    });

    console.log(
      "[timetable-estimate]",
      termId,
      JSON.stringify({
        upperBoundLabel: estimate.upperBound.upperBoundLabel,
        log10UpperBound: estimate.upperBound.log10UpperBound,
        lessonCount: estimate.upperBound.lessonCount,
        samples: estimate.samplesRun,
        completeCount: estimate.completeCount,
        distinctComplete: estimate.distinctComplete,
        failedCount: estimate.failedCount,
        elapsedMs: estimate.elapsedMs,
        hashes: estimate.distinctHashes,
      }),
    );

    return NextResponse.json({
      termId,
      ...estimate,
      // Does not persist; saved timetable is unchanged.
      persisted: false,
    });
  } catch (error) {
    console.error("timetable estimate failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
