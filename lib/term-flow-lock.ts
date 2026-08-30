export const FLOW_CHAPTER = {
  days: 0,
  subjects: 1,
  teachers: 2,
  sets: 3,
  blocks: 4,
  constraints: 5,
  preferences: 6,
  timetable: 7,
} as const;

export const LAST_FLOW_CHAPTER = FLOW_CHAPTER.timetable;

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
