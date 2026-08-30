import { NextRequest, NextResponse } from "next/server";
import { listSchoolAccounts } from "@/lib/accounts";
import { countTermsForOwners } from "@/lib/account-cleanup";
import { requireAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const db = await getDb();
    const [items, total] = await Promise.all([
      listSchoolAccounts(q),
      db.collection("accounts").countDocuments({
        isDemo: { $ne: true },
        role: { $ne: "admin" },
      }),
    ]);
    const termCounts = await countTermsForOwners(
      db,
      items.map((account) => account._id.toString()),
    );
    const mapped = items
      .map((account) => {
        const createdAt =
          account.createdAt instanceof Date
            ? account.createdAt
            : account.createdAt
              ? new Date(account.createdAt)
              : account._id.getTimestamp();
        return {
          id: account._id.toString(),
          username: account.username,
          createdAt: createdAt.toISOString(),
          termCount: termCounts.get(account._id.toString()) ?? 0,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return NextResponse.json({ items: mapped, total });
  } catch (error) {
    console.error("admin accounts GET failed:", error);
    return NextResponse.json(
      { error: "계정 목록을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}
