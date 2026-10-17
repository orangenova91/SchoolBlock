import { GenerationPreferencesForm } from "@/components/generation-preferences-form";

type PageProps = {
  params: Promise<{ termId: string }>;
};

/** v3: 추가 조건은 v1과 같다 (조건별 중요도는 생성 화면에서 고른다 — v2와 같은 자리) */
export default async function V3PreferencesPage({ params }: PageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-3xl flex-col items-center gap-6">
        <GenerationPreferencesForm termId={termId} />
      </main>
    </div>
  );
}
