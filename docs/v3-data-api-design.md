# v3 6단계: 데이터·API 설계 (2026-10-16)

## 0. 원칙

- **화면 스타일은 기존과 같게, 로직은 완전히 분리한다.** v1·v2를 고쳐도 v3 생성 결과가 바뀌지 않아야 한다.
- 마이그레이션 없이 선택 항목과 새 컬렉션만 추가한다.
- v3 학기는 `logicVersion: "v3"`이다. 학기 데이터는 `termId`로 나뉘므로, v1·v2 학기 데이터와 섞이지 않는다.
- 근거 문서
  - 정책: [v3-requirements.md](v3-requirements.md) 8절
  - 명세: [v3-model-spec.md](v3-model-spec.md)
  - 진단: [v3-diagnosis-design.md](v3-diagnosis-design.md)
  - 실행 구조: [v3-execution-design.md](v3-execution-design.md)

## 1. 분리 구조

### 1.1 무엇을 나누고 무엇을 함께 쓰는가

| 구분 | v3 처리 | 이유 |
|---|---|---|
| 주소(화면 경로) | **새 경로 `/v3/terms/[termId]/...`**. 자체 레이아웃·단계 표시줄 | 단계 구성이 다르고(SET 고정 의미, 생성 화면), 기존 경로를 건드리지 않는다 |
| 생성·결과·진단 화면 | **v3 전용 새 컴포넌트** (`components/v3/`) | 작업 번호·진행·중지·이어 돌리기·결과 3개 등 기존에 없는 화면 |
| SET 배치 화면 | **v3 전용** | "칠한 SET = 고정", 고정 요일 표시, 자동 배치 버튼의 의미가 다르다 |
| 추가 조건 화면 | **v3 전용** | 같은 SET 요일 배분은 고정 규칙. 가중치·근접 기준 표시 |
| 입력 화면 (학반·요일, 교과, 교사, 선 수업, 배정 불가) | **기존 화면 공유 (확정)**. 필요해지면 그때 분리 | 데이터 형식이 v1·v2·v3 모두 같다 |
| 생성 로직 | **전부 v3 전용** (`lib/v3/`). v1 `lib/timetable.ts` 생성기와 v2 `lib/timetable-improved.ts`는 쓰지 않는다 | 생성 로직 분리가 핵심 요구 |
| 데이터 해석 함수 (교과 목록·SET 목록·교사 배정 읽기) | 공유 (`lib/set-blocks`의 `catalogGradeSets` 등, `lib/types`) | 저장 형식이 같으므로 해석도 같아야 한다. v3 검증기 테스트로 변경 영향을 잡는다 |
| 시간표 보기(학년·교사·전체 교사 보기) | 공유 컴포넌트 사용 | 결과 형식(`TimetableCell`)이 같다. 표시 전용이라 생성 결과에 영향이 없다 |
| 확정 버전·내보내기 | 기존 `timetables`·`timetableVersions` 형식으로 저장 | 내보내기·보기 기능을 그대로 쓴다 (데이터 형식만 공유) |

### 1.2 코드 위치

```
app/v3/terms/[termId]/layout.tsx            v3 단계 표시줄 (자체)
app/v3/terms/[termId]/{days,subjects,teachers,blocks,constraints}/page.tsx   입력 화면 (기존 입력 컴포넌트를 그대로 불러 씀)
app/v3/terms/[termId]/sets/page.tsx          v3 SET 배치 (고정)
app/v3/terms/[termId]/preferences/page.tsx   v3 추가 조건
app/v3/terms/[termId]/timetable/page.tsx     v3 생성·진행·결과
app/api/terms/[termId]/v3/...                v3 API (2절)
components/v3/*                              v3 화면 컴포넌트
lib/v3/model.ts        정수계획 모델 (명세 H1~H12, S1~S3; 실험 model.py 이식)
lib/v3/search.ts       탐색 (실험 sa.ts 이식: 과목별 담당, 순환 교사 교환, SET 회차 이동)
lib/v3/hybrid.ts       혼합 (실험 highs-run.ts 이식: 시작 해 전달, 부분 재계산, 보수)
lib/v3/milp.ts         정수계획 단독
lib/v3/validate.ts     검증기 (명세 그대로; 모든 결과 저장 전 통과 필수)
lib/v3/quick-check.ts  빠른 검사 5종
lib/v3/diagnose.ts     배치 가능 판정, 최소 완화, 고정 손실, 데이터 한계
lib/v3/results.ts      상위 3개 관리 (30칸·5% 차이 규칙), 근접 판정
lib/v3/jobs.ts         작업 저장·상태 전이·임대·중단점
lib/v3/worker.ts       작업자 (작업 꺼내기 → 구간 실행 → 저장). 실행 방식에 독립
lib/v3/input.ts        학기 입력 읽기 + 입력 지문(해시)
```

홈 화면은 기존 코드에서 두 곳만 바꾼다.
- 새 시간표 작성(v3) 버튼
- v3 학기를 누르면 `/v3/...`로 이동

나머지 v1·v2 코드는 고치지 않는다.

## 2. API

