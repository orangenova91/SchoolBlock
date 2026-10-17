import { SubjectsForm } from "@/components/subjects-form";

type PageProps = {
  params: Promise<{ termId: string }>;
  searchParams: Promise<{ step?: string }>;
};

/** v3: 입력 화면은 v1과 같다 */
export default async function V3SubjectsPage({ params, searchParams }: PageProps) {
  const { termId } = await params;
  const { step } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <SubjectsForm termId={termId} initialStep={step === "2" ? "classCount" : "edit"} />
      </main>
    </div>
  );
}
