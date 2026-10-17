/**
 * v3 작업자를 별도 Node 프로세스로 돌린다 (상시 서버 배포용 실행 방식).
 * usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-worker.ts [동시 계산 수]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { getDb } = await import("@/lib/mongodb");
  const { Coordinator } = await import("@/lib/v3/runner/coordinator");
  const c = new Coordinator({ getDb, concurrency: Number(process.argv[2] ?? 1) });
  await c.start();
  console.log(`[v3 작업자] 시작: ${c.workerId}`);
  const quit = async () => { console.log("[v3 작업자] 종료 중 (진행 중인 구간은 끝까지)"); await c.stop(); process.exit(0); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}
main().catch((e) => { console.error(e); process.exit(1); });
