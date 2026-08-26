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
