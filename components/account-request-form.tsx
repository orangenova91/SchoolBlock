"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SchoolSearchField } from "@/components/school-search-field";
import {
  MAX_NOTE,
  MAX_SCHOOL_NAME,
  MAX_TEACHER_EMAIL,
  MAX_TEACHER_NAME,
  TEACHER_ROLES,
} from "@/lib/account-request-input";
import { MANUAL_SCHOOL_TYPES, SCHOOL_SIDOS } from "@/lib/school-meta";
import type { NeisSchoolOption } from "@/lib/types";

const KAKAO_INQUIRY_URL = "http://pf.kakao.com/_dGxexaX";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";

const LABEL_CLASS = "text-sm font-medium text-zinc-700";

export function AccountRequestForm() {
  const [manual, setManual] = useState(false);
  const [school, setSchool] = useState<NeisSchoolOption | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [sido, setSido] = useState("");
  const [type, setType] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherPhone, setTeacherPhone] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherRole, setTeacherRole] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<"already_account" | "already_pending" | null>(
    null,
  );

  function switchToSearch() {
    setManual(false);
    setSchool(null);
    setSchoolName("");
    setSido("");
    setType("");
  }

  function switchToManual() {
    setManual(true);
    setSchool(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    setConflict(null);

    if (!manual && !school) {
      setStatus("error");
      setMessage("검색 결과에서 학교를 선택해 주세요.");
      return;
    }

    if (!consent) {
      setStatus("error");
      setMessage("개인정보 수집·이용에 동의해 주세요.");
      return;
    }

    try {
      const response = await fetch("/api/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manual,
          schoolCode: school?.code,
          atptCode: school?.atptCode,
          schoolName: manual ? schoolName : undefined,
          sido: manual ? sido : undefined,
          type: manual ? type : undefined,
          teacherName,
          teacherPhone,
          teacherEmail,
          teacherRole,
          note,
          consent,
          website: honeypot,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        setStatus("error");
        if (data.code === "already_account" || data.code === "already_pending") {
          setConflict(data.code);
        }
        setMessage(data.error ?? "신청에 실패했습니다.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex w-full flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-base font-semibold text-zinc-900">접수되었습니다.</p>
        <p className="text-sm leading-relaxed text-zinc-600">
          담당자가 확인한 뒤 휴대전화 또는 카카오톡으로 계정 정보를
          안내드립니다. 급한 문의는 아래 채널을 이용해 주세요.
        </p>
        <a
          href={KAKAO_INQUIRY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-zinc-700 underline underline-offset-2 transition hover:text-zinc-900"
        >
          카카오톡으로 문의하기
        </a>
        <Link
          href="/login"
          className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
        >
          ← 로그인으로
        </Link>
      </div>
    );
  }

  const selectedSido = manual ? sido : school?.sido;
  const selectedType = manual ? type : school?.type;
  const showSchoolMeta = Boolean(selectedSido || selectedType);

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex w-full flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
    >
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="website">웹사이트</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="school" className={LABEL_CLASS}>
            학교
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={switchToSearch}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${
                !manual
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              }`}
            >
              학교 검색
            </button>
            <button
              type="button"
              onClick={switchToManual}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${
                manual
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              }`}
            >
              목록에 없음
            </button>
          </div>
        </div>

        {manual ? (
          <div className="flex flex-col gap-2">
            <input
              id="school"
              name="schoolName"
              type="text"
              required
              autoFocus
              maxLength={MAX_SCHOOL_NAME}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="학교명을 입력해 주세요"
              className={INPUT_CLASS}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                id="sido"
                name="sido"
                required
                value={sido}
                onChange={(e) => setSido(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">지역 선택</option>
                {SCHOOL_SIDOS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                id="schoolType"
                name="type"
                required
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">학교급 선택</option>
                {MANUAL_SCHOOL_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <SchoolSearchField
            id="school"
            selected={school}
            onSelect={setSchool}
            required
            autoFocus
          />
        )}

        {showSchoolMeta ? (
          <dl className="mt-1 grid grid-cols-2 gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">지역</dt>
              <dd className="font-medium text-zinc-900">
                {selectedSido || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">학교급</dt>
              <dd className="font-medium text-zinc-900">
                {selectedType || "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-zinc-500">
            학교를 선택하면 지역과 학교급이 자동으로 표시됩니다.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="teacherName" className={LABEL_CLASS}>
          담당 교사 성명
        </label>
        <input
          id="teacherName"
          name="teacherName"
          type="text"
          required
          maxLength={MAX_TEACHER_NAME}
          autoComplete="name"
          value={teacherName}
          onChange={(e) => setTeacherName(e.target.value)}
          placeholder="홍길동"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="teacherPhone" className={LABEL_CLASS}>
            담당 교사 연락처
          </label>
          <input
            id="teacherPhone"
            name="teacherPhone"
            type="tel"
            required
            autoComplete="tel"
            inputMode="numeric"
            value={teacherPhone}
            onChange={(e) => setTeacherPhone(e.target.value)}
            placeholder="010-0000-0000"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="teacherEmail" className={LABEL_CLASS}>
            이메일{" "}
            <span className="font-normal text-zinc-500">(선택)</span>
          </label>
          <input
            id="teacherEmail"
            name="teacherEmail"
            type="email"
            maxLength={MAX_TEACHER_EMAIL}
            autoComplete="email"
            value={teacherEmail}
            onChange={(e) => setTeacherEmail(e.target.value)}
            placeholder="name@school.go.kr"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="teacherRole" className={LABEL_CLASS}>
          직위{" "}
          <span className="font-normal text-zinc-500">(선택)</span>
        </label>
        <select
          id="teacherRole"
          name="teacherRole"
          value={teacherRole}
          onChange={(e) => setTeacherRole(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">선택해 주세요</option>
          {TEACHER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className={LABEL_CLASS}>
          기타 문의 사항{" "}
          <span className="font-normal text-zinc-500">(선택)</span>
        </label>
        <textarea
          id="note"
          name="note"
          rows={4}
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="전달하실 내용이 있으면 적어 주세요."
          className={`${INPUT_CLASS} resize-y`}
        />
      </div>

      <label className="flex items-start gap-2 text-sm leading-relaxed text-zinc-700">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300"
        />
        <span>
          계정 발급을 위해 학교 정보와 담당 교사 성명·연락처를 수집·이용하는 데
          동의합니다.{" "}
          <Link
            href="/privacy"
            className="font-medium text-zinc-900 underline underline-offset-2"
          >
            개인정보처리방침
          </Link>
        </span>
      </label>

      <button
        type="submit"
        disabled={status === "loading"}
        className="mt-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "접수 중…" : "신청하기"}
      </button>

      {message ? (
        <p role="status" className="text-sm text-red-600">
          {message}
          {conflict ? (
            <>
              {" "}
              <a
                href={KAKAO_INQUIRY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                카카오톡 문의
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
