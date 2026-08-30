import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { findAccountById, isAdminAccount } from "@/lib/accounts";
import { getServerSession, getSessionFromRequest } from "@/lib/session";

export async function requireAdmin(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 },
      ),
    };
  }

  const account = await findAccountById(session.accountId);
  if (!isAdminAccount(account)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "관리자만 이용할 수 있습니다." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    admin: { accountId: session.accountId, username: account.username },
  };
}

export async function requireAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const account = await findAccountById(session.accountId);
  if (!isAdminAccount(account)) redirect("/");
  return account;
}
