/**
 * v2 전용: 선호 조건 가중치. 교환 개선 점수에서 위반 1건이 몇 점인지 정한다.
 * 조건 자체를 켜고 끄는 것은 추가 조건 설정에서 하고, 여기서는 켜진 조건
 * 사이의 우선순위만 정한다. 필수 조건(교사 중복·배정 불가)은 1건에 1000점이라
 * 어떤 가중치를 골라도 선호 조건보다 항상 먼저 지켜진다.
 */

export type V2Weights = {
  /** 점심시간 연강 */
  lunch: number;
  /** 3연강 */
  triple: number;
  /** 동일 교과 같은 날 중복 */
  sameDay: number;
};

export const V2_WEIGHT_LEVELS: { value: number; label: string }[] = [
  { value: 1, label: "매우 낮음 (1)" },
  { value: 2, label: "낮음 (2)" },
  { value: 3, label: "보통 (3)" },
  { value: 5, label: "높음 (5)" },
  { value: 10, label: "매우 높음 (10)" },
];

/** 비교 테스트에서 검증한 값과 같은 기본값. */
export const DEFAULT_V2_WEIGHTS: V2Weights = { lunch: 3, triple: 2, sameDay: 3 };

const ALLOWED = new Set(V2_WEIGHT_LEVELS.map((level) => level.value));

/** 저장값 검증. 하나라도 허용 단계가 아니면 null. */
export function parseV2Weights(value: unknown): V2Weights | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const pick = (key: keyof V2Weights) =>
    typeof raw[key] === "number" && ALLOWED.has(raw[key] as number)
      ? (raw[key] as number)
      : null;
  const lunch = pick("lunch");
  const triple = pick("triple");
  const sameDay = pick("sameDay");
  if (lunch === null || triple === null || sameDay === null) return null;
  return { lunch, triple, sameDay };
}

/** 저장값이 없거나 잘못됐으면 기본값. */
export function normalizeV2Weights(value: unknown): V2Weights {
  return parseV2Weights(value) ?? DEFAULT_V2_WEIGHTS;
}
