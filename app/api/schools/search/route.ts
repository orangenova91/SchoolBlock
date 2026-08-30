import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { searchSchools } from "@/lib/schools";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!checkRateLimit("schools-search", ip, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429 },
      );
    }

    const { searchParams } = request.nextUrl;
    const q = (searchParams.get("q") ?? "").trim();
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));

    const items = searchSchools(q, limit);

    return NextResponse.json(
      { items },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    console.error("schools/search error:", error);
    return NextResponse.json(
      { error: "학교 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
