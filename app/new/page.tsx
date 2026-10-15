import Link from "next/link";
import { redirect } from "next/navigation";
import { TermForm } from "@/components/term-form";
import { getServerSession } from "@/lib/session";
import { parseLogicVersion } from "@/lib/types";

type NewTimetablePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function NewTimetablePage({
  searchParams,
}: NewTimetablePageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const logicVersion = parseLogicVersion((await searchParams).logic);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="flex w-full max-w-md flex-col items-center gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {logicVersion === "v2" ? "새 시간표 작성(v2)" : "새 시간표 작성"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            시간표명, 학년도, 학기를 입력해 주세요.
          </p>
          {logicVersion === "v2" ? (
            <p className="mt-2 text-xs text-indigo-700">
              개선된 시간표 생성 로직(v2)이 적용됩니다. 입력 단계는 기존과
              같습니다.
            </p>
          ) : null}
        </header>
        <TermForm school={session.username} logicVersion={logicVersion} />
        <Link
          href="/"
          className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
        >
          ← 목록으로
        </Link>
      </main>
    </div>
  );
}
