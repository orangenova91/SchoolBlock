import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  findAccountRequestById,
  markAccountRequestRejected,
  serializeAccountRequest,
} from "@/lib/account-requests";

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

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  let rejectReason: string | undefined;
  if (body && typeof body === "object") {
    const raw = (body as Record<string, unknown>).reason;
    if (typeof raw === "string" && raw.trim()) {
      const trimmed = raw.trim();
      if (trimmed.length > 200) {
        return NextResponse.json(
          { error: "반려 사유는 200자 이하여야 합니다." },
          { status: 400 },
        );
      }
      rejectReason = trimmed;
    }
  }

  try {
    const marked = await markAccountRequestRejected({
      id: requestId,
      processedBy: auth.admin.username,
      rejectReason,
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
      request: updated ? serializeAccountRequest(updated) : null,
    });
  } catch (error) {
    console.error("admin reject failed:", error);
    return NextResponse.json(
      { error: "신청을 반려하지 못했습니다." },
      { status: 503 },
    );
  }
}
