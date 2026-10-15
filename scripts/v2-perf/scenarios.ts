import type { SchoolSpec } from "./school";

/**
 * v2 성능 측정 시나리오.
 * 기준(BASE)에서 한 가지 축만 바꾼 시나리오 + 현실 조합 + 극단 조합.
 */
const BASE: Omit<SchoolSpec, "id" | "label" | "axis"> = {
  seed: 20261015,
  classesPerGrade: [7, 7, 7],
  avgLoad: 16,
  setProfile: "base",
  setPlacement: "auto",
  bans: "core",
};

const s = (id: string, axis: string, label: string, patch: Partial<SchoolSpec>): SchoolSpec => ({
  ...BASE,
  id,
  axis,
  label,
  ...patch,
});

export const SCENARIOS: SchoolSpec[] = [
  s("base", "기준", "학년당 7반 · 교사 평균 16시간 · SET 보통 · 자동 SET 배치 · 국수영 동일교과 금지", {}),

  // ① 규모
  s("size-3", "규모", "학년당 3반 (9개 반)", { classesPerGrade: [3, 3, 3] }),
  s("size-5", "규모", "학년당 5반 (15개 반)", { classesPerGrade: [5, 5, 5] }),
  s("size-10", "규모", "학년당 10반 (30개 반)", { classesPerGrade: [10, 10, 10] }),
  s("size-12", "규모", "학년당 12반 (36개 반)", { classesPerGrade: [12, 12, 12] }),
  s("size-16", "규모", "학년당 16반 (48개 반)", { classesPerGrade: [16, 16, 16] }),
  s("size-mixed", "규모", "학년별 반 수 다름 (8·7·6반)", { classesPerGrade: [8, 7, 6] }),

  // ② 교사 수 (같은 수업량, 평균 시수만 다름)
  s("load-12", "교사 수", "교사 평균 12시간 (교사 많음)", { avgLoad: 12 }),
  s("load-14", "교사 수", "교사 평균 14시간", { avgLoad: 14 }),
  s("load-18", "교사 수", "교사 평균 18시간", { avgLoad: 18 }),
  s("load-20", "교사 수", "교사 평균 20시간 (교사 적음)", { avgLoad: 20 }),

  // ③ 제약 강도
  s("forbid-10", "제약", "배정 불가 무작위 10%", { forbidden: [{ kind: "random", rate: 0.1 }] }),
  s("forbid-20", "제약", "배정 불가 무작위 20%", { forbidden: [{ kind: "random", rate: 0.2 }] }),
  s("forbid-30", "제약", "배정 불가 무작위 30%", { forbidden: [{ kind: "random", rate: 0.3 }] }),
  s("dayoff-25", "제약", "교사 25%가 요일 하나 통째로 불가", { forbidden: [{ kind: "dayOff", share: 0.25 }] }),
  s("halfday-30", "제약", "교사 30%가 이틀은 오전만 가능", { forbidden: [{ kind: "halfDay", share: 0.3 }] }),
  s("pin-10", "제약", "선 수업 10%", { pinRate: 0.1 }),
  s("pin-20", "제약", "선 수업 20%", { pinRate: 0.2 }),
  s("bans-none", "제약", "동일 교과 금지 없음", { bans: "none" }),
  s("bans-all", "제약", "주 2시간 이상 전 교과 동일 교과 금지", { bans: "all" }),
  s("slack-2", "제약", "반마다 빈 칸 2개 (여유 있음)", { slack: 2 }),

  // ④ SET
  s("set-none", "SET", "SET 없음 (전부 공통)", { setProfile: "none" }),
  s("set-low", "SET", "SET 비중 낮음 (2학년 19%, 3학년 38%)", { setProfile: "low" }),
  s("set-high", "SET", "SET 비중 높음 (2학년 50%, 3학년 75%)", { setProfile: "high" }),
  s("set-partial", "SET", "2학년 SET 하나를 부분 SET 두 개로", { partialSet: true }),
  s("set-spread", "SET", "SET 배치: 요일 고르게 분산", { setPlacement: "spread" }),
  s("set-lunch", "SET", "SET 배치: 점심 앞뒤 교시 우선", { setPlacement: "lunch" }),
  s("set-avoidlunch", "SET", "SET 배치: 점심 앞뒤 교시 회피", { setPlacement: "avoidLunch" }),
  s("set-concentrated", "SET", "SET 배치: 특정 요일에 몰림", { setPlacement: "concentrated" }),

  // 현실 조합
  s("real-large", "현실 조합", "큰 학교: 학년당 12반, 교사 평균 17, 요일 불가 20% + 무작위 10%, 선 수업 10%", {
    classesPerGrade: [12, 12, 12], avgLoad: 17, forbidden: [{ kind: "dayOff", share: 0.2 }, { kind: "random", rate: 0.1 }], pinRate: 0.1,
  }),
  s("real-small", "현실 조합", "작은 학교: 학년당 4반, 교사 평균 18, 오전만 30%", {
    classesPerGrade: [4, 4, 4], avgLoad: 18, forbidden: [{ kind: "halfDay", share: 0.3 }],
  }),
  s("real-elective", "현실 조합", "선택 중심: SET 비중 높음, 부분 SET, 요일 분산, 무작위 불가 10%", {
    setProfile: "high", partialSet: true, setPlacement: "spread", forbidden: [{ kind: "random", rate: 0.1 }],
  }),
  s("real-lunchset", "현실 조합", "SET 점심 앞뒤 + 전 교과 동일교과 금지 + 선 수업 10%", {
    setPlacement: "lunch", bans: "all", pinRate: 0.1,
  }),

  // 극단 조합
  s("hard-1", "극단 조합", "학년당 10반, 교사 평균 20, 무작위 불가 20%, 전 교과 금지, SET 높음", {
    classesPerGrade: [10, 10, 10], avgLoad: 20, forbidden: [{ kind: "random", rate: 0.2 }], bans: "all", setProfile: "high",
  }),
  s("hard-2", "극단 조합", "학년당 16반, 무작위 불가 30%, 선 수업 20%, SET 높음", {
    classesPerGrade: [16, 16, 16], forbidden: [{ kind: "random", rate: 0.3 }], pinRate: 0.2, setProfile: "high",
  }),
  s("hard-3", "극단 조합", "학년당 7반, 교사 평균 20, 요일 불가 30% + 오전만 30%, SET 몰림", {
    avgLoad: 20, forbidden: [{ kind: "dayOff", share: 0.3 }, { kind: "halfDay", share: 0.3 }], setPlacement: "concentrated",
  }),
];
