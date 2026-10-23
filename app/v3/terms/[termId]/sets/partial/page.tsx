import { PartialSetBlocksForm } from "@/components/partial-set-blocks-form";

type PageProps = {
  params: Promise<{ termId: string }>;
};

/** v3: 부분 SET도 원하는 칸만 고정한다 */
export default async function V3PartialSetsPage({ params }: PageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <PartialSetBlocksForm termId={termId} variant="v3" />
      </main>
    </div>
  );
}
