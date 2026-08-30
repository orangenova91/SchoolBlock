import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AccountRequestForm } from "@/components/account-request-form";
import { APP_VERSION } from "@/lib/app-version";
import { countParticipatingSchools } from "@/lib/school-participation-count";
import { getApplySocialProofMessage } from "@/lib/school-participation";

export const metadata: Metadata = {
  title: "프로그램 계정 신청 · 스쿨블럭(SchoolBlock)",
};

export default async function ApplyPage() {
  let socialProof = getApplySocialProofMessage(0);
  try {
    socialProof = getApplySocialProofMessage(await countParticipatingSchools());
  } catch (error) {
    console.error("apply social proof failed:", error);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="flex w-full max-w-md flex-col items-center gap-8">
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
          <p className="mt-1 flex items-center justify-center gap-2 text-base font-medium text-zinc-800">
            프로그램 계정 신청
            <span className="text-xs font-medium text-zinc-500">
              {APP_VERSION}
            </span>
          </p>
          <p className="mt-2 text-sm font-medium text-zinc-700">{socialProof}</p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            학교를 검색하면 지역과 학교급이 자동으로 표시됩니다. 담당 교사
            정보를 입력해 주세요.
          </p>
        </header>
        <AccountRequestForm />
        <Link
          href="/login"
          className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
        >
          ← 로그인으로
        </Link>
      </main>
    </div>
  );
}
