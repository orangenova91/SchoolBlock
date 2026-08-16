import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  normalizeGenerationPreferences,
  parseGenerationPreferences,
} from "@/lib/generation-preferences";
import { getDb } from "@/lib/mongodb";
import type {
  GenerationPreferencesDocument,
  TermDocument,
  TimetableDocument,
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

async function findTerm(termId: string) {
  if (!ObjectId.isValid(termId)) return null;
  const db = await getDb();
  return db.collection<TermDocument>("terms").findOne({
    _id: new ObjectId(termId),
  });
}

export async function GET(_request: Request, context: RouteContext) {
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

    const db = await getDb();
    const doc = await db
      .collection<GenerationPreferencesDocument>("generationPreferences")
      .findOne({ termId });

    const preferences = normalizeGenerationPreferences(doc);

    return NextResponse.json({
      term: {
        id: termId,
        timetableName: term.timetableName,
        school: term.school,
        academicYear: term.academicYear,
        semester: term.semester,
      },
      preferences,
    });
  } catch (error) {
    console.error("generation-preferences GET failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "요청 본문이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const raw =
      body && typeof body === "object" && "preferences" in body
        ? (body as { preferences: unknown }).preferences
        : body;

    const parsed = parseGenerationPreferences(raw);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "추가 조건이 올바르지 않습니다. 스위치와 점심 교시(1–9)를 확인해 주세요.",
        },
        { status: 400 },
      );
    }

    const preferences = normalizeGenerationPreferences(parsed);
    const now = new Date();
    const db = await getDb();
    await db
      .collection<GenerationPreferencesDocument>("generationPreferences")
      .updateOne(
        { termId },
        {
          $set: {
            termId,
            avoidLunchDouble: preferences.avoidLunchDouble,
            lunchAfterPeriod: preferences.lunchAfterPeriod,
            avoidTriplePeriod: preferences.avoidTriplePeriod,
            avoidSameDaySubject: preferences.avoidSameDaySubject,
            sameDaySubjectBans: preferences.sameDaySubjectBans,
            updatedAt: now,
          },
        },
        { upsert: true },
      );

    if (!preferences.avoidLunchDouble) {
      // 점심 연강 배제를 끄면, 이전에 "점심시간 우선 배치"로 저장해 둔 잠금이
      // "시간표 배치"에 조용히 계속 적용되지 않도록 함께 지운다.
      await db.collection<TimetableDocument>("timetables").updateOne(
        { termId },
        {
          $unset: {
            lunchLockCells: "",
            lunchStatus: "",
            lunchMessage: "",
            lunchGeneratedAt: "",
          },
          $set: { updatedAt: now },
        },
      );
    }

    if (!preferences.avoidSameDaySubject) {
      // 동일 교과 같은 날 배치 금지를 끄면, 이전에 "동일 교과 우선 배치"로
      // 저장해 둔 잠금도 함께 지운다.
      await db.collection<TimetableDocument>("timetables").updateOne(
        { termId },
        {
          $unset: {
            sameDaySubjectLockCells: "",
            sameDaySubjectStatus: "",
            sameDaySubjectMessage: "",
            sameDaySubjectGeneratedAt: "",
          },
          $set: { updatedAt: now },
        },
      );
    }

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("generation-preferences PUT failed:", error);
    return NextResponse.json(
      {
        error:
          "로컬 MongoDB에 연결할 수 없습니다. mongod가 실행 중인지 확인해 주세요.",
      },
      { status: 503 },
    );
  }
}
