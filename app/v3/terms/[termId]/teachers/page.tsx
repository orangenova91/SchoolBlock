import { V3TeachersForm } from "@/components/v3/v3-teachers-form";

type PageProps = {
  params: Promise<{ termId: string }>;
};

/** v3: 입력 화면은 v1과 같고, 교사 명단 옆에 교사 그룹화만 더한다 */
export default async function V3Page({ params }: PageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <V3TeachersForm termId={termId} />
      </main>
    </div>
  );
}
