import { ObjectId, type WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  AccountRequestDocument,
  AccountRequestStatus,
} from "@/lib/types";

const COLLECTION = "accountRequests";

export async function insertAccountRequest(
  doc: AccountRequestDocument,
): Promise<void> {
  const db = await getDb();
  await db.collection<AccountRequestDocument>(COLLECTION).insertOne(doc);
}

export async function findPendingAccountRequest(args: {
  schoolCode?: string;
  atptCode?: string;
  schoolName: string;
  sido: string;
}): Promise<AccountRequestDocument | null> {
  const db = await getDb();
  const col = db.collection<AccountRequestDocument>(COLLECTION);

  if (args.schoolCode && args.atptCode) {
    return col.findOne({
      status: "pending",
      schoolCode: args.schoolCode,
      atptCode: args.atptCode,
    });
  }

  return col.findOne({
    status: "pending",
    schoolName: args.schoolName,
    sido: args.sido,
  });
}

export async function findAccountRequestById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db
    .collection<AccountRequestDocument>(COLLECTION)
    .findOne({ _id: new ObjectId(id) });
}

export async function listAccountRequests(status?: AccountRequestStatus) {
  const db = await getDb();
  const filter = status ? { status } : {};
  return db
    .collection<AccountRequestDocument>(COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
}

export async function markAccountRequestApproved(args: {
  id: string;
  accountId: string;
  processedBy: string;
}): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<AccountRequestDocument>(COLLECTION).updateOne(
    { _id: new ObjectId(args.id), status: "pending" },
    {
      $set: {
        status: "approved",
        accountId: args.accountId,
        processedBy: args.processedBy,
        approvedAt: now,
        updatedAt: now,
      },
    },
  );
  return result.matchedCount === 1;
}

export async function markAccountRequestRejected(args: {
  id: string;
  processedBy: string;
  rejectReason?: string;
}): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const $set: Partial<AccountRequestDocument> = {
    status: "rejected",
    processedBy: args.processedBy,
    rejectedAt: now,
    updatedAt: now,
  };
  if (args.rejectReason) $set.rejectReason = args.rejectReason;
  const result = await db.collection<AccountRequestDocument>(COLLECTION).updateOne(
    { _id: new ObjectId(args.id), status: "pending" },
    { $set },
  );
  return result.matchedCount === 1;
}

export function serializeAccountRequest(doc: WithId<AccountRequestDocument>) {
  return {
    id: doc._id.toString(),
    schoolName: doc.schoolName,
    sido: doc.sido,
    type: doc.type,
    schoolCode: doc.schoolCode ?? null,
    atptCode: doc.atptCode ?? null,
    manual: doc.manual,
    teacherName: doc.teacherName,
    teacherPhone: doc.teacherPhone,
    teacherEmail: doc.teacherEmail ?? null,
    teacherRole: doc.teacherRole ?? null,
    note: doc.note ?? null,
    status: doc.status,
    accountId: doc.accountId ?? null,
    processedBy: doc.processedBy ?? null,
    rejectReason: doc.rejectReason ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    approvedAt: doc.approvedAt?.toISOString() ?? null,
    rejectedAt: doc.rejectedAt?.toISOString() ?? null,
  };
}
