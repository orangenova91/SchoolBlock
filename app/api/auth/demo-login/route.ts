import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { hashPassword } from "@/lib/accounts";
import { deleteAccountsAndOwnedData } from "@/lib/account-cleanup";
import {
  DEMO_ACCOUNT_MAX_AGE_MS,
  DEMO_TIMETABLE_NAME_NO_SET,
  DEMO_TIMETABLE_NAME_WITH_SET,
  DEMO_USERNAME,
  buildDemoTermBundleNoSet,
  buildDemoTermBundleWithSet,
  createDemoAccountUsername,
} from "@/lib/demo-seed";
import { createSessionToken, sessionCookieOptions } from "@/lib/session";
import { insertTermBundle } from "@/lib/term-bundle";
import type { AccountDocument } from "@/lib/types";

/** 만료된 데모 계정과 그 학기·딸린 문서를 지운다. cron 없이, 다음 방문이 올 때마다 정리한다. */
async function cleanupStaleDemoAccounts(): Promise<void> {
  const db = await getDb();
  const stale = await db
    .collection<AccountDocument>("accounts")
    .find({
      isDemo: true,
      createdAt: { $lt: new Date(Date.now() - DEMO_ACCOUNT_MAX_AGE_MS) },
    })
    .toArray();
  if (stale.length === 0) return;
  await deleteAccountsAndOwnedData(
    db,
    stale.map((account) => account._id),
  );
}

/**
 * "체험해보기" 버튼용 원클릭 로그인. 방문마다 새로 격리된 데모 계정을
 * 만들어 예시 시간표 설정을 채운 뒤 로그인시킨다 — 계정을 공유하지 않으므로
 * 한 방문자의 진행 상황이 다른 방문자 것을 지우지 않는다. 화면에는 항상
 * "데모계정"으로 보인다(세션의 username은 표시용 라벨).
 */
export async function POST() {
  try {
    const db = await getDb();
    const accounts = db.collection<AccountDocument>("accounts");

    await cleanupStaleDemoAccounts();

    const passwordHash = await hashPassword(randomBytes(16).toString("hex"));
    const insertResult = await accounts.insertOne({
      username: createDemoAccountUsername(),
      passwordHash,
      createdAt: new Date(),
      isDemo: true,
    });
    const accountId = insertResult.insertedId.toString();

    const academicYear = new Date().getFullYear();
    await Promise.all([
      insertTermBundle(db, buildDemoTermBundleNoSet(), {
        ownerId: accountId,
        school: DEMO_USERNAME,
        timetableName: DEMO_TIMETABLE_NAME_NO_SET,
        academicYear,
        semester: 1,
      }),
      insertTermBundle(db, buildDemoTermBundleWithSet(), {
        ownerId: accountId,
        school: DEMO_USERNAME,
        timetableName: DEMO_TIMETABLE_NAME_WITH_SET,
        academicYear,
        semester: 1,
      }),
    ]);

    const token = await createSessionToken({
      accountId,
      username: DEMO_USERNAME,
    });

    const response = NextResponse.json({ username: DEMO_USERNAME });
    response.cookies.set(sessionCookieOptions.name, token, {
      httpOnly: sessionCookieOptions.httpOnly,
      sameSite: sessionCookieOptions.sameSite,
      secure: sessionCookieOptions.secure,
      path: sessionCookieOptions.path,
      maxAge: sessionCookieOptions.maxAge,
    });
    return response;
  } catch (error) {
    console.error("demo login failed:", error);
    return NextResponse.json(
      {
        error:
          "체험 계정을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 503 },
    );
  }
}
