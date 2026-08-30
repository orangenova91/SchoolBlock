import { NextResponse } from "next/server";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm, setTermMaxReachedChapter } from "@/lib/term-access";

type RouteContext = {
  params: Promise<{ termId: string }>;
};

function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const accountId = await getAccountId(request);
  if (!accountId) return unauthorizedResponse();

  const { termId } = await context.params;
  const term = await findOwnedTerm(termId, accountId);
  if (!term) {
    return NextResponse.json(
      { error: "학기 정보를 찾을 수 없습니다." },
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

  const raw =
    body && typeof body === "object"
      ? (body as { maxReachedChapter?: unknown }).maxReachedChapter
      : undefined;
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > 7
  ) {
    return NextResponse.json(
      { error: "올바르지 않은 요청입니다." },
      { status: 400 },
    );
  }

  await setTermMaxReachedChapter(termId, accountId, raw);
  return NextResponse.json({ maxReachedChapter: raw });
}
