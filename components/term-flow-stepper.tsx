"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

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
  if (pathname.endsWith("/days")) return { chapterIndex: 0, subIndex: 0 };
  if (pathname.endsWith("/subjects")) {
    return { chapterIndex: 1, subIndex: step === "2" ? 1 : 0 };
  }
  if (pathname.endsWith("/teachers")) return { chapterIndex: 2, subIndex: 0 };
  if (pathname.endsWith("/sets/partial")) return { chapterIndex: 3, subIndex: 1 };
  if (pathname.endsWith("/sets")) return { chapterIndex: 3, subIndex: 0 };
  if (pathname.endsWith("/blocks")) return { chapterIndex: 4, subIndex: 0 };
  if (pathname.endsWith("/constraints")) return { chapterIndex: 5, subIndex: 0 };
  if (pathname.endsWith("/preferences")) return { chapterIndex: 6, subIndex: 0 };
  if (pathname.endsWith("/timetable")) return { chapterIndex: 7, subIndex: 0 };
  return null;
}

export function TermFlowStepper({ termId }: { termId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = resolveCurrent(pathname, searchParams.get("step"));

  if (!current) return null;
  const { chapterIndex, subIndex } = current;

  return (
    <div className="sticky top-[51px] z-40 border-b border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-6xl overflow-x-auto px-4 py-4">
        <ol className="flex min-w-max items-start justify-center gap-1.5">
          {CHAPTERS.map((chapter, i) => {
            const status =
              i < chapterIndex ? "done" : i === chapterIndex ? "current" : "upcoming";
            const isLast = i === CHAPTERS.length - 1;

            return (
              <li key={chapter.key} className="flex items-start">
                <div className="flex w-20 flex-col items-center gap-1.5 text-center">
                  {status === "done" ? (
                    <Link
                      href={chapter.href(termId)}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-300 text-xs font-medium text-zinc-700 transition hover:bg-zinc-400"
                      aria-label={`${chapter.label} (완료, 다시 보기)`}
                    >
                      ✓
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
                        : status === "done"
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
                      i < chapterIndex ? "bg-zinc-400" : "bg-zinc-200"
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
