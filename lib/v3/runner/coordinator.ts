/**
 * 조정자 (docs/v3-execution-design.md 2.3). 대기열에서 작업을 꺼내 계산 스레드에 맡기고,
 * 2초마다 진행 상황을 저장하며 중지 요청을 계산 스레드에 전한다.
 *
 * 조정자는 기다리는 일(DB 읽기·쓰기)만 하므로 웹 요청을 막지 않는다. 계산은 계산 스레드가 한다.
 * 같은 코드를 세 가지 방식으로 돌릴 수 있다 (배포 단계에서 선택):
 *   - 개발 서버 안 (instrumentation.ts → startCoordinator)
 *   - 별도 Node 프로세스 (scripts/v3-worker.ts)
 *   - 구간 호출 (M5: 한 번 호출에 한 구간 runOnce)
 */
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { Db } from "mongodb";
import { loadV3Input, v3InputHash } from "@/lib/v3/input";
import {
  claimNextJob,
  ensureJobIndexes,
  failJob,
  finishDiagnosis,
  finishSegment,
  heartbeat,
  knownLowerBound,
  loadCheckpoint,
  type V3JobDocument,
  type V3JobProgress,
} from "@/lib/v3/jobs";
import type { EngineOutcome } from "@/lib/v3/engines/types";
import type { EngineThreadInput, EngineThreadMessage } from "@/lib/v3/runner/engine-thread";

export type CoordinatorOptions = {
  getDb: () => Promise<Db>;
  /** 동시에 돌릴 계산 수 (코어 수에 맞춤) */
  concurrency?: number;
  workerId?: string;
  pollMs?: number;
  heartbeatMs?: number;
  /** 계산 스레드 진입 파일 (기본: 프로젝트의 lib/v3/runner/engine-thread.ts) */
  enginePath?: string;
  log?: (msg: string) => void;
};

export class Coordinator {
  private running = false;
  private loops: Promise<void>[] = [];
  readonly workerId: string;
  private readonly opts: Required<Omit<CoordinatorOptions, "workerId">>;

  constructor(o: CoordinatorOptions) {
    this.workerId = o.workerId ?? `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.opts = {
      getDb: o.getDb,
      concurrency: o.concurrency ?? 1,
      pollMs: o.pollMs ?? 2000,
      heartbeatMs: o.heartbeatMs ?? 2000,
      enginePath: o.enginePath ?? path.join(process.cwd(), "lib", "v3", "runner", "engine-thread.ts"),
      log: o.log ?? ((m) => console.log(`[v3 작업자] ${m}`)),
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await ensureJobIndexes(await this.opts.getDb());
    for (let i = 0; i < this.opts.concurrency; i++) this.loops.push(this.loop(`${this.workerId}#${i}`));
  }

  /** 새 작업을 받지 않는다. 진행 중인 구간은 끝까지 돈다 */
  async stop() {
    this.running = false;
    await Promise.all(this.loops);
  }

  private async loop(slotId: string) {
    while (this.running) {
      try {
        const ran = await this.runOnce(slotId);
        if (!ran) await sleep(this.opts.pollMs);
      } catch (e) {
        this.opts.log(`오류: ${e instanceof Error ? e.message : String(e)}`);
        await sleep(this.opts.pollMs);
      }
    }
  }

  /** 대기 작업 하나를 한 구간 돌린다. 할 일이 없으면 false */
  async runOnce(slotId = this.workerId): Promise<boolean> {
    const db = await this.opts.getDb();
    const job = await claimNextJob(db, slotId);
    if (!job) return false;
    await this.runSegment(db, job, slotId);
    return true;
  }

