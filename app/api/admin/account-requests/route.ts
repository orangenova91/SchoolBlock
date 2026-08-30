import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  listAccountRequests,
  serializeAccountRequest,
} from "@/lib/account-requests";
import type { AccountRequestStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseStatus(raw: string | null): AccountRequestStatus | undefined {
  if (raw === "pending" || raw === "approved" || raw === "rejected") return raw;
  return undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const status = parseStatus(request.nextUrl.searchParams.get("status"));
    const items = await listAccountRequests(status);
    return NextResponse.json({
      items: items.map(serializeAccountRequest),
    });
  } catch (error) {
    console.error("admin account-requests GET failed:", error);
    return NextResponse.json(
      { error: "신청 목록을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}
