import { HomeDashboard } from "@/components/home-dashboard";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-5xl flex-col items-center gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            TimeTable
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            새 시간표를 만들거나, 기존 작업을 이어서 진행하세요.
          </p>
        </header>
        <HomeDashboard />
      </main>
    </div>
  );
}
