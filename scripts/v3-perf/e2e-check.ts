/**
 * M7 확인: v3 시간표마다 혼합 1구간(5분) → 자동 하한 → 결과 → 검증·적용을 실제 개발 서버에서 돌린다.
 * 완성본이 없으면 배치 가능 판정 → 원인 찾기까지 이어서 돌린다.
 * usage: V3_TEST_USER=... V3_TEST_PASS=... npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/e2e-check.ts <이름=학기ID> ...
 */
const BASE = process.env.V3_BASE ?? "http://localhost:3000";
let cookie = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${m}`);

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, json: {} as Record<string, unknown> };
  }
}

type Job = {
  id: string; number: number; status: string; elapsedMs: number; lowerBound: number | null; nearThreshold: number | null;
  results: { metrics: { score: number } }[]; bestUnplaced: number | null; stopReason: string | null; diagnosis: unknown;
};

async function waitDone(termId: string, jobId: string): Promise<Job> {
  for (;;) {
    const j = (await call("GET", `/api/terms/${termId}/v3/jobs/${jobId}`)).json.job as Job;
    if (!["queued", "running", "stopping"].includes(j.status)) return j;
    await sleep(3000);
  }
}

async function diagnose(termId: string, kind: string) {
  const r = await call("POST", `/api/terms/${termId}/v3/jobs`, { kind: "diagnose", diagnose: kind });
  const j = await waitDone(termId, (r.json.job as Job).id);
  return { status: j.status, elapsedMs: j.elapsedMs, report: j.diagnosis };
}

async function runTerm(name: string, termId: string) {
  const checks = (await call("GET", `/api/terms/${termId}/v3/checks`)).json as { quick: { blocking: boolean; minUnplaced: number; ms: number } };
  log(`${name}: 빠른 검사 ${checks.quick.blocking || checks.quick.minUnplaced > 0 ? "실패" : "통과"} (${checks.quick.ms.toFixed(1)}ms)`);
  const made = await call("POST", `/api/terms/${termId}/v3/jobs`, { kind: "hybrid" });
  if (made.status !== 201) { log(`${name}: 생성 거절 ${made.status} ${made.json.error}`); return; }
  const job = await waitDone(termId, (made.json.job as Job).id);
  const boundId = made.json.boundJobId as string | null;
  if (boundId) await waitDone(termId, boundId);
  const fresh = (await call("GET", `/api/terms/${termId}/v3/jobs/${job.id}`)).json.job as Job;
  const scores = fresh.results.map((r) => r.metrics.score).join("·");
  log(`${name}: 혼합 ${fresh.status} (${Math.round(fresh.elapsedMs / 1000)}초, ${fresh.stopReason}) 결과 ${scores || "없음"} / 미배치 ${fresh.bestUnplaced ?? "-"} / 하한 ${fresh.lowerBound ?? "-"} · 목표 ${fresh.nearThreshold ?? "-"}점 이하`);
  if (fresh.results.length) {
    const res = (await call("GET", `/api/terms/${termId}/v3/jobs/${job.id}/results`)).json.results as { judgement: { near: boolean | null; gapToNear: number | null }; diffFromTop: number }[];
    log(`${name}: 판정 ${res.map((r) => (r.judgement.near ? "달성" : `목표까지 ${r.judgement.gapToNear}`)).join(" / ")}, 1번과 다른 칸 ${res.map((r) => r.diffFromTop).join("·")}`);
    const ap = await call("POST", `/api/terms/${termId}/v3/jobs/${job.id}/results/0/apply`);
    log(`${name}: 적용 ${ap.status} ${ap.json.note ?? ap.json.error}`);
  } else {
    const f = await diagnose(termId, "feasibility");
    log(`${name}: 배치 가능 판정 ${JSON.stringify(f.report).slice(0, 400)}`);
    const r = await diagnose(termId, "relax");
    log(`${name}: 원인 찾기 ${JSON.stringify(r.report).slice(0, 600)}`);
  }
}

async function main() {
  const login = await call("POST", "/api/auth/login", { username: process.env.V3_TEST_USER, password: process.env.V3_TEST_PASS });
  if (login.status !== 200) throw new Error(`login failed ${login.status}`);
  for (const a of process.argv.slice(2)) {
    const [name, id] = a.split("=");
    await runTerm(name, id);
  }
  log("끝");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
