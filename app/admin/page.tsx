import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin-console";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "신청 관리 · 스쿨블럭(SchoolBlock)",
};

export default async function AdminPage() {
  await requireAdminPage();

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10">
      <main className="flex w-full max-w-6xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            신청 관리
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            계정 신청을 승인하거나 반려하고, 학교 계정 비밀번호를 재설정합니다.
            발급한 비밀번호는 카카오톡으로 전달해 주세요.
          </p>
        </header>
        <AdminConsole />
      </main>
    </div>
  );
}
