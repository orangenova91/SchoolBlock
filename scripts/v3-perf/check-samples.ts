/**
 * M1 대조: 저장된 확정 버전(테스트 시간표 3·4 등)을 v3 검증기로 다시 채점해
 * 앱 진단 수치(점심 연강·3연강·동일 교과)와 같은지 본다. DB는 읽기만 한다.
 *
 * usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/check-samples.ts "테스트 시간표 3" "테스트 시간표 4"
 *
 * - app 방식: SET 칸에 적힌 교사만 셈 (+α 과목 교사는 반 칸이 없어 빠짐) → 저장 수치와 같아야 함
 * - 명세 방식: +α 과목 교사까지 셈 → app 방식 이상
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { MongoClient } from "mongodb";
import type { TimetableVersionDocument } from "@/lib/types";
import { loadV3Input } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import { occurrencesFromCells, validateSolution } from "@/lib/v3/validate";

async function main() {
  const names = process.argv.slice(2);
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db();
  let same = 0, total = 0;
  for (const name of names) {
    const term = await db.collection("terms").findOne({ timetableName: name });
    if (!term) { console.log(`없음: ${name}`); continue; }
    const termId = String(term._id);
    const input = await loadV3Input(db, termId);
    const inst = buildInstance(input);
    const versions = await db.collection<TimetableVersionDocument>("timetableVersions").find({ termId }).sort({ versionNumber: 1 }).toArray();
    console.log(`\n${name} (확정 ${versions.length}개)`);
    for (const v of versions) {
      const app = validateSolution(input, inst, { cells: v.cells, occurrences: occurrencesFromCells(input, v.cells, { fillAlpha: false }) }).metrics;
      const spec = validateSolution(input, inst, { cells: v.cells, occurrences: occurrencesFromCells(input, v.cells) }).metrics;
      const stored = [v.lunchDoubleCount, v.tripleRunCount, v.sameDaySubjectViolationCount];
      const mine = [app.lunch, app.triple, app.sameDay];
      const ok = stored.every((x, i) => x === mine[i]);
      total++; if (ok) same++;
      console.log(`  확정 ${String(v.versionNumber).padStart(2)}  저장 ${stored.join("/").padEnd(9)} v3(app) ${mine.join("/").padEnd(9)} ${ok ? "같음" : "다름"}  v3(+α 포함) ${spec.lunch}/${spec.triple}/${spec.sameDay}  ${(v.note ?? "").slice(0, 40)}`);
    }
  }
  console.log(`\n저장 수치와 같음: ${same} / ${total}`);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
