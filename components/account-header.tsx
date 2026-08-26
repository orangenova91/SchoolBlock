"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountHeader({ username }: { username: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2.5">
      <span className="text-sm font-medium text-zinc-700">{username}</span>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loggingOut ? "..." : "로그아웃"}
      </button>
    </header>
  );
}
