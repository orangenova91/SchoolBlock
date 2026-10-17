/**
 * v3 작업(Job) 저장과 상태 전이 (docs/v3-execution-design.md 2절, docs/v3-data-api-design.md 3·4절).
 *
 * 상태: queued(대기) → running(실행) → [구간 끝] queued(사전 승인) / awaiting(승인 대기) / done(완료)
 *       running → stopping(중지 요청) → stopped,  불가 증명 → infeasible,  오류 → error
 * 상태 바꾸기는 "지금 상태가 맞을 때만" 바꾸는 조건부 갱신으로 해서, 화면 요청과 작업자가 동시에 바꿔도 꼬이지 않는다.
 */
import { ObjectId, type Db } from "mongodb";
import type { V3Metrics } from "@/lib/v3/score";
import type { EngineCheckpoint, EngineKind, EngineOutcome, StoredResult } from "@/lib/v3/engines/types";

export const JOBS = "v3Jobs";
export const JOB_RESULTS = "v3JobResults";
export const CHECKPOINTS = "v3Checkpoints";

export const SEGMENT_MS = 5 * 60_000;
export const MAX_MS = 30 * 60_000;
export const EXTEND_MS = 5 * 60_000;
export const DIAGNOSE_BUDGET_MS = 10 * 60_000;
// 작업자가 이 시간 동안 소식이 없으면 끊긴 것으로 보고 다른 작업자가 이어 받는다 (시험용으로 V3_LEASE_MS 로 줄일 수 있음)
export const LEASE_MS = Number(process.env.V3_LEASE_MS ?? 60_000);
export const CHECKPOINT_TTL_DAYS = 30;
export const MAX_QUEUED_PER_TERM = 3;

export type DiagnoseKind = "feasibility" | "relax" | "fixedLoss" | "dataLimit";
export type V3JobKind = EngineKind | "diagnose";
export type V3JobStatus = "queued" | "running" | "stopping" | "awaiting" | "stopped" | "done" | "infeasible" | "error";

export type V3JobProgress = {
  phase: string;
  message?: string;
  bestScore: number | null;
  bestUnplaced: number | null;
  lowerBound: number | null;
  results: number;
  iterations: number;
  /** 이번 구간 경과 */
  segmentMs: number;
  at: Date;
};

export type V3JobDocument = {
  _id: ObjectId;
  termId: string;
  accountId: string;
  /** 학기 안 일련번호 (화면 표시용) */
  number: number;
  kind: V3JobKind;
  diagnose?: DiagnoseKind;
  inputHash: string;
  status: V3JobStatus;
  /** 사전 승인: 켜져 있으면 구간이 끝나도 묻지 않고 계속 (최대 시간까지) */
  autoContinue: boolean;
  segmentMs: number;
  /** 최대 시간 (30분 + 추가 승인분) */
  maxMs: number;
  /** 지금까지 쓴 계산 시간 (모든 구간 합) */
  elapsedMs: number;
  segments: number;
  seed: number;
  queuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  stopRequested: boolean;
  lease?: { workerId: string; until: Date } | null;
  progress?: V3JobProgress | null;
  lowerBound: number | null;
  /** 결과 요약 (점수 순) — 진행 조회에서 시간표 칸 없이 보여 줄 것 */
  summary: { results: { metrics: V3Metrics; foundAtMs: number }[]; bestUnplaced: number | null; stopReason: string | null };
  /** 진단 작업의 보고서 */
  diagnosis?: unknown;
  error?: string | null;
};

export type V3JobResultDocument = { _id?: ObjectId; jobId: string; termId: string; rank: number } & StoredResult;
export type V3CheckpointDocument = { _id?: ObjectId; jobId: string; termId: string; checkpoint: EngineCheckpoint; savedAt: Date; expiresAt: Date };

export class JobLimitError extends Error {}
export class JobStateError extends Error {}

const jobs = (db: Db) => db.collection<V3JobDocument>(JOBS);

