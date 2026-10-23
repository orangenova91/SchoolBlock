"use client";

import { TeachersForm } from "@/components/teachers-form";
import { V3TeacherGrouping } from "@/components/v3/v3-teacher-grouping";

/** v3 교사 배정: v1 화면에 교사 명단 옆 교사 그룹화만 더한다 */
export function V3TeachersForm({ termId }: { termId: string }) {
  return <TeachersForm termId={termId} rosterAction={(roster) => <V3TeacherGrouping {...roster} />} />;
}
