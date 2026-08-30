import fs from "fs";
import path from "path";
import type { NeisSchoolOption } from "@/lib/types";

export type { NeisSchoolOption };

let cachedSchools: NeisSchoolOption[] | null = null;

function loadSchools(): NeisSchoolOption[] {
  if (cachedSchools) return cachedSchools;
  const filePath = path.join(process.cwd(), "public", "neis", "schools.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cachedSchools = JSON.parse(raw) as NeisSchoolOption[];
  return cachedSchools;
}

export function searchSchools(query: string, limit = 20): NeisSchoolOption[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const schools = loadSchools();
  const scored: { item: NeisSchoolOption; score: number }[] = [];

  for (const s of schools) {
    let score = 0;
    if (s.name.includes(q)) {
      score += s.name.startsWith(q) ? 120 : 60;
    }
    if (s.code && s.code.includes(q)) score += 45;
    if (s.sido.includes(q)) score += 25;
    if (score === 0) continue;
    scored.push({ item: s, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.name.localeCompare(b.item.name, "ko");
  });

  return scored.slice(0, limit).map((x) => x.item);
}

export function findSchoolByCodes(
  code: string,
  atptCode: string,
): NeisSchoolOption | null {
  const schools = loadSchools();
  return (
    schools.find((s) => s.code === code && s.atptCode === atptCode) ?? null
  );
}
