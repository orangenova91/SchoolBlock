import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/privacy"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/schools/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/logo/")) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 로그인 안 된 상태에서 페이지 요청이 오면 /login으로 보내는 UX 편의 계층.
 * 실제 데이터 접근 권한 검증은 각 API Route Handler가 세션을 직접 검증해서
 * 수행한다 — matcher 설정 실수로 이 계층이 우회되어도 데이터는 안전해야 하므로
 * 이걸 유일한 보안 경계로 삼지 않는다.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(request);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo/).*)"],
};
