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

    const timeoutMs = 20_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch("/api/auth/demo-login", {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "체험 계정에 연결하지 못했습니다.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? "서버 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요."
          : "서버에 연결할 수 없습니다.",
      );
    } finally {
      clearTimeout(timeoutId);
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
