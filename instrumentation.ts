/**
 * 서버 시작 시 한 번 실행 (Next.js instrumentation).
 *
 * v3 시간표 계산 작업자(조정자)를 서버 안에서 시작한다. 계산 자체는 작업 스레드에서 돌아 웹 요청을 막지 않는다.
 * - 개발 서버(next dev)에서는 기본으로 켠다.
 * - 배포 환경에서는 실행 방식이 정해질 때까지 끈다 (V3_WORKER=thread 로 켤 수 있음).
 * - v1·v2 동작과는 관계없다 (v3 작업만 처리).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode = process.env.V3_WORKER ?? (process.env.NODE_ENV === "development" ? "thread" : "off");
  if (mode !== "thread") return;
  const { startCoordinator } = await import("./lib/v3/runner/start");
  startCoordinator();
}
