import { DayScheduleForm } from "@/components/day-schedule-form";

type DaysPageProps = {
  params: Promise<{ termId: string }>;
};

export default async function DaysPage({ params }: DaysPageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <DayScheduleForm termId={termId} />
      </main>
    </div>
  );
}
