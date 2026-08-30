"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  FLOW_CHAPTER,
  FLOW_CLAMPED_EVENT,
  persistMaxReachedChapter,
  type FlowClampedDetail,
} from "@/lib/term-flow-lock";

type Chapter = {
  key: string;
  label: string;
  href: (termId: string) => string;
  /** Number of internal sub-steps this chapter's page shows (1/2, 2/2 …). 0 = single page. */
  subCount: number;
};

const CHAPTERS: Chapter[] = [
  { key: "days", label: "학반·요일 설정", href: (id) => `/terms/${id}/days`, subCount: 0 },
  { key: "subjects", label: "교과 설정", href: (id) => `/terms/${id}/subjects`, subCount: 2 },
  { key: "teachers", label: "교사 배정", href: (id) => `/terms/${id}/teachers`, subCount: 0 },
  { key: "sets", label: "SET 블록 배치", href: (id) => `/terms/${id}/sets`, subCount: 2 },
  { key: "blocks", label: "선 수업 배치", href: (id) => `/terms/${id}/blocks`, subCount: 0 },
  { key: "constraints", label: "배정 불가 설정", href: (id) => `/terms/${id}/constraints`, subCount: 0 },
  { key: "preferences", label: "추가 조건 설정", href: (id) => `/terms/${id}/preferences`, subCount: 0 },
  { key: "timetable", label: "시간표 생성", href: (id) => `/terms/${id}/timetable`, subCount: 0 },
];

/** Maps the current pathname (+ ?step= for subjects) to a chapter index and, for two-part chapters, a sub-index. */
function resolveCurrent(
  pathname: string,
  step: string | null,
): { chapterIndex: number; subIndex: number } | null {
  if (pathname.endsWith("/days")) return { chapterIndex: FLOW_CHAPTER.days, subIndex: 0 };
  if (pathname.endsWith("/subjects")) {
    return { chapterIndex: FLOW_CHAPTER.subjects, subIndex: step === "2" ? 1 : 0 };
  }
  if (pathname.endsWith("/teachers")) return { chapterIndex: FLOW_CHAPTER.teachers, subIndex: 0 };
  if (pathname.endsWith("/sets/partial")) {
    return { chapterIndex: FLOW_CHAPTER.sets, subIndex: 1 };
  }
  if (pathname.endsWith("/sets")) return { chapterIndex: FLOW_CHAPTER.sets, subIndex: 0 };
  if (pathname.endsWith("/blocks")) return { chapterIndex: FLOW_CHAPTER.blocks, subIndex: 0 };
  if (pathname.endsWith("/constraints")) {
    return { chapterIndex: FLOW_CHAPTER.constraints, subIndex: 0 };
  }
  if (pathname.endsWith("/preferences")) {
    return { chapterIndex: FLOW_CHAPTER.preferences, subIndex: 0 };
  }
  if (pathname.endsWith("/timetable")) {
    return { chapterIndex: FLOW_CHAPTER.timetable, subIndex: 0 };
  }
  return null;
}

export function TermFlowStepper({
  termId,
  termLabel,
  maxReachedChapter = 0,
}: {
  termId: string;
  termLabel?: string;
  /** 한 번이라도 연 가장 먼 장. 이 값 이하로는 스테퍼로 이동할 수 있다. */
  maxReachedChapter?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = resolveCurrent(pathname, searchParams.get("step"));
  const chapterIndex = current?.chapterIndex;
  const [maxReached, setMaxReached] = useState(maxReachedChapter);

  useEffect(() => {
    setMaxReached((prev) => Math.max(prev, maxReachedChapter));
  }, [maxReachedChapter]);

  useEffect(() => {
    if (chapterIndex == null) return;
    setMaxReached((prev) => {
      if (chapterIndex <= prev) return prev;
      persistMaxReachedChapter(termId, chapterIndex);
      return chapterIndex;
    });
  }, [chapterIndex, termId]);

  useEffect(() => {
    function handleClamp(event: Event) {
      const chapterIndex = (event as CustomEvent<FlowClampedDetail>).detail
        ?.chapterIndex;
      if (typeof chapterIndex !== "number") return;
      setMaxReached(chapterIndex);
    }
    window.addEventListener(FLOW_CLAMPED_EVENT, handleClamp);
    return () => window.removeEventListener(FLOW_CLAMPED_EVENT, handleClamp);
  }, []);

  if (!current || chapterIndex == null) return null;
  const { subIndex } = current;

  return (
    <div className="sticky top-[51px] z-40 border-b border-zinc-200 bg-white">
      {termLabel ? (
        <p
          className="mx-auto max-w-6xl truncate px-4 pt-2.5 text-center text-sm text-zinc-600"
          title={termLabel}
        >
          {termLabel}
        </p>
      ) : null}
      <div
        className={`mx-auto w-full max-w-6xl overflow-x-auto px-4 pb-4 ${
          termLabel ? "pt-2" : "pt-4"
        }`}
      >
        <ol className="flex min-w-max items-start justify-center gap-1.5">
          {CHAPTERS.map((chapter, i) => {
            const status =
              i < chapterIndex ? "done" : i === chapterIndex ? "current" : "upcoming";
            const isLast = i === CHAPTERS.length - 1;
            const visitedAhead = status === "upcoming" && i <= maxReached;
            const canJump = status === "done" || visitedAhead;

            return (
              <li key={chapter.key} className="flex items-start">
                <div className="flex w-20 flex-col items-center gap-1.5 text-center">
                  {canJump ? (
                    <Link
                      href={chapter.href(termId)}
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition ${
                        status === "done"
                          ? "bg-zinc-300 text-zinc-700 hover:bg-zinc-400"
                          : "border border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-100"
                      }`}
                      aria-label={
                        status === "done"
                          ? `${chapter.label} (완료, 다시 보기)`
                          : `${chapter.label}로 이동`
                      }
                    >
                      {status === "done" ? "✓" : i + 1}
                    </Link>
                  ) : (
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                        status === "current"
                          ? "bg-zinc-900 text-white"
                          : "border border-zinc-300 bg-white text-zinc-400"
                      }`}
                    >
                      {i + 1}
                    </div>
                  )}
                  <span
                    className={`text-[11px] leading-tight ${
                      status === "current"
                        ? "font-semibold text-zinc-900"
                        : canJump
                          ? "text-zinc-600"
                          : "text-zinc-400"
                    }`}
                  >
                    {chapter.label}
                  </span>
                  {chapter.subCount > 0 ? (
                    <div className="flex gap-1">
                      {Array.from({ length: chapter.subCount }, (_, s) => (
                        <span
                          key={s}
                          className={`h-1.5 w-1.5 rounded-full ${
                            status === "done" ||
                            visitedAhead ||
                            (status === "current" && s <= subIndex)
                              ? "bg-zinc-900"
                              : "bg-zinc-200"
                          }`}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                {!isLast ? (
                  <div
                    className={`mt-3.5 h-px w-4 shrink-0 sm:w-8 ${
                      i < maxReached ? "bg-zinc-400" : "bg-zinc-200"
                    }`}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
