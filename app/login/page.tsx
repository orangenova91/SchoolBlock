import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { TryDemoButton } from "@/components/try-demo-button";
import { APP_VERSION } from "@/lib/app-version";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="flex w-full max-w-sm flex-col items-center gap-8">
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
            AI 시간표 작성 프로그램
            <span className="text-xs font-medium text-zinc-500">
              {APP_VERSION}
            </span>
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            아이디와 비밀번호로 로그인해 주세요.
          </p>
        </header>
        <LoginForm />
        <p className="text-center text-xs leading-relaxed text-zinc-500">
          프로그램을 체험하고 싶다면 아래 &ldquo;체험해보기&rdquo; 버튼을
          눌러보세요. 예시 데이터로 바로 체험할 수 있습니다.
        </p>
        <div className="flex items-center gap-4">
          <TryDemoButton />
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSe1RpqiMHh4k9M6V9epCU94zxEWmeKGZdpCqzBIbEEnXakAxQ/viewform?usp=dialog"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-zinc-600 underline underline-offset-2 transition hover:text-zinc-900"
          >
            프로그램 계정 신청하기
          </a>
          <a
            href="https://open.kakao.com/o/ghpSxzIh"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-zinc-600 underline underline-offset-2 transition hover:text-zinc-900"
          >
            문의하기
          </a>
        </div>
      </main>
    </div>
  );
}