모든 API는 로그인과 학기 소유를 확인한다(기존 `findOwnedTerm` 사용). v3가 아닌 학기에는 400을 돌려준다.

| 방법·경로 | 하는 일 | 응답 |
|---|---|---|
| `GET /api/terms/[termId]/v3/checks` | 빠른 검사 (밀리초). 입력 지문이 같으면 저장된 진단 결과도 함께 | 경고 목록(확정 부족·여유 없음), 저장된 진단 |
| `POST /api/terms/[termId]/v3/jobs` | 작업 만들기. `{ kind: "search" \| "milp" \| "hybrid" \| "diagnose", diagnose?: "feasibility" \| "relax" \| "fixedLoss" \| "dataLimit", autoContinue?: boolean }` | `{ jobId, number, status, queuePosition }`. 학기당 실행 1 + 대기 3 초과 시 409 |
| `GET /api/terms/[termId]/v3/jobs` | 이 학기의 최근 작업 목록 | 작업 요약 목록 |
| `GET /api/terms/[termId]/v3/jobs/[jobId]` | 진행 상태 (화면이 2~3초마다 호출). 시간표 칸은 빼고 가볍게 | 상태, 대기 순번, 경과/최대 시간, 단계, 현재 최선, 이론상 최선(범위), 근접 여부, 결과 요약(점수·항목), 승인 필요 여부 |
| `PATCH /api/terms/[termId]/v3/jobs/[jobId]` | `{ autoContinue }` 사전 승인 토글 | 상태 |
| `POST /api/terms/[termId]/v3/jobs/[jobId]/stop` | 중지 요청 | 상태 (`stopping` → 작업자가 1초 안에 처리) |
| `POST /api/terms/[termId]/v3/jobs/[jobId]/continue` | 이어 돌리기 승인 (5분). 입력 지문이 바뀌었거나 중단점이 만료되면 409 | 상태 (`queued`) |
| `GET /api/terms/[termId]/v3/jobs/[jobId]/results` | 상위 3개 결과 (시간표 칸 포함) | 결과 목록 |
| `POST /api/terms/[termId]/v3/jobs/[jobId]/results/[rank]/apply` | 결과를 현재 시간표로 적용하고 확정 버전으로 저장 (검증기 재확인 후) | 버전 정보 |
| `POST /api/v3/worker/tick` | (내부용) 작업자 한 구간 실행. 서버리스 배포에서 대기열을 돌리는 데 쓴다. 비밀 키로만 호출 | 처리한 작업 |

진단(배치 가능 판정, 최소 완화, 고정 손실, 데이터 한계)도 **같은 작업 구조**로 돈다. 수 분이 걸릴 수 있어 대기열·진행 표시·중지가 그대로 필요하기 때문이다.

## 3. 데이터

### 3.1 기존 컬렉션 (형식 변경 없음, v3 학기도 같은 형식으로 저장)

| 컬렉션 | v3에서의 의미 |
|---|---|
| `terms` | `logicVersion: "v3"` |
| `daySchedules`, `subjects`, `teachers`, `subjectBlocks`, `teacherConstraints` | 그대로 |
| `setBlocks` | `cells`·`partialCells` = **사용자가 고정한 SET 회차** (정책: 배치 = 고정). `teacherAssignments` = 사용자가 지정한 순환 담당 (지정 안 한 것은 생성기가 정함) |
| `generationPreferences` | 동일 교과 금지, 점심 위치 등 그대로. v3 가중치는 이 문서의 `v3Weights` 항목에 (v2의 `v2Weights`와 같은 방식) |
| `timetables`, `timetableVersions` | 결과를 "적용"하면 이 형식으로 저장 (보기·내보내기 공유). 버전 메모에 "v3 · 혼합 · 점수 31 (최선 24, 근접)" 등 기록 |

### 3.2 새 컬렉션

| 컬렉션 | 내용 | 비고 |
|---|---|---|
| `v3Jobs` | 작업: 번호, 학기, 요청자, 종류, 입력 지문, 상태, 시간(누적·구간·최대), 사전 승인, 진행 정보, 결과 요약, 요청 표시(중지·승인), 작업자 임대, 만든·바뀐 시각, 오류 | 진행 조회는 이 문서만 읽는다 |
| `v3JobResults` | 작업별 상위 3개 결과: 순위, 점수, 항목별 수치, 시간표 칸, SET 회차별 과목 담당, 방식, 찾은 시각, 검증 결과 | 결과 조회·적용 때만 읽는다 |
| `v3Checkpoints` | 작업별 중단점: 방식별 상태 (탐색: 최선 시간표 / 혼합·정수계획: 변수 0·1 해), 하한, 저장 시각, 만료 시각(30일) | 문서당 수십~수백 KB. MongoDB TTL 색인으로 30일 뒤 자동 삭제 |
| `v3Diagnostics` | 입력 지문별 진단 결과: 배치 가능 여부·최소 미배치, 최소 완화 목록, 고정 손실, 데이터 한계 | v2 `v2PlacementChecks`와 같은 재사용 방식 |

