"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function AccountHeader({ username }: { username: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

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
      <Link href="/" className="flex items-center gap-1.5">
        <Image
          src="/logo/SchoolBlock_Logo_S2B.jpg"
          alt=""
          width={1902}
          height={1528}
          className="h-6 w-6 shrink-0 rounded object-cover object-top"
        />
        <span className="text-sm font-semibold tracking-tight text-zinc-900">
          스쿨블럭(
          <span className="text-[#2D4B7C]">School</span>
          <span className="text-[#68A366]">Block</span>)
        </span>
      </Link>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          {username}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={`h-4 w-4 text-zinc-400 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="w-full px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loggingOut ? "..." : "로그아웃"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
