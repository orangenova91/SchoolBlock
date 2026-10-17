/**
 * 계산 스레드 (worker_threads 진입점). 계산만 한다. DB·웹 요청은 조정자(coordinator)가 맡는다.
 *
 * - 계산은 이 스레드를 끝날 때까지 붙잡으므로, 중지 신호는 공유 메모리(Atomics)로 받는다.
 * - 진행 상황은 postMessage 로 조정자에게 보낸다 (계산 중에도 보낼 수 있음).
 * - 구간이 끝나면 스레드도 끝난다 → 계산기(WebAssembly) 메모리가 함께 풀린다.
 */
import { parentPort, workerData } from "node:worker_threads";
import { diagnoseDataLimit, diagnoseFeasibility, diagnoseFixedLoss, diagnoseRelax } from "@/lib/v3/diagnose";
import { runHybrid } from "@/lib/v3/engines/hybrid";
import { runMilp } from "@/lib/v3/engines/milp";
import { runSearch } from "@/lib/v3/engines/search";
import type { EngineCheckpoint, EngineProgress } from "@/lib/v3/engines/types";
import type { V3Input } from "@/lib/v3/input";
import { buildInstance } from "@/lib/v3/instance";
import type { DiagnoseKind, V3JobKind } from "@/lib/v3/jobs";

export type EngineThreadInput = {
  kind: V3JobKind;
  diagnose?: DiagnoseKind;
  input: V3Input;
  checkpoint: EngineCheckpoint | null;
  budgetMs: number;
  lowerBound: number | null;
  seed: number;
  stopBuffer: SharedArrayBuffer;
};

export type EngineThreadMessage =
  | { type: "progress"; progress: Partial<EngineProgress> & { message?: string } }
  | { type: "done"; outcome?: unknown; report?: unknown; stopped?: boolean }
  | { type: "error"; error: string };

async function main() {
  const data = workerData as EngineThreadInput;
  const flag = new Int32Array(data.stopBuffer);
  const shouldStop = () => Atomics.load(flag, 0) === 1;
  const post = (m: EngineThreadMessage) => parentPort!.postMessage(m);
  const inst = buildInstance(data.input);
  const base = { input: data.input, inst, budgetMs: data.budgetMs, seed: data.seed, shouldStop };
  if (data.kind === "diagnose") {
    const run = { ...base, onProgress: (message: string) => post({ type: "progress", progress: { phase: "diagnose", message } }) };
    const report =
      data.diagnose === "relax" ? await diagnoseRelax(run)
      : data.diagnose === "fixedLoss" ? await diagnoseFixedLoss(run)
      : data.diagnose === "dataLimit" ? await diagnoseDataLimit(run)
      : await diagnoseFeasibility(run);
    post({ type: "done", report, stopped: shouldStop() });
    return;
  }
  const run = { ...base, checkpoint: data.checkpoint, lowerBound: data.lowerBound, onProgress: (p: EngineProgress) => post({ type: "progress", progress: p }) };
  const outcome = data.kind === "search" ? runSearch(run) : data.kind === "milp" ? await runMilp(run) : await runHybrid(run);
  post({ type: "done", outcome });
}

main().catch((e) => parentPort!.postMessage({ type: "error", error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) } satisfies EngineThreadMessage));
