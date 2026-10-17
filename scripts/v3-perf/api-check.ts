/**
 * M5 확인: v3 API 흐름을 실제 개발 서버에 대고 확인한다. 만든 시험 학기는 끝에 지운다.
 * usage: V3_TEST_USER=... V3_TEST_PASS=... npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/api-check.ts [http://localhost:3000]
 */
import demo from "@/lib/demo-seed-set-example.json";

const BASE = process.argv[2] ?? "http://localhost:3000";
let cookie = "";
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"}  ${name}  ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown, auth = true) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* 페이지 응답 */ }
  return { status: res.status, json, ms: Date.now() - t0 };
}

type Job = { id: string; status: string; results: { metrics: { score: number } }[]; canContinue: boolean; progress: { segmentMs: number } | null };

async function waitJob(termId: string, jobId: string, pred: (j: Job) => boolean, timeoutMs: number) {
  const t0 = Date.now();
  for (;;) {
    const r = await call("GET", `/api/terms/${termId}/v3/jobs/${jobId}`);
    const j = r.json.job as Job;
    if (j && pred(j)) return { job: j, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { job: j, ms: -1 };
    await sleep(500);
  }
}

async function importTerm(name: string, opts: { clearSets: boolean }) {
  const d = structuredClone(demo) as Record<string, unknown> & { setBlocks: Record<string, unknown> };
  if (opts.clearSets) d.setBlocks = { cells: [], partialCells: [], teacherAssignments: [] };
  const r = await call("POST", "/api/terms/import", { ...d, timetableName: name, logicVersion: "v3" });
  if (r.status !== 201) throw new Error(`import failed ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id as string;
}

async function main() {
  const login = await call("POST", "/api/auth/login", { username: process.env.V3_TEST_USER, password: process.env.V3_TEST_PASS });
  if (login.status !== 200) throw new Error(`login failed ${login.status}`);
  const created: string[] = [];
  try {
    // 권한
    const anon = await call("GET", `/api/terms/000000000000000000000000/v3/checks`, undefined, false);
    check("로그인 없으면 401", anon.status === 401, `${anon.status}`);

    // 입력 모순 (체험용 데이터: 고정 SET과 선 수업이 겹침) → 생성 거절
    const conflictTerm = await importTerm("[v3 API 시험] 입력 모순", { clearSets: false });
    created.push(conflictTerm);
    const c1 = await call("GET", `/api/terms/${conflictTerm}/v3/checks`);
    const quick = c1.json.quick as { blocking: boolean; warnings: { rule: string }[] };
    check("빠른 검사가 선 수업 모순을 오류로 표시", c1.status === 200 && quick.blocking && quick.warnings.some((w) => w.rule === "pinConflict"), `${c1.ms}ms`);
    const refused = await call("POST", `/api/terms/${conflictTerm}/v3/jobs`, { kind: "search" });
    check("모순이 있으면 생성 작업을 만들지 않음 (409)", refused.status === 409, String(refused.json.error ?? ""));
    const diag = await call("POST", `/api/terms/${conflictTerm}/v3/jobs`, { kind: "diagnose", diagnose: "feasibility" });
    check("진단 작업은 만들 수 있음", diag.status === 201);
    await call("POST", `/api/terms/${conflictTerm}/v3/jobs/${(diag.json.job as Job).id}/stop`);

    // 정상 입력 (SET 모두 자동)
    const term = await importTerm("[v3 API 시험] SET 자동", { clearSets: true });
    created.push(term);
    const c2 = await call("GET", `/api/terms/${term}/v3/checks`);
    check("빠른 검사 통과", c2.status === 200 && !(c2.json.quick as { blocking: boolean }).blocking, `${c2.ms}ms`);

    // 중요도 설정
    const badW = await call("PUT", `/api/terms/${term}/v3/settings`, { weights: { lunch: 4, triple: 2, sameDay: 3 } });
    const okW = await call("PUT", `/api/terms/${term}/v3/settings`, { weights: { lunch: 5, triple: 2, sameDay: 3 } });
    check("중요도: 허용 값만 저장 (4는 거절, 5는 저장)", badW.status === 400 && okW.status === 200);

    // 생성 → 실행 중 웹 응답 → 중지
    const made = await call("POST", `/api/terms/${term}/v3/jobs`, { kind: "search" });
    check("생성 작업 만들기 (201)", made.status === 201);
    const jobId = (made.json.job as Job).id;
    const run = await waitJob(term, jobId, (j) => j.status === "running" && (j.progress?.segmentMs ?? 0) > 3000, 60_000);
    check("작업자가 작업을 가져가 실행", run.ms >= 0, `대기열 → 실행 ${run.ms}ms`);
    const lat: number[] = [];
    for (let i = 0; i < 10; i++) {
      lat.push((await call("GET", `/api/terms/${term}/v3/checks`)).ms);
      lat.push((await call("GET", `/`)).ms);
      await sleep(300);
    }
    const sorted = [...lat].sort((a, b) => a - b);
    check("계산 중에도 웹 요청이 막히지 않음", sorted[sorted.length - 1] < 2000, `응답 시간 중앙값 ${sorted[Math.floor(sorted.length / 2)]}ms, 최대 ${sorted[sorted.length - 1]}ms (20회)`);
    await sleep(8000);
    const t0 = Date.now();
    await call("POST", `/api/terms/${term}/v3/jobs/${jobId}/stop`);
    const stopped = await waitJob(term, jobId, (j) => j.status === "stopped", 20_000);
    check("중지 요청 → 중지됨", stopped.ms >= 0, `${Date.now() - t0}ms, 결과 ${stopped.job.results.length}개, 최선 ${stopped.job.results[0]?.metrics.score}`);

    // 결과 → 적용 → 확정 버전
    const res = await call("GET", `/api/terms/${term}/v3/jobs/${jobId}/results`);
    const list = res.json.results as { rank: number; cells: unknown[]; diffFromTop: number }[];
    check("결과 조회 (시간표 칸 포함)", res.status === 200 && list.length > 0 && list[0].cells.length > 0, `결과 ${list.length}개, 1위와 다른 칸 ${list.map((x) => x.diffFromTop).join("·")}`);
    const applied = await call("POST", `/api/terms/${term}/v3/jobs/${jobId}/results/0/apply`);
    check("결과 적용 → 확정 버전 저장, 메모 자동 기록", applied.status === 200 && typeof applied.json.version === "number", String(applied.json.note ?? applied.json.error ?? ""));
    const versions = await call("GET", `/api/terms/${term}/timetable/versions`);
    const vlist = (versions.json.versions ?? []) as { note: string | null }[];
    check("기존 확정 버전 화면 API에 v3 결과가 보임", vlist.some((v) => (v.note ?? "").startsWith("v3 ·")), `${vlist.length}개`);

    // 이어 돌리기 → 대기 3개 제한
    const cont = await call("POST", `/api/terms/${term}/v3/jobs/${jobId}/continue`);
    check("이어 돌리기 승인 → 대기열", cont.status === 200 && (cont.json.job as Job).status === "queued");
    await waitJob(term, jobId, (j) => j.status === "running", 30_000);
    const extra: number[] = [];
    for (let i = 0; i < 4; i++) extra.push((await call("POST", `/api/terms/${term}/v3/jobs`, { kind: "hybrid" })).status);
    check("학기당 대기 3개 제한 (4번째는 409)", extra.join(",") === "201,201,201,409", extra.join(","));
    const all = await call("GET", `/api/terms/${term}/v3/jobs`);
    for (const j of all.json.jobs as Job[]) if (["queued", "running", "awaiting"].includes(j.status)) await call("POST", `/api/terms/${term}/v3/jobs/${j.id}/stop`);
    await waitJob(term, jobId, (j) => j.status === "stopped", 20_000);

    // v3가 아닌 학기
    const terms = await call("GET", "/api/terms");
    const nonV3 = ((terms.json.terms ?? []) as { id: string; logicVersion: string | null }[]).find((t) => t.logicVersion !== "v3");
    if (nonV3) {
      const r = await call("GET", `/api/terms/${nonV3.id}/v3/checks`);
      check("v3가 아닌 학기는 400", r.status === 400, `${r.status}`);
    }
  } finally {
    for (const id of created) {
      const del = await call("DELETE", `/api/terms/${id}`);
      check("시험 학기 삭제 (v3 작업 기록도 함께)", del.status === 200 || del.status === 204, `${del.status}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} / ${results.length} 통과`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