- 모든 새 컬렉션은 `termId`를 갖고 `lib/account-cleanup.ts`의 `TERM_CHILD_COLLECTIONS`에 추가한다(계정·학기 삭제 시 함께 삭제). 이 파일은 공용이라 목록 추가만 한다.
- 학기 복제·가져오기·내보내기(`term-bundle`)는 입력 데이터만 다루므로 그대로 동작한다. `logicVersion: "v3"`만 전달되면 된다.

### 3.3 색인

| 컬렉션 | 색인 | 용도 |
|---|---|---|
| `v3Jobs` | `{ status: 1, queuedAt: 1 }` | 작업자가 가장 오래 기다린 작업을 꺼냄 |
| `v3Jobs` | `{ termId: 1, createdAt: -1 }` | 학기별 목록 |
| `v3Jobs` | `{ status: 1, leaseUntil: 1 }` | 끊긴 작업 회수 |
| `v3JobResults`, `v3Checkpoints` | `{ jobId: 1 }` | |
| `v3Checkpoints` | TTL `{ expiresAt: 1 }` | 30일 자동 삭제 |
| `v3Diagnostics` | `{ termId: 1, inputHash: 1, kind: 1 }` | 재사용 |

### 3.4 입력 지문 (해시)

생성에 영향을 주는 입력을 정해진 순서로 이어 붙여 SHA-256 해시를 만든다.
- 반·교시, 교과, 교사 배정
- 고정 SET과 지정 순환 담당
- 선 수업, 배정 불가
- 동일 교과 금지·점심 위치, 가중치

이 해시가 같아야 중단점·진단을 다시 쓸 수 있다. v2 `timetable-check-cache.ts`와 같은 방식이지만 v3 전용으로 따로 둔다.

## 4. 작업 상태 (5단계 설계를 데이터로)

| 상태 | 뜻 | 다음 |
|---|---|---|
| `queued` | 대기 | 작업자가 가져가면 `running` |
| `running` | 5분 구간 실행 중 | 구간 끝 → (사전 승인 & 30분 전) `queued` / `awaiting` / `done`, 중지 → `stopped`, 불가 증명 → `infeasible` |
| `stopping` | 중지 요청됨 | 작업자가 저장 후 `stopped` |
| `awaiting` | 다음 구간 승인 대기 (중단점 저장됨, 작업자 없음) | 승인 → `queued` |
| `stopped` | 사용자 중지 | 이어 돌리기 승인 → `queued` |
| `done` | 조기 종료 또는 최대 시간 도달 | 추가 실행 승인 → `queued` |
| `infeasible` | 미배치 0 불가 증명 (원인 포함) | 끝 (입력을 고친 뒤 새 작업) |
| `error` | 오류 | 끝 |

상태 바꾸기는 MongoDB 조건부 갱신(현재 상태가 맞을 때만 바꿈)으로 해서, 화면 요청과 작업자가 동시에 바꿔도 꼬이지 않게 한다.

## 5. 작업자 실행 방식 (배포 단계에서 선택)

같은 `lib/v3/worker.ts`를 세 가지 방식으로 돌릴 수 있게 만든다.

| 방식 | 언제 | 방법 |
|---|---|---|
| 상시 작업자 (별도 Node 프로세스) | 상시 서버(자체 서버·컨테이너)에서 권장 | `node worker.js`가 대기열을 계속 확인. 코어 수만큼 띄움 |
| 서버 안 작업 스레드 | 별도 프로세스를 못 띄우는 상시 서버 | Next.js 서버가 `worker_threads`로 작업자 실행. 계산이 웹 요청을 막지 않음 |
| 구간 호출 (서버리스) | Vercel 등 | 작업이 생기거나 승인되면 `POST /api/v3/worker/tick` 호출 → 한 구간(제한 시간 안) 실행 후 중단점 저장 → 다음 구간 다시 호출. 정기 호출(cron)로 끊긴 작업 회수 |

## 6. 저장 형식 호환 원칙 (2026-10-16 확정)

- 화면과 계산 로직은 분리하고, **저장 형식은 기존과 호환**한다.
- 입력과 확정 결과는 기존 컬렉션에 기존 형식 그대로 저장한다. 그래서 v3 학기도 기존 기능을 그대로 쓸 수 있다.
  - 복제·가져오기·내보내기
  - 시간표 보기
  - 확정 버전
- 새 컬렉션은 **기존에 없던 종류의 데이터에만** 만든다.
  - 작업(`v3Jobs`)
  - 작업별 결과 3개(`v3JobResults`)
  - 중단점(`v3Checkpoints`)
  - 진단(`v3Diagnostics`)
- v3 설정(가중치)은 v2처럼 기존 문서에 항목을 하나 더한다(`generationPreferences.v3Weights`). 새 컬렉션을 만들지 않는다.
- 기존 입력 API가 `timetables`를 건드리는 곳은 v1 전용 항목(점심·동일 교과 우선 배치 잠금)을 지우는 것뿐이라 v3와 충돌하지 않는다.

## 7. 확정 사항 (2026-10-16)

1. 입력 화면은 공유한다. 필요하면 나중에 분리한다.
2. v3 SET 화면에는 자동 배치 버튼을 표시하지 않는다.
3. 저장 형식은 호환을 유지한다 (6절).
