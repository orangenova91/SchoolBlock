/**
 * M7 확인용: 시험 시간표를 v3로 만든다 (화면에서 처음부터 끝까지 돌려 보기 위함). 이름은 "[v3 시험] …".
 *   case:K4      — scripts/v3-perf/cases.ts 의 조건을 v3 시간표로 (가져오기 형식으로 바꿈)
 *   copy:<학기ID> — 기존 시간표를 내보내기 → v3로 가져오기 (원본은 그대로)
 *   copy-v1:<학기ID>, copy-v2:<학기ID> — v1·v2 회귀 확인용 복사본 (로직은 v1·v2)
 *   --delete     — "[v3 시험]"으로 시작하는 시간표를 모두 지움
 * usage: V3_TEST_USER=... V3_TEST_PASS=... npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/make-terms.ts case:K4 copy:<id> [--delete]
 */
import type { TermBundle } from "@/lib/term-bundle";
import { loadV3Case } from "./cases";

const BASE = process.env.V3_BASE ?? "http://localhost:3000";
const PREFIX = "[v3 시험]";
let cookie = "";

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

function bundleFromCase(name: string): TermBundle {
  const i = loadV3Case(name);
  return {
    version: 1,
    timetableName: `${PREFIX} ${name}`,
    academicYear: 2026,
    semester: 1,
    logicVersion: "v3",
    teachers: i.teachers,
    subjects: i.subjects,
    daySchedule: { classCounts: i.classCounts, grades: i.schedules },
    preferences: i.preferences,
    setBlocks: { cells: i.fixedWholeCells, partialCells: i.fixedPartialCells, teacherAssignments: i.teacherAssignments },
    subjectBlocks: { cells: i.pins },
    teacherConstraints: { forbiddenSlots: i.forbiddenSlots },
  };
}

async function main() {
  const login = await call("POST", "/api/auth/login", { username: process.env.V3_TEST_USER, password: process.env.V3_TEST_PASS });
  if (login.status !== 200) throw new Error(`login failed ${login.status}`);
  const args = process.argv.slice(2);
  if (args.includes("--delete")) {
    const terms = (await call("GET", "/api/terms")).json.terms as { id: string; timetableName: string }[];
    for (const t of terms.filter((x) => x.timetableName?.startsWith(PREFIX))) {
      console.log("삭제", t.timetableName, (await call("DELETE", `/api/terms/${t.id}`)).status);
    }
  }
  for (const a of args.filter((x) => !x.startsWith("--"))) {
    let bundle: TermBundle;
    if (a.startsWith("case:")) bundle = bundleFromCase(a.slice(5));
    else if (a.startsWith("copy")) {
      const [kind, id] = a.split(":");
      const ex = await call("GET", `/api/terms/${id}/export`);
      if (ex.status !== 200) throw new Error(`export failed ${ex.status}`);
      const src = ex.json as unknown as TermBundle;
      const as = kind === "copy-v1" ? undefined : kind === "copy-v2" ? "v2" : "v3";
      bundle = { ...src, timetableName: `${PREFIX} ${src.timetableName} (${as ?? "v1"})`, logicVersion: as };
    } else throw new Error(`알 수 없는 인자: ${a}`);
    const r = await call("POST", "/api/terms/import", bundle);
    if (r.status !== 201) throw new Error(`import failed ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`${r.json.id}\t${bundle.timetableName}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
