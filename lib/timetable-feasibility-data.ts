import type { Db } from "mongodb";
import { parseClassCounts, parseGradeDaySchedules } from "@/lib/day-schedule";
import {
  catalogGradeSets,
  filterCellsToCatalog,
  filterPartialCellsToCatalog,
} from "@/lib/set-blocks";
import { filterSubjectBlocksToAssignments } from "@/lib/subject-blocks";
import { ensureGradeSubjects, sanitizeGradeSubjects } from "@/lib/subjects";
import { filterForbiddenSlots } from "@/lib/teacher-constraints";
import { ensureTeachers, sanitizeTeachers } from "@/lib/teachers";
import type { FeasibilityInput } from "@/lib/timetable-feasibility";
import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createDefaultGradeSubjects,
  createDefaultTeachers,
  type DayScheduleDocument,
  type SetBlocksDocument,
  type SubjectBlocksDocument,
  type SubjectsDocument,
  type TeacherConstraintsDocument,
  type TeachersDocument,
} from "@/lib/types";

/**
 * v2 사전 검사용 입력을 DB에서 읽는다. 시간표 생성 API와 같은 정리·필터
 * 함수를 거쳐, 검사 결과가 실제 생성 조건과 어긋나지 않게 한다.
 */
export async function loadFeasibilityInput(
  db: Db,
  termId: string,
): Promise<FeasibilityInput> {
  const [
    teachersDoc,
    subjectsDoc,
    scheduleDoc,
    setBlocksDoc,
    subjectBlocksDoc,
    constraintsDoc,
  ] = await Promise.all([
    db.collection<TeachersDocument>("teachers").findOne({ termId }),
    db.collection<SubjectsDocument>("subjects").findOne({ termId }),
    db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
    db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
    db.collection<SubjectBlocksDocument>("subjectBlocks").findOne({ termId }),
    db
      .collection<TeacherConstraintsDocument>("teacherConstraints")
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

  return {
    teachers,
    subjects,
    classCounts,
    schedules,
    wholeCells: filterCellsToCatalog(setBlocksDoc?.cells ?? [], schedules, catalog),
    partialCells: filterPartialCellsToCatalog(
      setBlocksDoc?.partialCells ?? [],
      schedules,
      catalog,
    ),
    teacherAssignments: setBlocksDoc?.teacherAssignments ?? [],
    subjectBlocks: filterSubjectBlocksToAssignments(
      subjectBlocksDoc?.cells ?? [],
      teachers,
      subjects,
      classCounts,
      schedules,
    ),
    forbiddenSlots: filterForbiddenSlots(
      constraintsDoc?.forbiddenSlots ?? [],
      teachers,
      schedules,
    ),
  };
}
