/**
 * v3 점수와 목표 판정 (docs/v3-requirements.md 8.2·8.5).
 *
 * - 점수 = 점심 연강×중요도 + 3연강×중요도 + 동일 교과×중요도 (낮을수록 좋음)
 * - 근접(목표 달성): 이론상 최선(하한) LB 대비 10% 이내와 6점 이내 중 너그러운 쪽
 * - 엄격(조기 종료): 5% 이내와 3점 이내 중 너그러운 쪽
 */
import type { V3Weights } from "@/lib/v3/input";

export type V3Metrics = { unplaced: number; lunch: number; triple: number; sameDay: number; score: number };

export function scoreOf(m: { lunch: number; triple: number; sameDay: number }, w: V3Weights): number {
  return m.lunch * w.lunch + m.triple * w.triple + m.sameDay * w.sameDay;
}

// 점수는 늘 정수(중요도가 정수)이므로 기준도 정수로 내림한다 (예: 24 × 1.1 = 26.4 → 26점 이하)
const floorScore = (x: number) => Math.floor(x + 1e-9);

/** 근접 기준 점수: 이 점수 이하면 목표 달성 */
export function nearThreshold(lowerBound: number): number {
  return floorScore(Math.max(lowerBound * 1.1, lowerBound + 6));
}

/** 조기 종료용 엄격 기준 점수 */
export function strictThreshold(lowerBound: number): number {
  return floorScore(Math.max(lowerBound * 1.05, lowerBound + 3));
}

/**
 * 이론상 최선. lower = 정수계획법이 증명한 하한 (null 이면 아직 모름).
 * proven = 하한이 곧 최적값임이 증명됨 (화면에 "증명됨"으로, 아니면 "최선은 lower 이상"으로 표시).
 */
export type V3Bound = { lower: number | null; proven: boolean };

export type V3Judgement = {
  /** 미배치 없음 */
  complete: boolean;
  /** 근접 기준 달성 (하한을 모르면 null) */
  near: boolean | null;
  /** 엄격 기준 달성 (하한을 모르면 null) */
  strict: boolean | null;
  /** 증명된 최선과 같음 */
  optimal: boolean;
  /** 근접 기준까지 남은 점수 (달성했으면 0, 하한을 모르면 null) */
  gapToNear: number | null;
  threshold: number | null;
};

/**
 * 점수는 0보다 작을 수 없으므로 0은 늘 맞는 하한이다 (계산 없이 아는 "이론상 최선의 출발점").
 * 하한을 아직 모르면 0으로 판정하되, 0 기준으로 달성한 것만 확정한다:
 * 진짜 하한 L ≥ 0 이면 기준도 그만큼 넉넉해지므로(근접 max(1.1L, L+6) ≥ 6) "0 기준 달성"은 늘 참이다.
 * 0 기준으로 못 미친 경우는 진짜 하한을 알기 전까지 "모름"(null)으로 둔다.
 */
export function judge(m: V3Metrics, bound: V3Bound): V3Judgement {
  const complete = m.unplaced === 0;
  if (bound.lower === null) {
    const near = complete && m.score <= nearThreshold(0) + 1e-9;
    const strict = complete && m.score <= strictThreshold(0) + 1e-9;
    return {
      complete,
      near: near ? true : null,
      strict: strict ? true : null,
      optimal: complete && m.score <= 1e-9,
      gapToNear: near ? 0 : null,
      threshold: null,
    };
  }
  // 점수는 정수라서 하한 23.4 는 "24점 이상"과 같다
  const lb = Math.max(0, Math.ceil(bound.lower - 1e-6));
  const threshold = nearThreshold(lb);
  return {
    complete,
    near: complete && m.score <= threshold + 1e-9,
    strict: complete && m.score <= strictThreshold(lb) + 1e-9,
    // 하한은 늘 "이보다 좋을 수 없다"는 값이므로, 하한에 닿으면 최적이다
    optimal: complete && m.score <= lb + 1e-9,
    gapToNear: complete ? Math.max(0, m.score - threshold) : null,
    threshold,
  };
}
