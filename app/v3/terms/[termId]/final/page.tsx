import { V3FinalPanel } from "@/components/v3/v3-final-panel";
import { getServerSession } from "@/lib/session";
import { findOwnedTerm } from "@/lib/term-access";

type PageProps = {
  params: Promise<{ termId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export default async function V3FinalPage({ params, searchParams }: PageProps) {
  const { termId } = await params;
  const saved = Number((await searchParams).saved);

  // 엑셀 제목·파일 이름에 넣는 "2026학년도 2학기"
  let termPeriod: { academicYear: number; semester: number } | null = null;
  try {
    const session = await getServerSession();
    const term = session ? await findOwnedTerm(termId, session.accountId) : null;
    if (term) termPeriod = { academicYear: term.academicYear, semester: term.semester };
  } catch {
    termPeriod = null;
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <V3FinalPanel
          termId={termId}
          savedVersion={Number.isInteger(saved) && saved > 0 ? saved : null}
          termPeriod={termPeriod}
        />
      </main>
    </div>
  );
}
