import { SubjectsForm } from "@/components/subjects-form";

type SubjectsPageProps = {
  params: Promise<{ termId: string }>;
};

export default async function SubjectsPage({ params }: SubjectsPageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <SubjectsForm termId={termId} />
      </main>
    </div>
  );
}
