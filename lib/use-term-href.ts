"use client";

import { usePathname } from "next/navigation";

/**
 * 학기 단계 주소 만들기. 입력 화면은 v1·v3가 함께 쓰므로, 지금 v3 화면(/v3/terms/...)에 있으면 v3 주소를 돌려준다.
 * 예: termHref(id, "subjects") → "/terms/{id}/subjects" 또는 "/v3/terms/{id}/subjects"
 */
export function useTermHref() {
  const pathname = usePathname();
  const base = pathname?.startsWith("/v3/terms/") ? "/v3/terms" : "/terms";
  return (termId: string, step: string) => `${base}/${termId}/${step}`;
}
