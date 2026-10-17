import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { Coordinator } from "@/lib/v3/runner/coordinator";

/**
 * (내부용) 대기 작업 하나를 한 구간 돌린다. 상시 작업자를 둘 수 없는 서버리스 배포에서
 * "구간 끝 → 다음 구간 호출" 방식으로 대기열을 돌릴 때 쓴다 (docs/v3-execution-design.md).
 * 비밀 키(V3_WORKER_SECRET)가 설정되어 있고 일치할 때만 동작한다. 실행 방식은 배포 단계에서 확정한다.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.V3_WORKER_SECRET;
  if (!secret || request.headers.get("x-v3-worker-secret") !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const coordinator = new Coordinator({ getDb });
  const ran = await coordinator.runOnce();
  return NextResponse.json({ ran });
}
