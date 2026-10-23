import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { TermDocument } from "@/lib/types";

/**
 * `ownerId`가 소유한 학기만 찾는다. 다른 계정 소유 학기는 존재하지 않는 것과
 * 동일하게(null) 처리해, 다른 학교의 학기 존재 여부조차 노출하지 않는다.
 */
export async function findOwnedTerm(
  termId: string,
  ownerId: string,
): Promise<TermDocument | null> {
  if (!ObjectId.isValid(termId)) return null;
  const db = await getDb();
  return db.collection<TermDocument>("terms").findOne({
    _id: new ObjectId(termId),
    ownerId,
  });
}

/** 시간표 생성 페이지에 들어왔음을 기록해 스테퍼 앞·뒤 이동을 연다. 더 먼 장(v3 최종 시간표)을 연 기록은 낮추지 않는다. */
export async function markTermReachedTimetable(
  termId: string,
  ownerId: string,
): Promise<void> {
  if (!ObjectId.isValid(termId)) return;
  const db = await getDb();
  await db.collection<TermDocument>("terms").updateOne(
    { _id: new ObjectId(termId), ownerId },
    { $max: { maxReachedChapter: 7 } },
  );
}

export async function setTermMaxReachedChapter(
  termId: string,
  ownerId: string,
  chapterIndex: number,
): Promise<void> {
  if (!ObjectId.isValid(termId)) return;
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex > 8) {
    return;
  }
  const db = await getDb();
  await db.collection<TermDocument>("terms").updateOne(
    { _id: new ObjectId(termId), ownerId },
    { $set: { maxReachedChapter: chapterIndex } },
  );
}
