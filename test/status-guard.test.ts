// PLA-I74-4: a task's status is named in one place, src/state/ (ST and the lists in src/state/status.ts). A status
// string written anywhere else under src/ (a comparison, an SQL literal, a list) is how PLA-161, 163, 164 and 165
// happened: five readers each spelled "can this step be worked on" their own way. This scan fails on a new one.
// ALLOW holds the files that still spell statuses, with how many; the list only shrinks: a file whose count drops
// must lower its number here (or leave the list once it reaches zero), and no file is ever added.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ST } from "../src/state/status.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const NAMES = Object.values(ST).filter((s) => s !== ST.wontDo);
// "Ready", 'On hold' (SQL), `Done`; Won't do as "Won't do", 'Won''t do' or 'Won\'t do'.
const STATUS_LITERAL = new RegExp(`(["'\`])(?:${NAMES.join("|")}|Won(?:''|\\\\'|')t do)\\1`, "g");

export function statusLiterals(text: string): string[] {
  return text.match(STATUS_LITERAL) ?? [];
}

const ALLOW: Record<string, number> = {
  "src/api/auto-accept.ts": 1,
  "src/api/company-decisions.ts": 27,
  "src/api/company-extra.ts": 11,
  "src/api/company-ficha.ts": 13,
  "src/api/company-idea.ts": 12,
  "src/api/company-oficio.ts": 7,
  "src/api/company-orders.ts": 16,
  "src/api/company-org.ts": 7,
  "src/api/company-pedido.ts": 6,
  "src/api/company-pedidos.ts": 1,
  "src/api/cronometro.ts": 13,
  "src/api/etapa.ts": 28,
  "src/api/guia.ts": 1,
  "src/api/routes.ts": 14,
  "src/api/scoreboard.ts": 4,
  "src/api/team.ts": 2,
  "src/api/thread-actions.ts": 12,
  "src/brand/marca.ts": 13,
  "src/brand/pedido.ts": 5,
  "src/brand/style.ts": 3,
  "src/brief/act.ts": 5,
  "src/brief/actions.ts": 25,
  "src/brief/facts.ts": 7,
  "src/brief/ideas.ts": 6,
  "src/brief/merge.ts": 8,
  "src/brief/pipeline.ts": 3,
  "src/brief/plan.ts": 2,
  "src/brief/types.ts": 1,
  "src/captures/probador.ts": 8,
  "src/db/schema.ts": 22,
  "src/jobs/github.ts": 21,
  "src/maquinas/copias.ts": 2,
  "src/maquinas/sobrantes.ts": 7,
  "src/mcp/agent-surface.ts": 5,
  "src/mcp/audit.ts": 26,
  "src/mcp/blockers.ts": 29,
  "src/mcp/branches.ts": 2,
  "src/mcp/ceo-signals.ts": 19,
  "src/mcp/goals.ts": 1,
  "src/mcp/initiative-state.ts": 16,
  "src/mcp/orden.ts": 2,
  "src/mcp/progress.ts": 32,
  "src/mcp/proposals.ts": 8,
  "src/mcp/questions.ts": 10,
  "src/mcp/readiness.ts": 5,
  "src/mcp/register.ts": 3,
  "src/mcp/release-plan.ts": 5,
  "src/mcp/requests.ts": 4,
  "src/mcp/resume.ts": 2,
  "src/mcp/sequences.ts": 1,
  "src/mcp/stage-docs.ts": 2,
  "src/mcp/status.ts": 7,
  "src/mcp/tx.ts": 3,
  "src/mcp/watch.ts": 22,
  "src/mcp/working-on.ts": 5,
  "src/mcp/writes.ts": 47,
  "src/ops/in-flight.ts": 1,
  "src/owner.ts": 2,
  "src/runner/qa.ts": 5,
  "src/self/agent-migrations.ts": 2,
};

function walk(rel: string): string[] {
  return readdirSync(path.join(ROOT, rel)).flatMap((f) => {
    const p = path.posix.join(rel, f);
    return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

test("the scanner sees a status string in a comparison, a list and SQL", () => {
  assert.deepEqual(statusLiterals(`if (t.status === "Ready") return;`), ['"Ready"']);
  assert.deepEqual(statusLiterals("sql`par.status = 'On hold'`"), ["'On hold'"]);
  assert.deepEqual(statusLiterals(`const CLOSED = ["Done", "Won't do"];`), ['"Done"', `"Won't do"`]);
  assert.deepEqual(statusLiterals("sql`${tasks.status} <> 'Won''t do'`"), ["'Won''t do'"]);
  assert.deepEqual(statusLiterals(`if (t.status === ST.ready) return; // a Ready step`), []);
});

test("no file outside src/state/ spells a task status beyond its allowance", () => {
  const over: string[] = [];
  const under: string[] = [];
  const seen = new Set<string>();
  for (const f of walk("src")) {
    if (f.startsWith("src/state/")) continue;
    const n = statusLiterals(readFileSync(path.join(ROOT, f), "utf8")).length;
    if (!n) continue;
    seen.add(f);
    const allowed = ALLOW[f] ?? 0;
    if (n > allowed) over.push(`${f}: ${n} status strings, ${allowed} allowed; use ST from src/state/status.ts`);
    if (n < allowed) under.push(`${f}: ${n} status strings now; lower its ALLOW entry to ${n}`);
  }
  for (const f of Object.keys(ALLOW)) if (!seen.has(f)) under.push(`${f}: no status strings left; remove it from ALLOW`);
  assert.deepEqual(over, []);
  assert.deepEqual(under, []);
});
