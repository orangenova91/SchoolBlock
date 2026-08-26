import type { Db, ObjectId } from "mongodb";
import type {
  DayScheduleDocument,
  GenerationPreferences,
  GradeDaySchedules,
  GradeClassCounts,
  GradeSubjects,
  Semester,
  SetBlockCell,
  SetTeacherAssignment,
  SubjectBlockCell,
  SubjectBlocksDocument,
  SubjectsDocument,
  TeacherConstraintsDocument,
  TeacherForbiddenSlot,
  Teacher,
  TeachersDocument,
  TermDocument,
  GenerationPreferencesDocument,
  SetBlocksDocument,
} from "@/lib/types";

/**
 * 학기(term)에 딸린 설정값 묶음. 생성된 시간표 결과(timetables 컬렉션)는
 * 포함하지 않는다 — 다운로드/복제 모두 "설정만 재사용" 용도이기 때문.
 */
export type TermBundle = {
  version: 1;
  timetableName: string;
  academicYear: number;
  semester: Semester;
  teachers?: Teacher[];
  subjects?: GradeSubjects;
  daySchedule?: {
    classCounts: GradeClassCounts;
    grades: GradeDaySchedules;
  };
  preferences?: GenerationPreferences;
  setBlocks?: {
    cells: SetBlockCell[];
    partialCells?: SetBlockCell[];
    teacherAssignments?: SetTeacherAssignment[];
  };
  subjectBlocks?: {
    cells: SubjectBlockCell[];
  };
  teacherConstraints?: {
    forbiddenSlots: TeacherForbiddenSlot[];
  };
};

/** 주어진 학기(term)에 딸린 설정 문서들을 모아 이식 가능한 번들로 만든다. */
export async function collectTermBundle(
  db: Db,
  term: TermDocument & { _id: ObjectId },
): Promise<TermBundle> {
  const termId = term._id.toString();

  const [
    teachersDoc,
    subjectsDoc,
    scheduleDoc,
    preferencesDoc,
    setBlocksDoc,
    subjectBlocksDoc,
    constraintsDoc,
  ] = await Promise.all([
    db.collection<TeachersDocument>("teachers").findOne({ termId }),
    db.collection<SubjectsDocument>("subjects").findOne({ termId }),
    db.collection<DayScheduleDocument>("daySchedules").findOne({ termId }),
    db
      .collection<GenerationPreferencesDocument>("generationPreferences")
      .findOne({ termId }),
    db.collection<SetBlocksDocument>("setBlocks").findOne({ termId }),
    db.collection<SubjectBlocksDocument>("subjectBlocks").findOne({ termId }),
    db
      .collection<TeacherConstraintsDocument>("teacherConstraints")
      .findOne({ termId }),
  ]);

  return {
    version: 1,
    timetableName: term.timetableName,
    academicYear: term.academicYear,
    semester: term.semester,
    teachers: teachersDoc?.teachers,
    subjects: subjectsDoc?.subjects,
    daySchedule: scheduleDoc
      ? { classCounts: scheduleDoc.classCounts, grades: scheduleDoc.grades }
      : undefined,
    preferences: preferencesDoc
      ? {
          avoidLunchDouble: preferencesDoc.avoidLunchDouble,
          lunchAfterPeriod: preferencesDoc.lunchAfterPeriod,
          avoidTriplePeriod: preferencesDoc.avoidTriplePeriod,
          avoidSameDaySubject: preferencesDoc.avoidSameDaySubject,
          sameDaySubjectBans: preferencesDoc.sameDaySubjectBans,
        }
      : undefined,
    setBlocks: setBlocksDoc
      ? {
          cells: setBlocksDoc.cells,
          partialCells: setBlocksDoc.partialCells,
          teacherAssignments: setBlocksDoc.teacherAssignments,
        }
      : undefined,
    subjectBlocks: subjectBlocksDoc ? { cells: subjectBlocksDoc.cells } : undefined,
    teacherConstraints: constraintsDoc
      ? { forbiddenSlots: constraintsDoc.forbiddenSlots }
      : undefined,
  };
}

