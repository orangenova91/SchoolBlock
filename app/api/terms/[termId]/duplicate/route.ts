import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import type {
  DayScheduleDocument,
  GenerationPreferencesDocument,
  SetBlocksDocument,
  SubjectBlocksDocument,
  SubjectsDocument,
  TeacherConstraintsDocument,
  TeachersDocument,
  TermDocument,
} from "@/lib/types";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

function invalidTermIdResponse() {
  return NextResponse.json(
    { error: "올바르지 않은 학기 ID입니다." },
    { status: 400 },
  );
}

/** "이름 (복사본)" → 이미 있으면 "이름 (복사본 2)", "이름 (복사본 3)" … 순으로 빈 이름을 찾는다. */
async function findUniqueTimetableName(
  db: Db,
  ownerId: string,
  baseName: string,
): Promise<string> {
  const terms = db.collection<TermDocument>("terms");
  let attempt = 1;
  while (true) {
    const candidate =
      attempt === 1 ? `${baseName} (복사본)` : `${baseName} (복사본 ${attempt})`;
    const existing = await terms.findOne({ ownerId, timetableName: candidate });
    if (!existing) return candidate;
    attempt += 1;
  }
}

/**
 * 학기(term)의 설정값만 복제해 새 학기를 만든다.
 * 복제 대상: 교과/교사/학반·요일/학반 세트/교과 블록/교사 제약조건/생성 선호도.
 * 생성된 시간표 결과(timetables 컬렉션)는 복제하지 않는다 — 새 학기는 새로 생성하는 게 자연스럽기 때문.
 */
export async function POST(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { termId } = await context.params;

  if (!ObjectId.isValid(termId)) return invalidTermIdResponse();

  try {
    const db = await getDb();
    const terms = db.collection<TermDocument>("terms");
    const sourceTerm = await terms.findOne({
      _id: new ObjectId(termId),
      ownerId: accountId,
    });

    if (!sourceTerm) {
      return NextResponse.json(
        { error: "학기 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

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

    const timetableName = await findUniqueTimetableName(
      db,
      accountId,
      sourceTerm.timetableName || "(이름 없음)",
    );

    const now = new Date();
    const newTermDoc: TermDocument = {
      timetableName,
      school: sourceTerm.school,
      academicYear: sourceTerm.academicYear,
      semester: sourceTerm.semester,
      ownerId: accountId,
      createdAt: now,
    };

    const insertResult = await terms.insertOne(newTermDoc);
    const newTermId = insertResult.insertedId.toString();

    const copyJobs: Promise<unknown>[] = [];

    if (teachersDoc) {
      copyJobs.push(
        db.collection<TeachersDocument>("teachers").insertOne({
          termId: newTermId,
          teachers: teachersDoc.teachers,
          updatedAt: now,
        }),
      );
    }
    if (subjectsDoc) {
      copyJobs.push(
        db.collection<SubjectsDocument>("subjects").insertOne({
          termId: newTermId,
          subjects: subjectsDoc.subjects,
          updatedAt: now,
        }),
      );
    }
    if (scheduleDoc) {
      copyJobs.push(
        db.collection<DayScheduleDocument>("daySchedules").insertOne({
          termId: newTermId,
          classCounts: scheduleDoc.classCounts,
          grades: scheduleDoc.grades,
          updatedAt: now,
        }),
      );
    }
    if (preferencesDoc) {
      copyJobs.push(
        db
          .collection<GenerationPreferencesDocument>("generationPreferences")
          .insertOne({
            termId: newTermId,
            avoidLunchDouble: preferencesDoc.avoidLunchDouble,
            lunchAfterPeriod: preferencesDoc.lunchAfterPeriod,
            avoidTriplePeriod: preferencesDoc.avoidTriplePeriod,
            avoidSameDaySubject: preferencesDoc.avoidSameDaySubject,
            sameDaySubjectBans: preferencesDoc.sameDaySubjectBans,
            updatedAt: now,
          }),
      );
    }
    if (setBlocksDoc) {
      copyJobs.push(
        db.collection<SetBlocksDocument>("setBlocks").insertOne({
          termId: newTermId,
          cells: setBlocksDoc.cells,
          partialCells: setBlocksDoc.partialCells,
          teacherAssignments: setBlocksDoc.teacherAssignments,
          updatedAt: now,
        }),
      );
    }
    if (subjectBlocksDoc) {
      copyJobs.push(
        db.collection<SubjectBlocksDocument>("subjectBlocks").insertOne({
          termId: newTermId,
          cells: subjectBlocksDoc.cells,
          updatedAt: now,
        }),
      );
    }
    if (constraintsDoc) {
      copyJobs.push(
        db.collection<TeacherConstraintsDocument>("teacherConstraints").insertOne({
          termId: newTermId,
          forbiddenSlots: constraintsDoc.forbiddenSlots,
          updatedAt: now,
        }),
      );
    }

    await Promise.all(copyJobs);

    return NextResponse.json(
      {
        id: newTermId,
        timetableName,
        school: newTermDoc.school,
        academicYear: newTermDoc.academicYear,
        semester: newTermDoc.semester,
        createdAt: now,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("term duplicate failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
