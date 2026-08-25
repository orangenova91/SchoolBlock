import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16">
      <main className="flex w-full max-w-sm flex-col items-center gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            TimeTable
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            아이디와 비밀번호로 로그인해 주세요.
          </p>
        </header>
        <LoginForm />
      </main>
    </div>
  );
}
