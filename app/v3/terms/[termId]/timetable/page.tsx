import { V3TimetablePanel } from "@/components/v3/v3-timetable-panel";
import { getServerSession } from "@/lib/session";
import { markTermReachedTimetable } from "@/lib/term-access";

type PageProps = {
  params: Promise<{ termId: string }>;
};

export default async function V3TimetablePage({ params }: PageProps) {
  const { termId } = await params;
  try {
    const session = await getServerSession();
    if (session) await markTermReachedTimetable(termId, session.accountId);
  } catch {
    // 스테퍼 잠금만 풀리지 않을 뿐, 시간표 화면은 그대로 연다.
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <V3TimetablePanel termId={termId} />
      </main>
    </div>
  );
}