export async function ensureJobIndexes(db: Db) {
  await Promise.all([
    jobs(db).createIndex({ status: 1, queuedAt: 1 }),
    jobs(db).createIndex({ termId: 1, createdAt: -1 }),
    jobs(db).createIndex({ status: 1, "lease.until": 1 }),
    db.collection(JOB_RESULTS).createIndex({ jobId: 1, rank: 1 }),
    db.collection(CHECKPOINTS).createIndex({ jobId: 1 }, { unique: true }),
    db.collection(CHECKPOINTS).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function createJob(
  db: Db,
  a: { termId: string; accountId: string; kind: V3JobKind; diagnose?: DiagnoseKind; inputHash: string; autoContinue?: boolean; seed?: number },
): Promise<V3JobDocument> {
  const waiting = await jobs(db).countDocuments({ termId: a.termId, status: "queued" });
  if (waiting >= MAX_QUEUED_PER_TERM) throw new JobLimitError(`이 시간표는 이미 대기 중인 작업이 ${waiting}개입니다 (최대 ${MAX_QUEUED_PER_TERM}개).`);
  const last = await jobs(db).find({ termId: a.termId }).sort({ number: -1 }).limit(1).next();
  const now = new Date();
  const doc: V3JobDocument = {
    _id: new ObjectId(),
    termId: a.termId,
    accountId: a.accountId,
    number: (last?.number ?? 0) + 1,
    kind: a.kind,
    ...(a.diagnose ? { diagnose: a.diagnose } : {}),
    inputHash: a.inputHash,
    status: "queued",
    autoContinue: a.autoContinue ?? false,
    segmentMs: a.kind === "diagnose" ? DIAGNOSE_BUDGET_MS : SEGMENT_MS,
    maxMs: a.kind === "diagnose" ? DIAGNOSE_BUDGET_MS : MAX_MS,
    elapsedMs: 0,
    segments: 0,
    seed: a.seed ?? Math.floor(Math.random() * 1e9),
    queuedAt: now,
    createdAt: now,
    updatedAt: now,
    stopRequested: false,
    lease: null,
    progress: null,
    lowerBound: null,
    summary: { results: [], bestUnplaced: null, stopReason: null },
    error: null,
  };
  await jobs(db).insertOne(doc);
  return doc;
}

/**
 * 가장 오래 기다린 대기 작업을 하나 가져간다. 같은 학기에 이미 실행 중인 작업이 있으면 건너뛴다(학기당 실행 1).
 * 임대가 끝난(작업자가 끊긴) 실행 작업도 다시 가져가 중단점에서 이어 간다.
 */
export async function claimNextJob(db: Db, workerId: string): Promise<V3JobDocument | null> {
  const now = new Date();
  // 끊긴 작업 되살리기
  await jobs(db).updateMany(
    { status: { $in: ["running", "stopping"] }, "lease.until": { $lt: now } },
    [{ $set: { status: { $cond: [{ $eq: ["$status", "stopping"] }, "stopped", "queued"] }, lease: null, updatedAt: now } }],
  );
  const candidates = await jobs(db).find({ status: "queued" }).sort({ queuedAt: 1 }).limit(20).toArray();
  for (const c of candidates) {
    const busy = await jobs(db).countDocuments({ termId: c.termId, status: { $in: ["running", "stopping"] } });
    if (busy > 0) continue;
    const claimed = await jobs(db).findOneAndUpdate(
      { _id: c._id, status: "queued" },
      { $set: { status: "running", lease: { workerId, until: new Date(Date.now() + LEASE_MS) }, startedAt: c.startedAt ?? now, updatedAt: now } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    // 동시에 같은 학기 작업을 가져간 작업자가 있으면 늦은 쪽이 돌려놓는다
    const other = await jobs(db).findOne({ termId: c.termId, status: { $in: ["running", "stopping"] }, _id: { $ne: c._id } });
    if (other) {
      await jobs(db).updateOne({ _id: c._id, "lease.workerId": workerId }, { $set: { status: "queued", lease: null } });
      continue;
    }
    return claimed;
  }
  return null;
}

/** 실행 중 2~3초마다: 임대 연장 + 진행 저장. 중지 요청 여부를 돌려준다 (임대를 잃었으면 null) */
export async function heartbeat(db: Db, jobId: ObjectId, workerId: string, progress: V3JobProgress | null): Promise<{ stopRequested: boolean } | null> {
  const r = await jobs(db).findOneAndUpdate(
    { _id: jobId, "lease.workerId": workerId, status: { $in: ["running", "stopping"] } },
    { $set: { "lease.until": new Date(Date.now() + LEASE_MS), updatedAt: new Date(), ...(progress ? { progress } : {}) } },
    { returnDocument: "after", projection: { stopRequested: 1 } },
  );
  return r ? { stopRequested: r.stopRequested } : null;
}

export async function loadCheckpoint(db: Db, jobId: ObjectId): Promise<EngineCheckpoint | null> {
  const doc = await db.collection<V3CheckpointDocument>(CHECKPOINTS).findOne({ jobId: String(jobId) });
  return doc?.checkpoint ?? null;
}

/** 구간 다음 상태 (순수 함수 — 테스트 대상) */
export function nextStatusAfterSegment(job: Pick<V3JobDocument, "kind" | "autoContinue" | "maxMs" | "stopRequested">, elapsedMs: number, stopReason: EngineOutcome["stopReason"] | "done"): V3JobStatus {
  if (stopReason === "user" || job.stopRequested) return "stopped";
  if (stopReason === "infeasible") return "infeasible";
  if (job.kind === "diagnose" || stopReason === "early" || stopReason === "done") return "done";
  if (elapsedMs >= job.maxMs - 1000) return "done";
  return job.autoContinue ? "queued" : "awaiting";
}

/** 구간 결과 저장: 결과 3개, 중단점(30일), 요약, 다음 상태. 임대를 가진 작업자만 저장할 수 있다 */
export async function finishSegment(db: Db, job: V3JobDocument, workerId: string, outcome: EngineOutcome): Promise<V3JobStatus | null> {
  const fresh = await jobs(db).findOne({ _id: job._id, "lease.workerId": workerId });
  if (!fresh) return null;
  const jobId = String(job._id);
  const now = new Date();
  await db.collection(JOB_RESULTS).deleteMany({ jobId });
  if (outcome.results.length) {
    await db.collection<V3JobResultDocument>(JOB_RESULTS).insertMany(outcome.results.map((r, rank) => ({ jobId, termId: job.termId, rank, ...r })));
  }
  await db.collection<V3CheckpointDocument>(CHECKPOINTS).updateOne(
    { jobId },
    { $set: { jobId, termId: job.termId, checkpoint: outcome.checkpoint, savedAt: now, expiresAt: new Date(now.getTime() + CHECKPOINT_TTL_DAYS * 86_400_000) } },
    { upsert: true },
  );
  const elapsedMs = outcome.checkpoint.elapsedMs;
  const status = nextStatusAfterSegment(fresh, elapsedMs, outcome.stopReason);
  await jobs(db).updateOne(
    { _id: job._id, "lease.workerId": workerId },
    {
      $set: {
        status,
        lease: null,
        elapsedMs,
        lowerBound: outcome.lowerBound,
        updatedAt: now,
        ...(status === "queued" ? { queuedAt: now } : {}),
        ...(status === "done" || status === "stopped" || status === "infeasible" ? { finishedAt: now } : {}),
        stopRequested: false,
        summary: {
          results: outcome.results.map((r) => ({ metrics: r.metrics, foundAtMs: r.foundAtMs })),
          bestUnplaced: outcome.results.length ? 0 : (outcome.bestIncomplete?.unplaced ?? null),
          stopReason: outcome.stopReason,
        },
      },
      $inc: { segments: 1 },
    },
  );
  return status;
}

/** 진단 작업 끝: 보고서 저장 */
export async function finishDiagnosis(db: Db, job: V3JobDocument, workerId: string, report: unknown, stopped: boolean): Promise<void> {
  const now = new Date();
  await jobs(db).updateOne(
    { _id: job._id, "lease.workerId": workerId },
    { $set: { status: stopped ? "stopped" : "done", lease: null, diagnosis: report, updatedAt: now, finishedAt: now, stopRequested: false }, $inc: { segments: 1 } },
  );
}

export async function failJob(db: Db, jobId: ObjectId, workerId: string | null, error: string, status: V3JobStatus = "error") {
  const now = new Date();
  await jobs(db).updateOne(
    workerId ? { _id: jobId, "lease.workerId": workerId } : { _id: jobId },
    { $set: { status, error, lease: null, updatedAt: now, finishedAt: now } },
  );
}

// ── 화면에서 오는 요청 (M5 API가 사용) ──

/** 중지: 대기·승인 대기 중이면 바로 중지, 실행 중이면 중지 요청 (작업자가 1초 안에 처리) */
export async function requestStop(db: Db, jobId: ObjectId): Promise<V3JobStatus> {
  const now = new Date();
  const idle = await jobs(db).findOneAndUpdate({ _id: jobId, status: { $in: ["queued", "awaiting"] } }, { $set: { status: "stopped", updatedAt: now, finishedAt: now } }, { returnDocument: "after" });
  if (idle) return idle.status;
  const running = await jobs(db).findOneAndUpdate({ _id: jobId, status: "running" }, { $set: { status: "stopping", stopRequested: true, updatedAt: now } }, { returnDocument: "after" });
  if (running) return running.status;
  const job = await jobs(db).findOne({ _id: jobId });
  if (!job) throw new JobStateError("작업이 없습니다.");
  return job.status;
}

/**
 * 이어 돌리기 승인 (5분). 승인 대기·중지·완료 상태에서, 입력이 그대로이고 중단점이 있을 때만.
 * 최대 시간을 다 썼으면 5분을 더한다.
 */
export async function approveContinue(db: Db, jobId: ObjectId, currentInputHash: string): Promise<V3JobDocument> {
  const job = await jobs(db).findOne({ _id: jobId });
  if (!job) throw new JobStateError("작업이 없습니다.");
  if (job.kind === "diagnose") throw new JobStateError("진단 작업은 이어 돌릴 수 없습니다. 새로 실행해 주세요.");
  if (!["awaiting", "stopped", "done"].includes(job.status)) throw new JobStateError("지금 상태에서는 이어 돌릴 수 없습니다.");
  if (job.inputHash !== currentInputHash) throw new JobStateError("작업 뒤에 입력이 바뀌어 이어 돌릴 수 없습니다. 새로 실행해 주세요.");
  const ck = await db.collection(CHECKPOINTS).countDocuments({ jobId: String(jobId) });
  if (!ck) throw new JobStateError("중단점이 없어(만료됨) 이어 돌릴 수 없습니다. 새로 실행해 주세요.");
  const maxMs = job.elapsedMs >= job.maxMs - 1000 ? job.elapsedMs + EXTEND_MS : job.maxMs;
  const now = new Date();
  const r = await jobs(db).findOneAndUpdate(
    { _id: jobId, status: job.status },
    { $set: { status: "queued", queuedAt: now, updatedAt: now, maxMs, stopRequested: false, error: null }, $unset: { finishedAt: "" } },
    { returnDocument: "after" },
  );
  if (!r) throw new JobStateError("작업 상태가 바뀌었습니다. 다시 시도해 주세요.");
  return r;
}

export async function setAutoContinue(db: Db, jobId: ObjectId, value: boolean) {
  await jobs(db).updateOne({ _id: jobId }, { $set: { autoContinue: value, updatedAt: new Date() } });
}
