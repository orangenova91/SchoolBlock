import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/privacy", "/apply"];
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/schools/",
  "/api/account-requests",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/logo/")) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAdminArea(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin")
  );
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

  if (isAdminArea(pathname) && session.role !== "admin") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "관리자만 이용할 수 있습니다." },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (
    session.role === "admin" &&
    !isAdminArea(pathname) &&
    pathname !== "/api/auth/logout" &&
    pathname !== "/privacy" &&
    pathname !== "/apply"
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "관리자 계정은 이 기능을 사용할 수 없습니다." },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  // 학기 화면: 요청 주소를 레이아웃에 넘긴다. v3 학기를 v1 주소로 열면 같은 단계의 v3 화면으로 보내는 데 쓴다.
  if (pathname.startsWith("/terms/") || pathname.startsWith("/v3/terms/")) {
    const headers = new Headers(request.headers);
    headers.set("x-sb-path", pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo/).*)"],
};