  private async runSegment(db: Db, job: V3JobDocument, slotId: string) {
    const input = await loadV3Input(db, job.termId);
    if (v3InputHash(input) !== job.inputHash) {
      await failJob(db, job._id, slotId, "작업을 만든 뒤 입력이 바뀌어 이어 돌릴 수 없습니다. 새로 실행해 주세요.", "stopped");
      return;
    }
    const checkpoint = job.kind === "diagnose" ? null : await loadCheckpoint(db, job._id);
    const budgetMs = Math.max(1000, Math.min(job.segmentMs, job.maxMs - job.elapsedMs));
    const stopBuffer = new SharedArrayBuffer(4);
    const flag = new Int32Array(stopBuffer);
    // 같은 입력의 하한 계산이 동시에 돌 수 있으므로, 새로 증명된 하한을 계산 중에도 넘겨 준다
    const known = await knownLowerBound(db, job.termId, job.inputHash);
    const lowerBoundBuffer = new SharedArrayBuffer(8);
    const liveBound = new Float64Array(lowerBoundBuffer);
    liveBound[0] = known ?? Number.NaN;
    const workerData: EngineThreadInput = {
      kind: job.kind,
      diagnose: job.diagnose,
      input,
      checkpoint,
      budgetMs,
      // 같은 입력의 다른 작업(하한 계산 등)이 증명한 하한도 함께 써서 조기 종료·근접 판정에 쓴다
      lowerBound: maxOrNull(job.lowerBound, known),
      seed: job.seed + job.segments * 7919,
      stopBuffer,
      lowerBoundBuffer,
      goal: job.goal ?? "strict",
    };
    this.opts.log(`#${job.number} ${job.kind}${job.diagnose ? `:${job.diagnose}` : ""} 구간 ${job.segments + 1} 시작 (${Math.round(budgetMs / 1000)}초)`);
    const worker = new Worker(this.opts.enginePath, { workerData, execArgv: ["--import", "tsx"] });
    let latest: V3JobProgress | null = null;
    let done: EngineThreadMessage | null = null;
    let leaseLost = false;
    const finished = new Promise<void>((resolve) => {
      worker.on("message", (m: EngineThreadMessage) => {
        if (m.type === "progress") {
          const p = m.progress;
          // 하한은 한번 증명되면 내려가지 않는다: 하한 없이 문구만 오는 진행(예: "3연강 최소 건수 계산 중")이 앞서 알린 하한을 지우지 않게 한다
          const prevLb: number | null = (latest as V3JobProgress | null)?.lowerBound ?? null;
          const lowerBound = p.lowerBound == null ? prevLb : prevLb === null ? p.lowerBound : Math.max(prevLb, p.lowerBound);
          latest = {
            phase: p.phase ?? "improve",
            ...(p.message ? { message: p.message } : {}),
            bestScore: p.bestScore ?? null,
            bestUnplaced: p.bestUnplaced ?? null,
            lowerBound,
            results: p.results ?? 0,
            iterations: p.iterations ?? 0,
            segmentMs: p.segmentMs ?? 0,
            at: new Date(),
          };
        } else done = m;
      });
      worker.on("error", (e) => { done = { type: "error", error: e instanceof Error ? e.message : String(e) }; });
      worker.on("exit", () => resolve());
    });
    const beat = setInterval(async () => {
      try {
        const r = await heartbeat(db, job._id, slotId, latest);
        if (!r) { leaseLost = true; Atomics.store(flag, 0, 1); }
        else if (r.stopRequested) Atomics.store(flag, 0, 1);
        if (r && job.kind !== "diagnose") {
          const lb = await knownLowerBound(db, job.termId, job.inputHash);
          if (lb !== null && (Number.isNaN(liveBound[0]) || lb > liveBound[0])) liveBound[0] = lb;
        }
      } catch { /* 다음 박동에서 다시 시도 */ }
    }, this.opts.heartbeatMs);
    try {
      await finished;
    } finally {
      clearInterval(beat);
    }
    const msg = done as EngineThreadMessage | null;
    if (leaseLost) { this.opts.log(`#${job.number} 임대를 잃음 (다른 작업자가 이어 받음)`); return; }
    if (!msg || msg.type === "error") {
      await failJob(db, job._id, slotId, msg?.type === "error" ? msg.error.split("\n")[0] : "계산 스레드가 결과 없이 끝났습니다.");
      this.opts.log(`#${job.number} 오류: ${msg?.type === "error" ? msg.error : "결과 없음"}`);
      return;
    }
    if (msg.type !== "done") return;
    if (job.kind === "diagnose") {
      await finishDiagnosis(db, job, slotId, msg.report, Boolean(msg.stopped));
      this.opts.log(`#${job.number} 진단 끝`);
      return;
    }
    const status = await finishSegment(db, job, slotId, msg.outcome as EngineOutcome);
    this.opts.log(`#${job.number} 구간 끝 → ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maxOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
