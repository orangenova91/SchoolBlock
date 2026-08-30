"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NeisSchoolOption } from "@/lib/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";

export function SchoolSearchField({
  id,
  name,
  selected,
  onSelect,
  required = false,
  autoFocus = false,
  placeholder = "학교명을 두 글자 이상 입력해 검색",
}: {
  id: string;
  name?: string;
  selected: NeisSchoolOption | null;
  onSelect: (school: NeisSchoolOption | null) => void;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NeisSchoolOption[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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
      const data = (await response.json()) as { items?: NeisSchoolOption[] };
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

  function pickSchool(school: NeisSchoolOption) {
    onSelect(school);
    setDraft("");
    setOpen(false);
    setResults([]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        name={name}
        type="text"
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        value={selected?.name ?? draft}
        onChange={(e) => {
          const value = e.target.value;
          if (selected) onSelect(null);
          setDraft(value);
          scheduleSearch(value);
          setOpen(true);
        }}
        onFocus={() => {
          if (!selected && draft.trim().length >= 2) setOpen(true);
        }}
        placeholder={placeholder}
        className={INPUT_CLASS}
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
  );
}
