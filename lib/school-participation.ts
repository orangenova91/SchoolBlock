export const APPLY_SOCIAL_PROOF_LOW =
  "담당자가 확인 후 계정을 안내드립니다.";
export const APPLY_SOCIAL_PROOF_MID =
  "이미 여러 학교에서 이용 중입니다.";

export type ParticipatingAccount = {
  username: string;
};

export type ParticipatingRequest = {
  schoolName: string;
  sido: string;
  schoolCode?: string;
  atptCode?: string;
};

function requestKey(request: ParticipatingRequest): string {
  const code = request.schoolCode?.trim();
  const atpt = request.atptCode?.trim();
  if (code && atpt) return `code:${atpt}:${code}`;
  return `name:${request.sido.trim()}:${request.schoolName.trim()}`;
}

export function countUniqueParticipatingSchools(
  accounts: ParticipatingAccount[],
  requests: ParticipatingRequest[],
): number {
  const keys = new Set<string>();
  const requestNames = new Set<string>();

  for (const request of requests) {
    const name = request.schoolName.trim();
    if (!name) continue;
    requestNames.add(name);
    keys.add(requestKey(request));
  }

  const seenAccountNames = new Set<string>();
  for (const account of accounts) {
    const name = account.username.trim();
    if (!name || seenAccountNames.has(name)) continue;
    seenAccountNames.add(name);
    if (requestNames.has(name)) continue;
    keys.add(`account:${name}`);
  }

  return keys.size;
}

export function getApplySocialProofMessage(n: number): string {
  if (n < 10) return APPLY_SOCIAL_PROOF_LOW;
  if (n < 30) return APPLY_SOCIAL_PROOF_MID;
  return `현재 ${n}개 학교에서 이용 중입니다.`;
}
