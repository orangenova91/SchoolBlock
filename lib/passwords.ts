export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

export function validatePassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (
    raw.length < MIN_PASSWORD_LENGTH ||
    raw.length > MAX_PASSWORD_LENGTH ||
    /\s/.test(raw)
  ) {
    return null;
  }
  return raw;
}
