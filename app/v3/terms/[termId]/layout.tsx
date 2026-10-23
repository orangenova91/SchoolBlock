import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TermFlowStepper } from "@/components/term-flow-stepper";
import { getDb } from "@/lib/mongodb";
import { getServerSession } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";
import type { TimetableDocument } from "@/lib/types";

type V3TermLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ termId: string }>;
};

/** v3 화면의 단계 이름 (입력 화면은 v1과 같고, SET 단계는 원하는 칸만 고정한다) */
const V3_LABELS = { sets: "SET 고정 배치" };

/**
 * v3 학기 화면 묶음. 입력 화면은 v1 부품을 그대로 쓰고, 주소만 /v3/terms/... 이다.
 * v3가 아닌 학기를 이 주소로 열면 같은 단계의 v1 화면으로 보낸다.
 */
export default async function V3TermLayout({ children, params }: V3TermLayoutProps) {
  const { termId } = await params;
  const session = await getServerSession();
  if (!session) redirect("/login");

  let termLabel: string | undefined;
  let maxReachedChapter = 0;
  let notV3 = false;
  try {
    const term = await findOwnedTerm(termId, session.accountId);
    if (!term) {
      notV3 = true;
    } else if (term.logicVersion !== "v3") {
      notV3 = true;
    } else {
      termLabel = [term.timetableName?.trim() || null, term.school, `${term.academicYear}학년도`, `${term.semester}학기`]
        .filter((part): part is string => Boolean(part))
        .join(" · ");
      if (typeof term.maxReachedChapter === "number" && Number.isInteger(term.maxReachedChapter)) {
        maxReachedChapter = Math.min(8, Math.max(0, term.maxReachedChapter));
      } else if (term.reachedTimetable === true) {
        maxReachedChapter = 7;
      } else if (term.reachedTimetable !== false) {
        const existing = await (await getDb())
          .collection<TimetableDocument>("timetables")
          .findOne({ termId }, { projection: { _id: 1 } });
        maxReachedChapter = existing ? 7 : 0;
      }
    }
  } catch {
    termLabel = undefined;
  }

  if (notV3) {
    const path = (await headers()).get("x-sb-path") ?? `/v3/terms/${termId}/days`;
    redirect(path.replace(/^\/v3/, ""));
  }

  return (
    <>
      <Suspense fallback={null}>
        <TermFlowStepper
          termId={termId}
          termLabel={termLabel}
          maxReachedChapter={maxReachedChapter}
          basePath="/v3/terms"
          labels={V3_LABELS}
          withFinal
        />
      </Suspense>
      {children}
    </>
  );
}
