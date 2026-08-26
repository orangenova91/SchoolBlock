import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import type { AccountDocument } from "@/lib/types";

const SALT_ROUNDS = 12;

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
