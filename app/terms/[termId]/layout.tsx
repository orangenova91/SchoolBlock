import { Suspense } from "react";
import { TermFlowStepper } from "@/components/term-flow-stepper";

type TermFlowLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ termId: string }>;
};

export default async function TermFlowLayout({
  children,
  params,
}: TermFlowLayoutProps) {
  const { termId } = await params;

  return (
    <>
      <Suspense fallback={null}>
        <TermFlowStepper termId={termId} />
      </Suspense>
      {children}
    </>
  );
}
