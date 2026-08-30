import { ObjectId, type Db } from "mongodb";
import type { AccountDocument, TermDocument } from "@/lib/types";

export const TERM_CHILD_COLLECTIONS = [
  "teachers",
  "subjects",
  "daySchedules",
  "generationPreferences",
  "setBlocks",
  "subjectBlocks",
  "teacherConstraints",
  "timetables",
  "timetableVersions",
] as const;

export async function deleteTermChildren(
  db: Db,
  termIds: string[],
): Promise<void> {
  if (termIds.length === 0) return;
  await Promise.all(
    TERM_CHILD_COLLECTIONS.map((name) =>
      db.collection(name).deleteMany({ termId: { $in: termIds } }),
    ),
  );
}

export async function countTermsForOwners(
  db: Db,
  ownerIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ownerIds.length === 0) return counts;

  const rows = await db
    .collection<TermDocument>("terms")
    .aggregate<{ _id: string; count: number }>([
      { $match: { ownerId: { $in: ownerIds } } },
      { $group: { _id: "$ownerId", count: { $sum: 1 } } },
    ])
    .toArray();

  for (const row of rows) counts.set(row._id, row.count);
  return counts;
}

/** 계정들이 가진 학기·딸린 문서와 계정 문서를 지운다. */
export async function deleteAccountsAndOwnedData(
  db: Db,
  accountObjectIds: ObjectId[],
): Promise<{ termCount: number }> {
  if (accountObjectIds.length === 0) return { termCount: 0 };

  const ownerIds = accountObjectIds.map((id) => id.toString());
  const terms = db.collection<TermDocument>("terms");
  const ownedTerms = await terms.find({ ownerId: { $in: ownerIds } }).toArray();
  const termIds = ownedTerms.map((term) => term._id.toString());

  await deleteTermChildren(db, termIds);
  if (ownedTerms.length > 0) {
    await terms.deleteMany({ ownerId: { $in: ownerIds } });
  }
  await db.collection<AccountDocument>("accounts").deleteMany({
    _id: { $in: accountObjectIds },
  });

  return { termCount: ownedTerms.length };
}
