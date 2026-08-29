import Image from "next/image";
import { HomeDashboard } from "@/components/home-dashboard";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-5xl flex-col items-center gap-8">
        <header className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Image
              src="/logo/SchoolBlock_Logo_S2B.jpg"
              alt=""
              width={1902}
              height={1528}
              className="h-8 w-8 shrink-0 rounded-md object-cover object-top"
              priority
            />
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              스쿨블럭(
              <span className="text-[#2D4B7C]">School</span>
              <span className="text-[#68A366]">Block</span>)
            </h1>
          </div>
          <p className="mt-1 text-base font-medium text-zinc-800">
            AI 시간표 작성 프로그램
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            새 시간표를 만들거나, 기존 작업을 이어서 진행하세요.
          </p>
        </header>
        <HomeDashboard />
      </main>
    </div>
  );
}
