// PLA-I30: Compañía's model (ui/src/lib/compania.ts). Pure, no database. Fake numbers only.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  LEGACY_REDIRECTS,
  NAV,
  bannersOf,
  budgetBannerText,
  elapsed,
  planBannerText,
  sheetOf,
  tokens,
  type Budget,
  type Company,
  type CompanyProjectRow,
} from "../ui/src/lib/compania.js";

const NOW = new Date("2026-11-08T15:00:00Z").getTime();
const budget = (used: number, limit: number | null, extra: Partial<Budget> = {}): Budget => {
  if (limit == null) return { used, limit: null, pct: null, state: "stopped", reason: "unset", ...extra };
  const pct = Math.floor((used / limit) * 1000) / 10;
  return { used, limit, pct, state: pct >= 100 ? "stopped" : pct >= 80 ? "warn" : "ok", reason: null, ...extra };
};
const project = (slug: string, b: Budget, paused = false): CompanyProjectRow => ({ slug, title: slug, paused, paused_at: paused ? "2026-11-06T04:10:00Z" : null, budget: b });
const company = (patch: Partial<Company> = {}): Company => ({
  company: { paused: false, paused_at: null },
  settings: { max_concurrent: 1, cooldown_minutes: 30, plan_guard_pct: 70, reserve_tokens: 60000, max_turns: 40, timeout_minutes: 45 },
  week: { starts_at: "2026-11-02T06:00:00Z", resets_at: "2026-11-09T06:00:00Z", timezone: "America/Mexico_City" },
  projects: [],
  roles: [],
  runs: { live: [], queued: [] },
  plan: { five_hour_pct: 41, seven_day_pct: 23, resets_at: "2026-11-08T19:20:00Z", seven_day_resets_at: null, guard_pct: 70, status: "allowed", state: "ok", read_at: null, source: "stream" },
  ...patch,
});

test("tokens read as 1.18M, 640k and 820, and clocks never wrap", () => {
  assert.equal(tokens(1_180_000), "1.18M");
  assert.equal(tokens(2_000_000), "2M");
  assert.equal(tokens(640_400), "640k");
  assert.equal(tokens(820), "820");
  assert.equal(elapsed("2026-11-08T13:57:15Z", NOW), "1:02:45");
  assert.equal(elapsed("2026-11-08T14:45:28Z", NOW), "14:32");
});

test("banners: grey paused, red 100% per project, amber plan guard", () => {
  assert.deepEqual(bannersOf(company()), []);
  const paused = company({ company: { paused: true, paused_at: "2026-11-08T16:42:00Z" } });
  assert.deepEqual(bannersOf(paused).map((b) => b.kind), ["paused"]);
  const full = company({ projects: [project("micasa", budget(2_000_000, 2_000_000)), project("mianovia", budget(10, 1000))] });
  const [b] = bannersOf(full);
  assert.equal(b?.kind, "budget");
  assert.equal(budgetBannerText((b as { project: CompanyProjectRow }).project), "100% · micasa llegó a su límite semanal · 2M / 2M · nada nuevo arranca ahí hasta el lunes 00:00 · los demás siguen");
  const guard = company({ plan: { ...company().plan, five_hour_pct: 72, state: "stopped" } });
  assert.deepEqual(bannersOf(guard).map((x) => x.kind), ["plan"]);
  assert.match(planBannerText(guard.plan, "America/Mexico_City"), /^72% · la ventana de 5 h pasó el guardia · no arrancan corridas nuevas hasta 13:20/);
});

test("URL state: ?p and ?equipo are old links that redirect, ?vista previews, ?doc a doc; redirects and nav", () => {
  assert.deepEqual(sheetOf("?p=mianovia"), { kind: "project", slug: "mianovia" });
  assert.deepEqual(sheetOf("?vista=mianovia"), { kind: "vista", slug: "mianovia" });
  assert.deepEqual(sheetOf("?equipo"), { kind: "equipo" });
  assert.deepEqual(sheetOf("?doc=abc"), { kind: "doc", id: "abc" });
  assert.equal(sheetOf(""), null);
  // PLA-I33: the Equipo sheet left Compañía; its old route lands in Máquina, with the plumbing.
  assert.deepEqual(LEGACY_REDIRECTS, { "/ahora": "/ceo", "/goals": "/ceo#proyectos", "/equipo": "/machine" });
  assert.deepEqual(NAV.map((n) => n.label), ["Compañía", "Bandeja", "Progreso", "Máquina"]);
});

// PLA-I30-4 check 2: no money in the Compañía page or the dashboard components. Template literals (`${`)
// are code, not spend text, so they are stripped before looking for a dollar sign.
test("no dollar, USD or total_cost in the Compañía page and dashboard components", () => {
  const root = path.resolve(import.meta.dirname, "../ui/src");
  const files = ["pages/ceo.tsx", "pages/project.tsx", "pages/machine.tsx", "lib/compania.ts", "lib/org.ts"];
  for (const dir of ["components/dashboard", "components/compania"]) {
    for (const f of readdirSync(path.join(root, dir))) if (statSync(path.join(root, dir, f)).isFile()) files.push(path.join(dir, f));
  }
  const hits: string[] = [];
  for (const f of files) {
    const text = readFileSync(path.join(root, f), "utf8").replace(/\$\{/g, "");
    text.split("\n").forEach((line, i) => {
      if (/\$|USD|usd|total_cost|currency/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
