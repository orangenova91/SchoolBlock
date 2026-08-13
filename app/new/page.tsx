import Link from "next/link";
import { TermForm } from "@/components/term-form";

export default function NewTimetablePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="flex w-full max-w-md flex-col items-center gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            새 시간표 작성
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            시간표명, 학교, 학년도, 학기를 입력해 주세요.
          </p>
        </header>
        <TermForm />
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
