import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AccountDocument } from "@/lib/types";

const SALT_ROUNDS = 12;

export function isAdminAccount(
  account: AccountDocument | null,
): account is AccountDocument & { role: "admin" } {
  return Boolean(account && account.role === "admin" && !account.isDemo);
}

/** 로그인에 쓰지 않는 계정(데모 등)에 넣는 고정 해시. 클릭 경로에서 bcrypt를 피한다. */
export const UNUSED_PASSWORD_HASH =
  "$2b$12$eVSJmw9wbTK3B78BYpxIsembYanLjvj58MBVtY1bYlaM5QerJecOq";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function findAccountByUsername(username: string) {
  const db = await getDb();
  return db
    .collection<AccountDocument>("accounts")
    .findOne({ username: username.trim() });
}

export async function findAccountById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db
    .collection<AccountDocument>("accounts")
    .findOne({ _id: new ObjectId(id) });
}

export async function findNonDemoAccountByUsername(username: string) {
  const db = await getDb();
  return db.collection<AccountDocument>("accounts").findOne({
    username: username.trim(),
    isDemo: { $ne: true },
  });
}

export async function createSchoolAccount(args: {
  username: string;
  passwordHash: string;
}): Promise<string> {
  const db = await getDb();
  const result = await db.collection<AccountDocument>("accounts").insertOne({
    username: args.username,
    passwordHash: args.passwordHash,
    createdAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function updateAccountPassword(id: string, passwordHash: string) {
  const db = await getDb();
  return db
    .collection<AccountDocument>("accounts")
    .updateOne({ _id: new ObjectId(id) }, { $set: { passwordHash } });
}

const SCHOOL_ACCOUNT_FILTER = {
  isDemo: { $ne: true },
  role: { $ne: "admin" },
} as const;

export async function listSchoolAccounts(query = "") {
  const db = await getDb();
  const q = query.trim();
  const filter: Record<string, unknown> = { ...SCHOOL_ACCOUNT_FILTER };
  if (q.length >= 1) {
    filter.username = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  return db
    .collection<AccountDocument>("accounts")
    .find(filter, {
      projection: { username: 1, createdAt: 1 },
      sort: { createdAt: -1, _id: -1 },
      limit: 50,
    })
    .toArray();
}
