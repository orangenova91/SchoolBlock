/**
 * v3 API 공통: 로그인·학기 소유·v3 학기 확인, 작업 조회, 화면에 보낼 작업 상태 만들기.
 */
import { ObjectId, type Db } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAccountId } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import { JOBS, knownLowerBound, type V3JobDocument } from "@/lib/v3/jobs";
import { judge, nearThreshold, strictThreshold } from "@/lib/v3/score";

export type V3TermContext = { accountId: string; termId: string; db: Db };

/** 성공하면 학기 정보, 실패하면 바로 돌려줄 응답 */
export async function requireV3Term(request: Request, termId: string): Promise<V3TermContext | NextResponse> {
  const accountId = await getAccountId(request);
  if (!accountId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!ObjectId.isValid(termId)) return NextResponse.json({ error: "올바르지 않은 학기 ID입니다." }, { status: 400 });
  const term = await findOwnedTerm(termId, accountId);
  if (!term) return NextResponse.json({ error: "학기 정보를 찾을 수 없습니다." }, { status: 404 });
  if (term.logicVersion !== "v3") return NextResponse.json({ error: "v3 시간표에서만 사용할 수 있습니다." }, { status: 400 });
  return { accountId, termId, db: await getDb() };
}

export async function findTermJob(db: Db, termId: string, jobId: string): Promise<V3JobDocument | null> {
  if (!ObjectId.isValid(jobId)) return null;
  return db.collection<V3JobDocument>(JOBS).findOne({ _id: new ObjectId(jobId), termId });
}

export function jobNotFound() {
  return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
}

export function serverError(where: string, error: unknown) {
  console.error(`v3 ${where} failed:`, error);
  return NextResponse.json({ error: "서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 500 });
}

/** 진단 보고서에서 화면에 필요 없는 큰 항목(시간표 칸)을 뺀다 */
function slimDiagnosis(d: unknown) {
  if (!d || typeof d !== "object") return d ?? null;
  const { solution, ...rest } = d as Record<string, unknown>;
  void solution;
  return rest;
}

/** 화면이 2~3초마다 읽는 작업 상태 (시간표 칸은 빼서 가볍게) */
export async function jobView(db: Db, job: V3JobDocument, currentInputHash?: string) {
  const queuePosition = job.status === "queued"
    ? (await db.collection<V3JobDocument>(JOBS).countDocuments({ status: "queued", queuedAt: { $lt: job.queuedAt } })) + 1
    : null;
  const best = job.summary.results[0]?.metrics ?? null;
  // 이 작업의 하한과, 같은 입력의 다른 작업(하한 계산)이 증명한 하한 중 높은 것
  const known = await knownLowerBound(db, job.termId, job.inputHash);
  const lb = job.lowerBound === null ? known : known === null ? job.lowerBound : Math.max(job.lowerBound, known);
  const judgement = best ? judge(best, { lower: lb, proven: false }) : null;
  const finished = ["awaiting", "stopped", "done"].includes(job.status);
  const inputChanged = currentInputHash !== undefined && currentInputHash !== job.inputHash;
  return {
    id: String(job._id),
    number: job.number,
    kind: job.kind,
    diagnose: job.diagnose ?? null,
    status: job.status,
    autoContinue: job.autoContinue,
    segmentMs: job.segmentMs,
    maxMs: job.maxMs,
    elapsedMs: job.elapsedMs,
    segments: job.segments,
    queuePosition,
    progress: job.progress ?? null,
    lowerBound: lb === null ? null : Math.max(0, Math.ceil(lb - 1e-6)),
    nearThreshold: lb === null ? null : nearThreshold(Math.max(0, Math.ceil(lb - 1e-6))),
    strictThreshold: lb === null ? null : strictThreshold(Math.max(0, Math.ceil(lb - 1e-6))),
    judgement,
    results: job.summary.results,
    bestUnplaced: job.summary.bestUnplaced,
    stopReason: job.summary.stopReason,
    diagnosis: job.kind === "diagnose" ? slimDiagnosis(job.diagnosis) : null,
    error: job.error ?? null,
    inputChanged,
    canContinue: job.kind !== "diagnose" && finished && !inputChanged,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export type V3JobView = Awaited<ReturnType<typeof jobView>>;
