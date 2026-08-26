import { GenerationPreferencesForm } from "@/components/generation-preferences-form";

type PreferencesPageProps = {
  params: Promise<{ termId: string }>;
};

export default async function PreferencesPage({ params }: PreferencesPageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-3xl flex-col items-center gap-6">
        <GenerationPreferencesForm termId={termId} />
      </main>
    </div>
  );
}
