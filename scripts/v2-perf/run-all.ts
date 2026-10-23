/**
 * 모든 시나리오를 병렬로 측정하고 결과 보고서를 만든다.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/v2-perf/run-all.ts [결과폴더이름] [동시실행=6] [반복=3]
 *
 * 결과: scripts/v2-perf/results/<결과폴더이름>/<시나리오>.jsonl, report.md
 * 교환 개선은 시간 기준으로 끝나므로, 동시 실행 수를 CPU 코어 수보다 넉넉히 낮게 둔다.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "./scenarios";
import { writeReport } from "./summarize";

const name = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const concurrency = Number(process.argv[3] ?? 6);
const repeat = Number(process.argv[4] ?? 3);
const dir = join("scripts", "v2-perf", "results", name);
mkdirSync(dir, { recursive: true });

function runOne(id: string): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      "npx",
      ["tsx", "--tsconfig", "./tsconfig.json", "scripts/v2-perf/run.ts", id, String(repeat)],
      { shell: true },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => {
      writeFileSync(join(dir, `${id}.jsonl`), out);
      console.log(`${id} 완료 (${Math.round((Date.now() - started) / 1000)}초)`);
      resolve();
    });
  });
}

async function main() {
  const queue = SCENARIOS.map((s) => s.id);
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) await runOne(queue.shift()!);
    }),
  );
  writeReport(dir);
  console.log(`전체 ${Math.round((Date.now() - started) / 1000)}초 · ${join(dir, "report.md")}`);
}

main();
