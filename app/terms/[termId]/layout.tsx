import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TermFlowStepper } from "@/components/term-flow-stepper";
import { getDb } from "@/lib/mongodb";
import { getServerSession } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import type { TimetableDocument } from "@/lib/types";

type TermFlowLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ termId: string }>;
};

function formatTermLabel(term: {
  timetableName?: string | null;
  school: string;
  academicYear: number;
  semester: number;
  logicVersion?: string;
}): string {
  return [
    term.timetableName?.trim() || null,
    term.logicVersion === "v2" ? "v2" : term.logicVersion === "v3" ? "v3" : null,
    term.school,
    `${term.academicYear}학년도`,
    `${term.semester}학기`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export default async function TermFlowLayout({
  children,
  params,
}: TermFlowLayoutProps) {
  const { termId } = await params;

  let termLabel: string | undefined;
  let maxReachedChapter = 0;
  let isV3 = false;
  try {
    const session = await getServerSession();
    if (session) {
      const term = await findOwnedTerm(termId, session.accountId);
      isV3 = term?.logicVersion === "v3";
      if (term) {
        termLabel = formatTermLabel(term);
        if (
          typeof term.maxReachedChapter === "number" &&
          Number.isInteger(term.maxReachedChapter)
        ) {
          maxReachedChapter = Math.min(
            7,
            Math.max(0, term.maxReachedChapter),
          );
        } else if (term.reachedTimetable === false) {
          maxReachedChapter = 0;
        } else if (term.reachedTimetable === true) {
          maxReachedChapter = 7;
        } else {
          const db = await getDb();
          const existing = await db
            .collection<TimetableDocument>("timetables")
            .findOne({ termId }, { projection: { _id: 1 } });
          maxReachedChapter = existing ? 7 : 0;
        }
      }
    }
  } catch {
    termLabel = undefined;
  }

  // v3 시간표는 v3 화면에서 연다 (같은 단계로). 입력 화면을 공유하므로 v1 주소로 이동해 와도 여기서 되돌린다.
  if (isV3) {
    const path = (await headers()).get("x-sb-path") ?? `/terms/${termId}/days`;
    redirect(`/v3${path}`);
  }

  return (
    <>
      <Suspense fallback={null}>
        <TermFlowStepper
          termId={termId}
          termLabel={termLabel}
          maxReachedChapter={maxReachedChapter}
        />
      </Suspense>
      {children}
    </>
  );
}
