import { NextResponse } from "next/server";
import {
  createSchoolAccount,
  findNonDemoAccountByUsername,
  hashPassword,
} from "@/lib/accounts";
import { requireAdmin } from "@/lib/admin-auth";
import {
  findAccountRequestById,
  markAccountRequestApproved,
  serializeAccountRequest,
} from "@/lib/account-requests";
import { MAX_SCHOOL_NAME } from "@/lib/account-request-input";
import { validatePassword } from "@/lib/passwords";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { requestId } = await context.params;
  const current = await findAccountRequestById(requestId);
  if (!current) {
    return NextResponse.json(
      { error: "신청을 찾을 수 없습니다." },
      { status: 404 },
    );
  }
  if (current.status !== "pending") {
    return NextResponse.json(
      { error: "이미 처리된 신청입니다." },
      { status: 409 },
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

  const { password: rawPassword, username: rawUsername } = body as Record<
    string,
    unknown
  >;
  const password = validatePassword(rawPassword);
  if (!password) {
    return NextResponse.json(
      { error: "비밀번호는 공백 없이 8자 이상이어야 합니다." },
      { status: 400 },
    );
  }

  const username = (
    typeof rawUsername === "string" && rawUsername.trim()
      ? rawUsername
      : current.schoolName
  ).trim();
  if (username.length < 2 || username.length > MAX_SCHOOL_NAME) {
    return NextResponse.json(
      { error: "아이디는 두 글자 이상이어야 합니다." },
      { status: 400 },
    );
  }

  try {
    const existing = await findNonDemoAccountByUsername(username);
    if (existing) {
      return NextResponse.json(
        {
          error: "같은 아이디의 계정이 이미 있습니다.",
          code: "already_account",
        },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const accountId = await createSchoolAccount({ username, passwordHash });
    const marked = await markAccountRequestApproved({
      id: requestId,
      accountId,
      processedBy: auth.admin.username,
    });
    if (!marked) {
      return NextResponse.json(
        { error: "이미 처리된 신청입니다." },
        { status: 409 },
      );
    }

    const updated = await findAccountRequestById(requestId);
    return NextResponse.json({
      ok: true,
      username,
      password,
      request: updated ? serializeAccountRequest(updated) : null,
    });
  } catch (error) {
    console.error("admin approve failed:", error);
    return NextResponse.json(
      { error: "계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
