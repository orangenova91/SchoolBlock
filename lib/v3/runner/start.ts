/**
 * 서버 안에서 조정자를 한 번만 시작한다 (개발 서버의 instrumentation.ts 가 부름).
 * 동시 계산 수는 V3_WORKER_CONCURRENCY (기본 1).
 */
import { getDb } from "@/lib/mongodb";
import { Coordinator } from "@/lib/v3/runner/coordinator";

declare global {
  var _v3Coordinator: Coordinator | undefined;
}

export function startCoordinator(): Coordinator {
  if (!global._v3Coordinator) {
    const concurrency = Math.max(1, Number(process.env.V3_WORKER_CONCURRENCY ?? 1));
    global._v3Coordinator = new Coordinator({ getDb, concurrency });
    global._v3Coordinator.start().catch((e) => console.error("[v3 작업자] 시작 실패:", e));
  }
  return global._v3Coordinator;
}