/**
 * 계정 소유 범위(ownerId) 안에서 `makeCandidate(0)`부터 순서대로 비어있는
 * 시간표명을 찾는다. 복제는 항상 "(복사본)" 접미사로 시작하고, 가져오기는
 * 원래 이름이 비어있으면 그대로 쓰고 겹칠 때만 접미사를 붙인다 — 호출부에서
 * `makeCandidate`로 이 차이를 결정한다.
 */
export async function findAvailableTimetableName(
  db: Db,
  ownerId: string,
  makeCandidate: (attempt: number) => string,
): Promise<string> {
  const terms = db.collection<TermDocument>("terms");
  let attempt = 0;
  while (true) {
    const candidate = makeCandidate(attempt);
    const existing = await terms.findOne({ ownerId, timetableName: candidate });
    if (!existing) return candidate;
    attempt += 1;
  }
}

export type InsertTermBundleMeta = {
  ownerId: string;
  school: string;
  timetableName: string;
  academicYear: number;
  semester: Semester;
};

/** 번들 데이터로 새 학기(term) + 딸린 설정 문서들을 함께 생성한다. */
export async function insertTermBundle(
  db: Db,
  bundle: Omit<TermBundle, "version" | "timetableName" | "academicYear" | "semester">,
  meta: InsertTermBundleMeta,
): Promise<TermDocument & { _id: ObjectId }> {
  const now = new Date();
  const terms = db.collection<TermDocument>("terms");

  const newTermDoc: TermDocument = {
    timetableName: meta.timetableName,
    school: meta.school,
    academicYear: meta.academicYear,
    semester: meta.semester,
    ownerId: meta.ownerId,
    createdAt: now,
  };

  const insertResult = await terms.insertOne(newTermDoc);
  const newTermId = insertResult.insertedId.toString();

  const copyJobs: Promise<unknown>[] = [];

  if (bundle.teachers) {
    copyJobs.push(
      db.collection<TeachersDocument>("teachers").insertOne({
        termId: newTermId,
        teachers: bundle.teachers,
        updatedAt: now,
      }),
    );
  }
  if (bundle.subjects) {
    copyJobs.push(
      db.collection<SubjectsDocument>("subjects").insertOne({
        termId: newTermId,
        subjects: bundle.subjects,
        updatedAt: now,
      }),
    );
  }
  if (bundle.daySchedule) {
    copyJobs.push(
      db.collection<DayScheduleDocument>("daySchedules").insertOne({
        termId: newTermId,
        classCounts: bundle.daySchedule.classCounts,
        grades: bundle.daySchedule.grades,
        updatedAt: now,
      }),
    );
  }
  if (bundle.preferences) {
    copyJobs.push(
      db
        .collection<GenerationPreferencesDocument>("generationPreferences")
        .insertOne({
          termId: newTermId,
          avoidLunchDouble: bundle.preferences.avoidLunchDouble,
          lunchAfterPeriod: bundle.preferences.lunchAfterPeriod,
          avoidTriplePeriod: bundle.preferences.avoidTriplePeriod,
          avoidSameDaySubject: bundle.preferences.avoidSameDaySubject,
          sameDaySubjectBans: bundle.preferences.sameDaySubjectBans,
          updatedAt: now,
        }),
    );
  }
  if (bundle.setBlocks) {
    copyJobs.push(
      db.collection<SetBlocksDocument>("setBlocks").insertOne({
        termId: newTermId,
        cells: bundle.setBlocks.cells,
        partialCells: bundle.setBlocks.partialCells,
        teacherAssignments: bundle.setBlocks.teacherAssignments,
        updatedAt: now,
      }),
    );
  }
  if (bundle.subjectBlocks) {
    copyJobs.push(
      db.collection<SubjectBlocksDocument>("subjectBlocks").insertOne({
        termId: newTermId,
        cells: bundle.subjectBlocks.cells,
        updatedAt: now,
      }),
    );
  }
  if (bundle.teacherConstraints) {
    copyJobs.push(
      db.collection<TeacherConstraintsDocument>("teacherConstraints").insertOne({
        termId: newTermId,
        forbiddenSlots: bundle.teacherConstraints.forbiddenSlots,
        updatedAt: now,
      }),
    );
  }

  await Promise.all(copyJobs);

  return { ...newTermDoc, _id: insertResult.insertedId };
}
