import { getDb } from "@/lib/mongodb";
import {
  countUniqueParticipatingSchools,
  type ParticipatingAccount,
  type ParticipatingRequest,
} from "@/lib/school-participation";
import type { AccountDocument, AccountRequestDocument } from "@/lib/types";

const CACHE_MS = 60 * 1000;

let cached: { n: number; expiresAt: number } | null = null;

export async function countParticipatingSchools(): Promise<number> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.n;

  const db = await getDb();
  const [accounts, requests] = await Promise.all([
    db
      .collection<AccountDocument>("accounts")
      .find(
        { isDemo: { $ne: true }, role: { $ne: "admin" } },
        { projection: { username: 1 } },
      )
      .toArray(),
    db
      .collection<AccountRequestDocument>("accountRequests")
      .find(
        { status: { $ne: "rejected" } },
        {
          projection: {
            schoolName: 1,
            sido: 1,
            schoolCode: 1,
            atptCode: 1,
          },
        },
      )
      .toArray(),
  ]);

  const n = countUniqueParticipatingSchools(
    accounts as ParticipatingAccount[],
    requests as ParticipatingRequest[],
  );
  cached = { n, expiresAt: now + CACHE_MS };
  return n;
}
