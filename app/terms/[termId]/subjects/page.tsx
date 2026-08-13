import { SubjectsForm } from "@/components/subjects-form";

type SubjectsPageProps = {
  params: Promise<{ termId: string }>;
};

export default async function SubjectsPage({ params }: SubjectsPageProps) {
  const { termId } = await params;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-6xl flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            수업 교과 설정
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            학년별 교과명과 단위수를 입력하세요. 엑셀에서 두 열(교과명, 단위수)을
            복사한 뒤 표 안에서 Ctrl+V로 붙여넣을 수 있습니다.
          </p>
        </header>
        <SubjectsForm termId={termId} />
      </main>
    </div>
  );
}
