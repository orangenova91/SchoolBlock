/**
 * M4 확인: 작업·대기열·작업자. 별도 시험 DB(timetable_v3_test)만 쓴다 (개발 DB는 건드리지 않음).
 * usage: V3_LEASE_MS=6000 npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/jobs-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { spawn } from "node:child_process";
import { MongoClient, ObjectId, type Db } from "mongodb";
import demo from "@/lib/demo-seed-set-example.json";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import { approveContinue, createJob, requestStop, type V3JobDocument } from "@/lib/v3/jobs";
import { Coordinator } from "@/lib/v3/runner/coordinator";

const TEST_DB = "timetable_v3_test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"}  ${name}  ${detail}`);
};

function testUri() {
  const u = new URL(process.env.MONGODB_URI!);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function seed(db: Db, termId: string) {
  const d = demo as never as Record<string, Record<string, unknown>>;
  await Promise.all([
    db.collection("teachers").insertOne({ termId, teachers: d.teachers }),
    db.collection("subjects").insertOne({ termId, subjects: d.subjects }),
    db.collection("daySchedules").insertOne({ termId, ...d.daySchedule }),
    db.collection("setBlocks").insertOne({ termId, cells: [], partialCells: [], teacherAssignments: [] }),
    db.collection("subjectBlocks").insertOne({ termId, cells: [] }),
    db.collection("teacherConstraints").insertOne({ termId, forbiddenSlots: [] }),
    db.collection("generationPreferences").insertOne({ termId, ...d.preferences }),
  ]);
}

async function waitFor(db: Db, id: ObjectId, pred: (j: V3JobDocument) => boolean, timeoutMs: number) {
  const t0 = Date.now();
  for (;;) {
    const j = (await db.collection<V3JobDocument>("v3Jobs").findOne({ _id: id }))!;
    if (pred(j)) return { job: j, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { job: j, ms: -1 };
    await sleep(100);
  }
}

async function newJob(db: Db, termId: string, over: Partial<V3JobDocument> = {}, kind: V3JobDocument["kind"] = "search") {
  const hash = v3InputHash(await loadV3Input(db, termId));
  const job = await createJob(db, { termId, accountId: "test", kind, inputHash: hash, seed: 1 });
  if (Object.keys(over).length) await db.collection("v3Jobs").updateOne({ _id: job._id }, { $set: over });
  return job;
}

async function main() {
  const client = await new MongoClient(testUri()).connect();
  const db = client.db();
  if (db.databaseName !== TEST_DB) throw new Error("시험 DB가 아님");
  await db.dropDatabase();
  const termA = new ObjectId().toHexString();
  const termB = new ObjectId().toHexString();
  await seed(db, termA);
  await seed(db, termB);
  const getDb = async () => db;
  const quiet = () => {};

  // 1) 작업자 둘이 같은 작업을 동시에 가져가지 않는다 + 학기당 실행 1
  {
    const j1 = await newJob(db, termA, { segmentMs: 6000, maxMs: 6000 });
    const j2 = await newJob(db, termA, { segmentMs: 6000, maxMs: 6000 });
    const claimed: string[] = [];
    const a = new Coordinator({ getDb, workerId: "A", pollMs: 200, log: (m) => { if (m.includes("시작")) claimed.push(`A ${m}`); } });
    const b = new Coordinator({ getDb, workerId: "B", pollMs: 200, log: (m) => { if (m.includes("시작")) claimed.push(`B ${m}`); } });
    await Promise.all([a.start(), b.start()]);
    await sleep(2500);
    const running = await db.collection("v3Jobs").countDocuments({ termId: termA, status: "running" });
    check("같은 학기 작업은 하나만 실행", running === 1, `실행 중 ${running}개`);
    await waitFor(db, j2._id, (j) => j.status === "done", 40_000);
    const r1 = await waitFor(db, j1._id, (j) => j.status === "done", 40_000);
    check("두 작업 모두 한 번씩만 실행되어 완료", r1.ms >= 0 && claimed.length === 2, claimed.join(" | "));
    await Promise.all([a.stop(), b.stop()]);
  }

  // 2) 계산 중에도 조정자(웹 서버 역할)가 막히지 않음 + 중지 요청 처리
  {
    const job = await newJob(db, termA, { segmentMs: 60_000, maxMs: 60_000 }, "hybrid");
    const c = new Coordinator({ getDb, workerId: "C", pollMs: 200, heartbeatMs: 500, log: quiet });
    await c.start();
    await waitFor(db, job._id, (j) => j.status === "running" && (j.progress?.segmentMs ?? 0) > 3000, 30_000);
    let maxLag = 0;
    let last = Date.now();
    const lag = setInterval(() => {
      const n = Date.now();
      maxLag = Math.max(maxLag, n - last - 50);
      last = n;
    }, 50);
    await sleep(5000);
    clearInterval(lag);
    check("계산 중에도 조정자 쪽은 막히지 않음", maxLag < 200, `이벤트 지연 최대 ${maxLag}ms (5초 관찰)`);
    const t0 = Date.now();
    await requestStop(db, job._id);
    const r = await waitFor(db, job._id, (j) => j.status === "stopped", 20_000);
    const stopMs = r.ms >= 0 ? Date.now() - t0 : -1;
    check("중지 요청 → 중지됨 저장", stopMs >= 0 && stopMs < 3000, `${stopMs}ms (계산 멈춤 + 결과·중단점 저장 포함)`);
    const ck = await db.collection("v3Checkpoints").countDocuments({ jobId: String(job._id) });
    check("중지 시점의 결과·중단점 저장", ck === 1, `중단점 ${ck}개, 결과 ${r.job.summary.results.length}개, 미배치 ${r.job.summary.bestUnplaced}`);
    await c.stop();
  }

  // 3) 사전 승인 / 승인 대기 → 승인
  {
    const auto = await newJob(db, termB, { segmentMs: 4000, maxMs: 12_000, autoContinue: true });
    const c = new Coordinator({ getDb, workerId: "D", pollMs: 200, log: quiet });
    await c.start();
    const r = await waitFor(db, auto._id, (j) => j.status === "done", 60_000);
    check("사전 승인: 4초 구간 3번 이어 돌고 완료", r.job.segments === 3 && r.job.elapsedMs >= 11_000, `구간 ${r.job.segments}, 누적 ${r.job.elapsedMs}ms`);
    const manual = await newJob(db, termB, { segmentMs: 4000, maxMs: 12_000, autoContinue: false });
    const w = await waitFor(db, manual._id, (j) => j.status === "awaiting", 30_000);
    const before = w.job.summary.results[0]?.metrics.score ?? null;
    check("사전 승인 없음: 구간 끝에 승인 대기 (작업자 반납)", w.ms >= 0 && !w.job.lease, `구간 ${w.job.segments}, 최선 ${before}`);
    await approveContinue(db, manual._id, manual.inputHash);
    const r2 = await waitFor(db, manual._id, (j) => j.segments === 2 && j.status === "awaiting", 30_000);
    const after = r2.job.summary.results[0]?.metrics.score ?? null;
    check("승인하면 중단점에서 이어 감", r2.ms >= 0 && after !== null && before !== null && after <= before, `최선 ${before} → ${after}, 누적 ${r2.job.elapsedMs}ms`);
    await c.stop();
  }

  // 4) 작업자 프로세스를 강제로 끄면, 임대가 끝난 뒤 다른 작업자가 중단점에서 이어 받는다
  {
    const job = await newJob(db, termB, { segmentMs: 5000, maxMs: 15_000, autoContinue: true });
    const env = { ...process.env, MONGODB_URI: testUri(), V3_LEASE_MS: process.env.V3_LEASE_MS ?? "6000" };
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/v3-worker.ts", "1"], { env, stdio: "ignore" });
    const mid = await waitFor(db, job._id, (j) => j.segments >= 1 && j.status === "running", 60_000);
    const segBefore = mid.job.segments;
    const elapsedBefore = mid.job.elapsedMs;
    child.kill("SIGKILL");
    await sleep(500);
    const c = new Coordinator({ getDb, workerId: "E", pollMs: 300, log: quiet });
    await c.start();
    const r = await waitFor(db, job._id, (j) => j.status === "done", 90_000);
    check(
      "작업자 강제 종료 → 다른 작업자가 중단점에서 이어 받아 완료",
      r.ms >= 0 && r.job.elapsedMs > elapsedBefore,
      `종료 시점 구간 ${segBefore}·누적 ${elapsedBefore}ms → 최종 구간 ${r.job.segments}·누적 ${r.job.elapsedMs}ms, 상태 ${r.job.status}`,
    );
    await c.stop();
  }

  // 5) 입력이 바뀌면 이어 돌리기 거부
  {
    const job = await newJob(db, termA, { status: "awaiting" });
    await db.collection("v3Checkpoints").insertOne({ jobId: String(job._id), termId: termA, checkpoint: {}, savedAt: new Date(), expiresAt: new Date(Date.now() + 1e9) });
    const firstTeacher = (demo as never as { teachers: { name: string }[] }).teachers[0].name;
    await db.collection("teacherConstraints").updateOne({ termId: termA }, { $set: { forbiddenSlots: [{ teacherName: firstTeacher, day: "mon", period: 1 }] } });
    const changed = v3InputHash(await loadV3Input(db, termA));
    let msg = "";
    try {
      await approveContinue(db, job._id, changed);
    } catch (e) {
      msg = (e as Error).message;
    }
    check("입력이 바뀌면 이어 돌리기 거부", msg.includes("입력이 바뀌어"), msg);
  }

  await db.dropDatabase();
  await client.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} / ${results.length} 통과`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
