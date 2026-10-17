import { SubjectBlocksForm } from "@/components/subject-blocks-form";

type PageProps = {
  params: Promise<{ termId: string }>;
};

/** v3: 입력 화면은 v1과 같다 */
export default async function V3Page({ params }: PageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <SubjectBlocksForm termId={termId} />
      </main>
    </div>
  );
}
