/**
 * v3 진단 측정. usage: npx tsx --tsconfig ./tsconfig.json scripts/v3-perf/diagnose.ts <F1|...|조건> <feasibility|relax|fixedLoss|dataLimit> <초>
 */
import { diagnoseDataLimit, diagnoseFeasibility, diagnoseFixedLoss, diagnoseRelax } from "@/lib/v3/diagnose";
import { buildInstance } from "@/lib/v3/instance";
import { loadV3Case } from "./cases";

async function main() {
  const [spec, kind, secArg] = process.argv.slice(2);
  const input = loadV3Case(spec);
  const run = { input, inst: buildInstance(input), budgetMs: Number(secArg) * 1000, seed: 1 };
  const t0 = Date.now();
  let r: unknown;
  if (kind === "feasibility") {
    const f = await diagnoseFeasibility(run);
    r = { status: f.status, proof: f.proof, minUnplaced: f.minUnplaced, quickErrors: f.quick.filter((w) => w.severity === "error").map((w) => `${w.rule}:${w.who}:${w.need}>${w.have}`), left: f.leftLessons.length };
  } else if (kind === "relax") {
    const x = await diagnoseRelax(run);
    r = { status: x.status, minimal: x.minimal, items: x.items, candidates: x.candidates, structural: x.structural.map((w) => w.message) };
  } else if (kind === "fixedLoss") r = await diagnoseFixedLoss(run);
  else r = await diagnoseDataLimit(run);
  console.log(JSON.stringify({ spec, kind, sec: (Date.now() - t0) / 1000, ...(r as object) }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
