import { Suspense } from "react";
import { TermFlowStepper } from "@/components/term-flow-stepper";
import { getServerSession } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";

type TermFlowLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ termId: string }>;
};

function formatTermLabel(term: {
  timetableName?: string | null;
  school: string;
  academicYear: number;
  semester: number;
}): string {
  return [
    term.timetableName?.trim() || null,
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
  try {
    const session = await getServerSession();
    if (session) {
      const term = await findOwnedTerm(termId, session.accountId);
      if (term) termLabel = formatTermLabel(term);
    }
  } catch {
    termLabel = undefined;
  }

  return (
    <>
      <Suspense fallback={null}>
        <TermFlowStepper termId={termId} termLabel={termLabel} />
      </Suspense>
      {children}
    </>
  );
}
