"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TryDemoButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/demo-login", { method: "POST" });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "체험 계정에 연결하지 못했습니다.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="text-sm font-medium text-zinc-600 underline underline-offset-2 transition hover:text-zinc-900 disabled:opacity-50"
      >
        {loading ? "준비 중…" : "체험해보기"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
