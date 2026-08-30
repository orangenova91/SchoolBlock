import { NextResponse } from "next/server";
import {
  findAccountById,
  isAdminAccount,
  updateAccountPassword,
  hashPassword,
} from "@/lib/accounts";
import { requireAdmin } from "@/lib/admin-auth";
import { validatePassword } from "@/lib/passwords";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ accountId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { accountId } = await context.params;
  const account = await findAccountById(accountId);
  if (!account || account.isDemo || isAdminAccount(account)) {
    return NextResponse.json(
      { error: "학교 계정을 찾을 수 없습니다." },
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
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const password = validatePassword((body as Record<string, unknown>).password);
  if (!password) {
    return NextResponse.json(
      { error: "비밀번호는 공백 없이 8자 이상이어야 합니다." },
      { status: 400 },
    );
  }

  try {
    const passwordHash = await hashPassword(password);
    await updateAccountPassword(accountId, passwordHash);
    return NextResponse.json({
      ok: true,
      username: account.username,
      password,
    });
  } catch (error) {
    console.error("admin password reset failed:", error);
    return NextResponse.json(
      { error: "비밀번호를 바꾸지 못했습니다." },
      { status: 503 },
    );
  }
}
