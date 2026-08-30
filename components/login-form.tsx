"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SchoolSearchField } from "@/components/school-search-field";
import type { NeisSchoolOption } from "@/lib/types";

const INPUT_CLASS =
  "rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const [manual, setManual] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<NeisSchoolOption | null>(
    null,
  );

  function switchToSearch() {
    setManual(false);
    setUsername("");
    setSelectedSchool(null);
  }

  function switchToManual() {
    setManual(true);
    setSelectedSchool(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json()) as {
        error?: string;
        role?: string | null;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "로그인에 실패했습니다.");
        return;
      }

      router.push(data.role === "admin" ? "/admin" : "/");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="username" className="text-sm font-medium text-zinc-700">
            아이디 (학교명)
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
              직접 입력
            </button>
          </div>
        </div>

        {manual ? (
          <input
            id="username"
            name="username"
            type="text"
            required
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="아이디를 입력해주세요."
            className={INPUT_CLASS}
          />
        ) : (
          <SchoolSearchField
            id="username"
            name="username"
            selected={selectedSchool}
            onSelect={(school) => {
              setSelectedSchool(school);
              setUsername(school?.name ?? "");
            }}
            required
            autoFocus
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="mt-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "로그인 중…" : "로그인"}
      </button>

      {message ? (
        <p role="status" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
    </form>
  );
}
