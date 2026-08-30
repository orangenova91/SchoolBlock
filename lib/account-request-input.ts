import {
  MANUAL_SCHOOL_TYPES,
  SCHOOL_SIDOS,
  type ManualSchoolType,
  type SchoolSido,
} from "@/lib/school-meta";

export const TEACHER_ROLES = ["시간표 담당", "교무부장", "교감", "기타"] as const;
export type TeacherRole = (typeof TEACHER_ROLES)[number];

export const MAX_TEACHER_NAME = 40;
export const MAX_TEACHER_EMAIL = 100;
export const MAX_NOTE = 1000;
export const MAX_SCHOOL_NAME = 50;

export function normalizeTeacherPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return null;
}

export function isValidTeacherEmail(raw: string): boolean {
  if (raw.length > MAX_TEACHER_EMAIL) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

export function isValidTeacherName(raw: string): boolean {
  const t = raw.trim();
  return t.length >= 2 && t.length <= MAX_TEACHER_NAME;
}

export function isSchoolSido(value: string): value is SchoolSido {
  return (SCHOOL_SIDOS as readonly string[]).includes(value);
}

export function isManualSchoolType(value: string): value is ManualSchoolType {
  return (MANUAL_SCHOOL_TYPES as readonly string[]).includes(value);
}

export function isTeacherRole(value: string): value is TeacherRole {
  return (TEACHER_ROLES as readonly string[]).includes(value);
}
