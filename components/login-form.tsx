"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type SchoolOption = {
  code: string;
  atptCode: string;
  name: string;
  sido: string;
  type: string;
};

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SchoolOption[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const runSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(
        `/api/schools/search?q=${encodeURIComponent(query.trim())}&limit=20`,
      );
      if (!response.ok) {
        setResults([]);
        return;
      }
      const data = (await response.json()) as { items?: SchoolOption[] };
      setResults(Array.isArray(data.items) ? data.items : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function scheduleSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 280);
  }

  function pickSchool(school: SchoolOption) {
    setUsername(school.name);
    setDraft("");
    setOpen(false);
    setResults([]);
  }

  function switchToSearch() {
    setManual(false);
    setUsername("");
    setDraft("");
    setOpen(false);
    setResults([]);
  }

  function switchToManual() {
    setManual(true);
    setOpen(false);
    setResults([]);
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

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "로그인에 실패했습니다.");
        return;
      }

      router.push("/");
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
            className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        ) : (
          <div ref={wrapRef} className="relative">
            <input
              id="username"
              name="username"
              type="text"
              required
              autoFocus
              autoComplete="off"
              value={username || draft}
              onChange={(e) => {
                const value = e.target.value;
                if (username) setUsername("");
                setDraft(value);
                scheduleSearch(value);
                setOpen(true);
              }}
              onFocus={() => {
                if (!username && draft.trim().length >= 2) setOpen(true);
              }}
              placeholder="학교명을 두 글자 이상 입력해 검색"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
            {open ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                {searching ? (
                  <li className="px-3 py-2 text-zinc-500">검색 중…</li>
                ) : null}
                {!searching && results.length === 0 && draft.trim().length >= 2 ? (
                  <li className="px-3 py-2 text-zinc-500">검색 결과가 없습니다.</li>
                ) : null}
                {!searching
                  ? results.map((school) => (
                      <li key={`${school.atptCode}-${school.code}`}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickSchool(school)}
                          className="w-full px-3 py-2 text-left hover:bg-zinc-100"
                        >
                          <span className="font-medium text-zinc-900">
                            {school.name}
                          </span>
                          <span className="text-zinc-500">
                            {" "}
                            · {school.sido}
                            {school.type ? ` · ${school.type}` : ""}
                          </span>
                        </button>
                      </li>
                    ))
                  : null}
              </ul>
            ) : null}
          </div>
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
          className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
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
