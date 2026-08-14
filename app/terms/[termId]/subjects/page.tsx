import { SubjectsForm } from "@/components/subjects-form";

type SubjectsPageProps = {
  params: Promise<{ termId: string }>;
  searchParams: Promise<{ step?: string }>;
};

export default async function SubjectsPage({
  params,
  searchParams,
}: SubjectsPageProps) {
  const { termId } = await params;
  const { step } = await searchParams;
  const initialStep = step === "2" ? "classCount" : "edit";

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <SubjectsForm termId={termId} initialStep={initialStep} />
      </main>
    </div>
  );
}
