import { NextResponse } from "next/server";
import { findNonDemoAccountByUsername } from "@/lib/accounts";
import {
  findPendingAccountRequest,
  insertAccountRequest,
} from "@/lib/account-requests";
import {
  isManualSchoolType,
  isSchoolSido,
  isTeacherRole,
  isValidTeacherEmail,
  isValidTeacherName,
  MAX_NOTE,
  MAX_SCHOOL_NAME,
  normalizeTeacherPhone,
} from "@/lib/account-request-input";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { findSchoolByCodes } from "@/lib/schools";
import type { AccountRequestDocument } from "@/lib/types";

export const dynamic = "force-dynamic";

function readTrimmed(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit("account-requests", ip, 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const {
    manual,
    schoolCode,
    atptCode,
    schoolName: rawSchoolName,
    sido: rawSido,
    type: rawType,
    teacherName: rawTeacherName,
    teacherPhone: rawTeacherPhone,
    teacherEmail: rawTeacherEmail,
    teacherRole: rawTeacherRole,
    note: rawNote,
    consent,
    website,
  } = body as Record<string, unknown>;

  if (typeof website === "string" && website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (consent !== true) {
    return NextResponse.json(
      { error: "개인정보 수집·이용에 동의해 주세요." },
      { status: 400 },
    );
  }

  if (typeof rawTeacherName !== "string" || !isValidTeacherName(rawTeacherName)) {
    return NextResponse.json(
      { error: "담당 교사 성명을 두 글자 이상 입력해 주세요." },
      { status: 400 },
    );
  }

  if (typeof rawTeacherPhone !== "string") {
    return NextResponse.json(
      { error: "담당 교사 연락처를 입력해 주세요." },
      { status: 400 },
    );
  }

  const teacherPhone = normalizeTeacherPhone(rawTeacherPhone);
  if (!teacherPhone) {
    return NextResponse.json(
      { error: "휴대전화 번호 형식이 올바르지 않습니다. (010-0000-0000)" },
      { status: 400 },
    );
  }

  let teacherEmail: string | undefined;
  if (typeof rawTeacherEmail === "string" && rawTeacherEmail.trim()) {
    const email = rawTeacherEmail.trim();
    if (!isValidTeacherEmail(email)) {
      return NextResponse.json(
        { error: "이메일 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    teacherEmail = email;
  }

  let teacherRole: string | undefined;
  if (typeof rawTeacherRole === "string" && rawTeacherRole.trim()) {
    if (!isTeacherRole(rawTeacherRole.trim())) {
      return NextResponse.json(
        { error: "직위 값이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    teacherRole = rawTeacherRole.trim();
  }

  let note: string | undefined;
  if (typeof rawNote === "string" && rawNote.trim()) {
    const trimmedNote = rawNote.trim();
    if (trimmedNote.length > MAX_NOTE) {
      return NextResponse.json(
        { error: "문의 사항이 너무 깁니다." },
        { status: 400 },
      );
    }
    note = trimmedNote;
  }

  const isManual = manual === true;
  let schoolName: string;
  let sido: string;
  let type: string;
  let resolvedCode: string | undefined;
  let resolvedAtptCode: string | undefined;

  if (isManual) {
    const name = readTrimmed(rawSchoolName, MAX_SCHOOL_NAME);
    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "학교명을 두 글자 이상 입력해 주세요." },
        { status: 400 },
      );
    }
    if (typeof rawSido !== "string" || !isSchoolSido(rawSido)) {
      return NextResponse.json(
        { error: "지역을 선택해 주세요." },
        { status: 400 },
      );
    }
    if (typeof rawType !== "string" || !isManualSchoolType(rawType)) {
      return NextResponse.json(
        { error: "학교급을 선택해 주세요." },
        { status: 400 },
      );
    }
    schoolName = name;
    sido = rawSido;
    type = rawType;
  } else {
    if (typeof schoolCode !== "string" || typeof atptCode !== "string") {
      return NextResponse.json(
        { error: "검색 결과에서 학교를 선택해 주세요." },
        { status: 400 },
      );
    }
    const school = findSchoolByCodes(schoolCode.trim(), atptCode.trim());
    if (!school) {
      return NextResponse.json(
        { error: "선택한 학교를 찾을 수 없습니다. 다시 검색해 주세요." },
        { status: 400 },
      );
    }
    schoolName = school.name;
    sido = school.sido;
    type = school.type;
    resolvedCode = school.code;
    resolvedAtptCode = school.atptCode;
  }

  try {
    const existingAccount = await findNonDemoAccountByUsername(schoolName);
    if (existingAccount) {
      return NextResponse.json(
        {
          error:
            "같은 학교명의 계정이 이미 있습니다. 비밀번호 재발급이나 문의는 카카오톡으로 연락해 주세요.",
          code: "already_account",
        },
        { status: 409 },
      );
    }

    const pending = await findPendingAccountRequest({
      schoolCode: resolvedCode,
      atptCode: resolvedAtptCode,
      schoolName,
      sido,
    });
    if (pending) {
      return NextResponse.json(
        {
          error:
            "이 학교의 계정 신청이 이미 접수되어 있습니다. 안내를 기다리시거나 카카오톡으로 문의해 주세요.",
          code: "already_pending",
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const doc: AccountRequestDocument = {
      schoolName,
      sido,
      type,
      manual: isManual,
      teacherName: rawTeacherName.trim(),
      teacherPhone,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    if (resolvedCode) doc.schoolCode = resolvedCode;
    if (resolvedAtptCode) doc.atptCode = resolvedAtptCode;
    if (teacherEmail) doc.teacherEmail = teacherEmail;
    if (teacherRole) doc.teacherRole = teacherRole;
    if (note) doc.note = note;

    await insertAccountRequest(doc);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("account-requests failed:", error);
    return NextResponse.json(
      { error: "신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
