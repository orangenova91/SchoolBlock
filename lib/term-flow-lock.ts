export const FLOW_CHAPTER = {
  days: 0,
  subjects: 1,
  teachers: 2,
  sets: 3,
  blocks: 4,
  constraints: 5,
  preferences: 6,
  timetable: 7,
  /** v3에만 있는 장 */
  final: 8,
} as const;

export const LAST_FLOW_CHAPTER = FLOW_CHAPTER.timetable;

/** 학기 목록에서 열 주소: 가장 멀리 간 단계 (FLOW_CHAPTER 키가 곧 주소 끝부분) */
export function termResumeHref(
  termId: string,
  logicVersion: string | null | undefined,
  maxReachedChapter = 0,
): string {
  const isV3 = logicVersion === "v3";
  const last = isV3 ? FLOW_CHAPTER.final : LAST_FLOW_CHAPTER;
  const chapter = Math.min(last, Math.max(0, Math.trunc(maxReachedChapter)));
  const key =
    (Object.keys(FLOW_CHAPTER) as (keyof typeof FLOW_CHAPTER)[]).find(
      (k) => FLOW_CHAPTER[k] === chapter,
    ) ?? "days";
  return `${isV3 ? "/v3" : ""}/terms/${termId}/${key}`;
}

export const FLOW_CLAMPED_EVENT = "schoolblock:flow-clamped";

export type FlowClampedDetail = { chapterIndex: number };

/** 앞 단계 초기화 후 그 장 이후로 스테퍼를 잠근다. 실패해도 화면은 먼저 반영한다. */
export function lockTermFlow(termId: string, chapterIndex: number): void {
  window.dispatchEvent(
    new CustomEvent<FlowClampedDetail>(FLOW_CLAMPED_EVENT, {
      detail: { chapterIndex },
    }),
  );
  void fetch(`/api/terms/${termId}/flow`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxReachedChapter: chapterIndex }),
  });
}

export function persistMaxReachedChapter(
  termId: string,
  chapterIndex: number,
): void {
  void fetch(`/api/terms/${termId}/flow`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxReachedChapter: chapterIndex }),
  });
}
