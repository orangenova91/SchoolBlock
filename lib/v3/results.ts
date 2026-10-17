/**
 * 상위 3개 결과 관리 (docs/v3-requirements.md 8.5).
 *
 * - 서로 다른 결과: 반 칸(공통 수업·SET) 배치가 30칸 이상, 그리고 전체 칸의 5% 이상 달라야 한다.
 * - 새 결과가 기존 결과와 너무 비슷하면, 점수가 같거나 더 좋을 때만 그 결과를 대신한다.
 * - 점수가 좋은 순서(낮은 순)로 최대 3개.
 */
import type { TimetableCell } from "@/lib/types";

export const MAX_RESULTS = 3;
export const MIN_DIFF_CELLS = 30;
export const MIN_DIFF_RATIO = 0.05;

/** 반 칸 서명: "학년|반|요일|교시" → 무엇이 들어 있는지 */
export function cellSignature(cells: TimetableCell[]): Map<string, string> {
  const sig = new Map<string, string>();
  for (const c of cells) {
    sig.set(`${c.grade}|${c.classNo}|${c.day}|${c.period}`, c.kind === "set" ? `SET:${c.set}` : `${c.subjectName}|${c.teacherName}`);
  }
  return sig;
}

/** 두 시간표에서 내용이 다른 반 칸 수 */
export function diffCells(a: Map<string, string>, b: Map<string, string>): number {
  let n = 0;
  for (const [k, v] of a) if (b.get(k) !== v) n++;
  for (const k of b.keys()) if (!a.has(k)) n++;
  return n;
}

export function isDistinct(a: Map<string, string>, b: Map<string, string>): boolean {
  const d = diffCells(a, b);
  const total = Math.max(a.size, b.size);
  return d >= MIN_DIFF_CELLS && d >= MIN_DIFF_RATIO * total;
}

export type RankedResult<T> = { score: number; signature: Map<string, string>; foundAtMs: number; payload: T };

export class TopResults<T> {
  private items: RankedResult<T>[] = [];

  constructor(initial: RankedResult<T>[] = []) {
    for (const r of initial) this.offer(r);
  }

  get list(): readonly RankedResult<T>[] {
    return this.items;
  }

  /**
   * 상위 목록이 "나아졌으면" true: 새로 다른 결과가 들어왔거나, 비슷한 결과보다 점수가 좋아졌을 때.
   * 같은 점수의 비슷한 결과로 바꿔 끼운 것은 나아진 것이 아니므로 false (조기 종료의 "30초 동안 변화 없음" 판단용).
   */
  offer(r: RankedResult<T>): boolean {
    const similar = this.items.filter((x) => !isDistinct(x.signature, r.signature));
    // 비슷한 결과 중 하나라도 더 좋으면 버린다 (더 좋은 결과를 잃지 않게)
    if (similar.some((x) => x.score < r.score)) return false;
    // 같거나 좋으면 비슷한 결과들을 대신한다
    const next = [...this.items.filter((x) => !similar.includes(x)), r]
      .sort((a, b) => a.score - b.score || a.foundAtMs - b.foundAtMs)
      .slice(0, MAX_RESULTS);
    if (!next.includes(r)) return false;
    this.items = next;
    return similar.length === 0 || similar.every((x) => r.score < x.score);
  }

  best(): RankedResult<T> | undefined {
    return this.items[0];
  }

  /** 3개가 다 찼고 모두 기준 점수 이하인가 (조기 종료 판단용) */
  fullAtOrBelow(threshold: number): boolean {
    return this.items.length === MAX_RESULTS && this.items.every((x) => x.score <= threshold + 1e-9);
  }
}
