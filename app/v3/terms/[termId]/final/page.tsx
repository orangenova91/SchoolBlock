import { V3FinalPanel } from "@/components/v3/v3-final-panel";

type PageProps = {
  params: Promise<{ termId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export default async function V3FinalPage({ params, searchParams }: PageProps) {
  const { termId } = await params;
  const saved = Number((await searchParams).saved);
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <V3FinalPanel termId={termId} savedVersion={Number.isInteger(saved) && saved > 0 ? saved : null} />
      </main>
    </div>
  );
}
