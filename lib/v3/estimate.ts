/**
 * 계산 방법별 예상 시간·추천 (2026-10-19 측정, docs/v3-timing-guide.md).
 *
 * 측정: 1차 14가지 조건 × 3가지 방법 5~15분, 2차 32가지 조건(6~48반) × 3가지 방법 × 2회 × 10분(5분 구간 2번),
 * 3차 대규모 20가지 조건(33~60반) × 4가지 방법(혼합→정수 이어 받기 포함) × 2회 × 15분.
 * "예상 시간"은 목표(근접 기준)에 닿는 데 걸린 시간의 대략적인 범위다. 이론상 최선은 따로 2분 계산한 값.
 * 학교마다 차이가 커서 정확한 예측이 아니라 안내용이다.
 */
import type { V3Input } from "@/lib/v3/input";
import type { V3Instance } from "@/lib/v3/instance";

export type V3SizeSummary = {
  /** 전체 반 수 */
  classes: number;
  teachers: number;
  /** 주당 수업 칸 수 (반 기준: 공통 + 선 수업 + SET이 차지하는 반 칸) */
  lessons: number;
  /** 교사 1인 평균 주당 시수 */
  avgLoad: number;
  forbidden: number;
  pins: number;
  fixedSet: number;
  sets: number;
};

export type V3Tier = "small" | "medium" | "large";
export type V3EngineKind = "hybrid" | "search" | "milp";

export type V3Estimate = {
  tier: V3Tier;
  recommended: V3EngineKind;
  /** 방법별 예상 시간 (목표 달성까지) */
  methods: Record<V3EngineKind, string>;
  /** 조건이 많아 더 걸릴 수 있는 이유 */
  slower: string[];
  /** 규모별 덧붙임 안내 */
  tip?: string;
};

export function summarizeSize(input: V3Input, inst: V3Instance): V3SizeSummary {
  const classes = inst.classCounts[1] + inst.classCounts[2] + inst.classCounts[3];
  const lessons = inst.groups.reduce((a, g) => a + g.hours, 0) + inst.pins.length + inst.sets.reduce((a, s) => a + s.units * s.rooms.length, 0);
  const teacherHours = input.teachers.reduce((a, t) => a + Object.values(t.assignments).flat().reduce((b, x) => b + x.hours, 0), 0);
  return {
    classes,
    teachers: input.teachers.length,
    lessons,
    avgLoad: input.teachers.length ? Math.round((teacherHours / input.teachers.length) * 10) / 10 : 0,
    forbidden: inst.forbidden.size,
    pins: inst.pins.length,
    fixedSet: inst.sets.reduce((a, s) => a + s.fixed.length, 0),
    sets: inst.sets.length,
  };
}

/** 반 수로 나눈 규모 (측정에서 계산 시간을 가장 잘 가른 기준) */
export function tierOf(size: Pick<V3SizeSummary, "classes">): V3Tier {
  return size.classes <= 12 ? "small" : size.classes <= 30 ? "medium" : "large";
}

export function estimateMethods(size: V3SizeSummary): V3Estimate {
  const tier = tierOf(size);
  const slower: string[] = [];
  // 측정에서 느려진 조건 (뚜렷한 것만): 배정 불가가 교사당 2칸 넘게, 선 수업이 수업의 5% 넘게, 고정 SET.
  // 교사 1인 시수·선 수업 3% 수준은 계산 시간과 뚜렷한 관계가 없어 넣지 않았다.
  if (size.teachers && size.forbidden / size.teachers > 2) slower.push(`배정 불가가 많음 (교사 1명당 ${(size.forbidden / size.teachers).toFixed(1)}칸)`);
  if (size.lessons && size.pins / size.lessons > 0.05) slower.push(`선 수업이 많음 (${size.pins}칸)`);
  if (size.fixedSet > 0) slower.push(`고정한 SET 칸 ${size.fixedSet}개`);
  // SET이 거의 없으면(6개 이하) 큰 학교도 정수계획이 20초 안팎에 목표에 닿았다 (3차 측정 L48none·L48low, B12/B24 none·low)
  const fewSets = size.sets <= 6;
  if (tier === "small") {
    return {
      tier,
      recommended: "hybrid",
      methods: { hybrid: "약 10~40초 (거의 늘 최선까지)", milp: "약 20초~1분 (최선 증명까지 가는 경우가 많음)", search: "약 1분 30초~2분 30초" },
      slower,
      tip: "작은 학교는 혼합과 정수계획 모두 최선까지 찾습니다. 혼합이 조금 더 빠르고, 정수계획은 최선임을 증명해 줍니다.",
    };
  }
  if (tier === "medium") {
    return {
      tier,
      recommended: "hybrid",
      methods: {
        hybrid: "약 15초~1분 (가끔 3분 이상)",
        milp: "20초~5분 이상, 10분에도 못 닿는 학교가 있음 (약 5곳 중 1곳)",
        search: "약 2~3분, 못 닿는 학교가 있음",
      },
      slower,
      tip: (fewSets ? "SET이 적어 정수계획도 20초 안팎에 목표에 닿을 수 있습니다. " : "") + "혼합이 가장 빠르고 안정적입니다. 혼합 결과가 “최선”이 아니면 정수계획을 5~10분 더 돌려 보세요. 측정한 중간 학교 18곳 중 3곳은 정수계획이 1.5~5.5점 더 좋은 시간표(최선)를 찾았습니다.",
    };
  }
  return {
    tier,
    recommended: "hybrid",
    methods: {
      hybrid: "약 1~5분 (보통 2분 안팎, 5곳 중 1곳은 15분에도 못 닿음)",
      milp: "대부분 첫 결과에서 거의 좋아지지 않음 (비추천)",
      search: "대부분 15분에도 목표에 못 닿음",
    },
    slower,
    tip: (fewSets ? "SET이 적어 정수계획도 20초 안팎에 목표에 닿을 수 있습니다. " : "") + "큰 학교는 혼합이 가장 빠르고 정확합니다. 목표에 못 닿으면 미리 승인으로 5분씩 더 계산해 보세요.",
  };
}

export const TIER_LABEL: Record<V3Tier, string> = { small: "작은 학교 (12반 이하)", medium: "중간 학교 (13~30반)", large: "큰 학교 (31반 이상)" };
