"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Semester } from "@/lib/types";

const currentYear = new Date().getFullYear();

export function TermForm({ school }: { school: string }) {
  const router = useRouter();
  const [timetableName, setTimetableName] = useState("");
  const [academicYear, setAcademicYear] = useState(String(currentYear));
  const [semester, setSemester] = useState<Semester>(1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    const trimmedName = timetableName.trim().replace(/\s+/g, " ");
    const year = Number(academicYear);

    if (!trimmedName) {
      setStatus("error");
      setMessage("시간표명을 입력해 주세요.");
      return;
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setStatus("error");
      setMessage("학년도는 2000~2100 사이의 정수여야 합니다.");
      return;
    }

    try {
      const response = await fetch("/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timetableName: trimmedName,
          academicYear: year,
          semester,
        }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setStatus("error");
        setMessage(data.error ?? "저장에 실패했습니다.");
        return;
      }

      router.push(`/terms/${data.id}/days`);
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="timetableName"
          className="text-sm font-medium text-zinc-700"
        >
          시간표명
        </label>
        <input
          id="timetableName"
          name="timetableName"
          type="text"
          required
          value={timetableName}
          onChange={(e) => setTimetableName(e.target.value)}
          placeholder="예: v1.0.0"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="school" className="text-sm font-medium text-zinc-700">
          학교
        </label>
        <input
          id="school"
          name="school"
          type="text"
          readOnly
          disabled
          value={school}
          className="cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-500 outline-none"
        />
        <p className="text-xs text-zinc-500">계정 아이디로 자동 설정되며 수정할 수 없습니다.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="academicYear"
          className="text-sm font-medium text-zinc-700"
        >
          학년도
        </label>
        <input
          id="academicYear"
          name="academicYear"
          type="number"
          required
          min={2000}
          max={2100}
          value={academicYear}
          onChange={(e) => setAcademicYear(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="semester" className="text-sm font-medium text-zinc-700">
          학기
        </label>
        <select
          id="semester"
          name="semester"
          value={semester}
          onChange={(e) => setSemester(Number(e.target.value) as Semester)}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        >
          <option value={1}>1학기</option>
          <option value={2}>2학기</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="mt-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "저장 중…" : "저장 후 다음"}
      </button>

      {message ? (
        <p role="status" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
    </form>
  );
}
