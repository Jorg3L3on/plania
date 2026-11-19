// PLA-I2-7: the page «Lo que el equipo nunca puede hacer». Pure: no database, no network.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { limitsInput, limitsRoutes } from "../src/api/limits.js";
import { writeSettings } from "../src/db/install.js";
import { OUTBOUND } from "../src/outbound.js";
import { CONSULTA_DENY_RULES, DENY_GROUPS, DENY_RULES, PROTECTED_BRANCHES, QA_DENY_RULES, RUN_GROUP_IDS, deniedBy } from "../src/runner/deny.js";
import { newInstallSettings } from "../src/runner/isolation.js";
import { claudeArgs, isolationOf } from "../src/runner/runner.js";
import { checkBase } from "../src/runner/worktree.js";
import { DOES_WORDS, GROUP_WORDS, LIMITS_LINK, LIMITS_PATH, OUTBOUND_WORDS, RULES_CANNOT, limitsPage, type LimitsPage } from "../ui/src/lib/limites.js";
(globalThis as { React?: unknown }).React = React;
const { LimitesView } = (await import(new URL("../ui/src/pages/limites.tsx", import.meta.url).href)) as { LimitesView: React.ComponentType<{ page: LimitsPage }> };

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const page = () => limitsPage(limitsInput({}));
const allText = (p: LimitsPage) => JSON.stringify(p);

test("I2-7 #1: every deny group and every rule has plain words on the page", () => {
  const ids = DENY_GROUPS.map((g) => g.id);
  assert.deepEqual(ids, ["protected-branches", "force-push", "pull-requests", "production", "plania-writes", "qa", "preguntar"]);
  for (const g of DENY_GROUPS) {
    assert.ok(GROUP_WORDS[g.id], `group ${g.id} has no words`);
    if (!RUN_GROUP_IDS.includes(g.id)) assert.ok(GROUP_WORDS[g.id]!.extra, `group ${g.id} says not when it applies`);
    for (const r of g.rules) assert.ok(DOES_WORDS[r.does], `rule ${r.rule} (${r.does}) has no words`);
  }
  // No stale words either: every sentence belongs to something real.
  const used = new Set(DENY_GROUPS.flatMap((g) => g.rules.map((r) => r.does)));
  assert.deepEqual(Object.keys(DOES_WORDS).filter((k) => !used.has(k)), []);
  assert.deepEqual(Object.keys(GROUP_WORDS).filter((k) => !ids.includes(k as never)), []);
  // The page shows every group, and nothing reads as missing.
  const p = page();
  assert.deepEqual(p.never.map((g) => g.id), ids);
  assert.equal(p.never.reduce((n, g) => n + g.rules, 0), DENY_GROUPS.reduce((n, g) => n + g.rules.length, 0));
  assert.doesNotMatch(allText(p), /sin palabras/);
  // The lists the runner hands to Claude are the groups' rules, nothing more.
  assert.deepEqual([...DENY_RULES], DENY_GROUPS.filter((g) => RUN_GROUP_IDS.includes(g.id)).flatMap((g) => g.rules.map((r) => r.rule)));
  assert.deepEqual([...CONSULTA_DENY_RULES], [...QA_DENY_RULES, ...DENY_GROUPS.find((g) => g.id === "preguntar")!.rules.map((r) => r.rule)]);
});

test("I2-7 #1: a rule or group without words shows as missing (what the test above guards)", () => {
  const p = limitsPage({ groups: [{ id: "new-group", does: ["new-thing"], rules: 1 }], everyRun: [], outbound: [{ id: "new-dest", optional: false }], worktrees: "/w", isolation: null });
  assert.match(allText(p), /sin palabras/);
});

test("I2-7: one example per rule, refused by deniedBy()", () => {
  for (const g of DENY_GROUPS) {
    for (const r of g.rules) {
      assert.equal(deniedBy(r.example.tool, r.example.command, [r.rule]), r.rule, `${r.rule} does not refuse ${r.example.command ?? r.example.tool}`);
      const lane = RUN_GROUP_IDS.includes(g.id) ? DENY_RULES : g.id === "qa" ? QA_DENY_RULES : CONSULTA_DENY_RULES;
      assert.notEqual(deniedBy(r.example.tool, r.example.command, lane), null, `${g.id}: ${r.example.command ?? r.example.tool}`);
    }
  }
  // A builder's ordinary work still passes.
  for (const ok of ["git push -u origin jl/pla-i2-7", "gh pr create --base sandbox --title x", "git merge origin/sandbox", "git checkout jl/pla-i2-7", "pnpm test"]) {
    assert.equal(deniedBy("Bash", ok), null, ok);
  }
});

test("I2-7 #5: pushes, checkouts, merges and pull requests aimed at master, production and prod are refused as for main", () => {
  assert.deepEqual([...PROTECTED_BRANCHES], ["main", "master", "production", "prod"]);
  for (const b of PROTECTED_BRANCHES) {
    for (const command of [
      `git push origin ${b}`,
      `git push origin HEAD:${b}`,
      `git -C /tmp/wt push origin ${b}`,
      `cd /tmp/wt && git push origin ${b}`,
      `git checkout ${b}`,
      `git switch ${b}`,
      `git merge origin/${b}`,
      `git reset --hard origin/${b}`,
      `git branch -D ${b}`,
      `gh pr create --base ${b} --title x`,
      `gh pr create --title x --base ${b}`,
      `gh pr create -B ${b}`,
      `gh pr create --title x --base=${b}`,
      `gh pr edit 12 --base ${b}`,
    ]) {
      assert.notEqual(deniedBy("Bash", command), null, command);
    }
    // The base check refuses the same names.
    assert.equal(checkBase(b, null).ok, false, b);
  }
});

test("I2-7 #4: what leaves the machine comes from one list, each entry with words and a real call site", () => {
  const ids = OUTBOUND.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of OUTBOUND) {
    assert.ok(OUTBOUND_WORDS[o.id]?.name && OUTBOUND_WORDS[o.id]?.sentence, `${o.id} has no words`);
    assert.ok(existsSync(path.join(ROOT, o.code)), `${o.id}: ${o.code} is gone`);
  }
  assert.deepEqual(Object.keys(OUTBOUND_WORDS).filter((k) => !ids.includes(k as never)), []);
  assert.deepEqual(page().outbound.map((o) => o.id), ids);
  // The destinations the ticket names are all there.
  for (const id of ["claude", "github-read", "github-merge", "vercel-read", "push", "qa-browser", "agent-wake", "tailscale"]) assert.ok(ids.includes(id as never), id);
  // The hosts the code calls are each in the list.
  const hosts: [string, string][] = [
    ["src/jobs/github.ts", "api.github.com"],
    ["src/jobs/vercel.ts", "api.vercel.com"],
    ["src/lib/scan/gitleaks.ts", "github.com/gitleaks"],
    ["src/push.ts", "web-push"],
    ["src/runner/runner.ts", "@playwright/mcp"],
    ["src/captures/vivo.ts", "tailscale serve"],
  ];
  for (const [file, needle] of hosts) {
    assert.ok(read(file).includes(needle), `${file} no longer has ${needle}`);
    assert.ok(OUTBOUND.some((o) => o.code === file), `${file} calls out and is not in OUTBOUND`);
  }
});

test("I2-7 #6: the page says the limits are rules the agent follows, not a barrier of the operating system", () => {
  const p = page();
  assert.deepEqual(p.cannot, [...RULES_CANNOT]);
  assert.match(p.cannot.join(" "), /las sigue el agente; no son un muro del sistema operativo/);
  assert.match(p.cannot.join(" "), /puede leer cualquier archivo que tú puedes leer/);
  const html = renderToStaticMarkup(React.createElement(LimitesView, { page: p }));
  for (const title of ["Lo que un agente nunca puede hacer", "Lo que solo haces tú", "Dónde trabajan los agentes", "Lo que sale de esta máquina", "Lo que estas reglas no pueden impedir"]) {
    assert.ok(html.includes(title), title);
  }
  assert.ok(html.includes("no son un muro del sistema operativo"));
  assert.equal((html.match(/data-limit-group=/g) ?? []).length, DENY_GROUPS.length);
  assert.equal((html.match(/data-outbound=/g) ?? []).length, OUTBOUND.length);
});

test("I2-7: the page is in the owner's words: no rule syntax, branch names, ticket keys or the word sandbox", () => {
  const p = page();
  const text = [...p.never.flatMap((g) => [g.title, g.lead, g.extra ?? "", ...g.items]), ...p.owner_only, ...p.where.slice(1), ...p.outbound.flatMap((o) => [o.name, o.sentence]), ...p.cannot].join("\n");
  for (const bad of [/\bmain\b/i, /\bmaster\b/i, /\bprod(uction)?\b/i, /sandbox/i, /Bash\(/, /mcp__/, /\bgit\s/, /\bgh\s/, /PLA-/, /\*/]) {
    assert.doesNotMatch(text, bad);
  }
  // Where agents work names the real folder.
  assert.match(page().where[0]!, new RegExp(limitsInput({}).worktrees.replace(/[\\.*+?^${}()|[\]]/g, "\\$&")));
});

test("I2-7 #2: a new install starts runs with isolation on; an existing install is left as it is", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plania-i2-7-"));
  try {
    const example = path.join(dir, ".env.example");
    writeFileSync(example, read(".env.example"));
    const secret = () => "s".repeat(64);
    // New: no .env yet.
    const fresh = path.join(dir, "new.env");
    const keys = writeSettings(fresh, example, "postgres://localhost/plania_x", secret);
    assert.ok(keys.includes("PLANIA_RUN_ISOLATION"));
    const env = Object.fromEntries(readFileSync(fresh, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    assert.equal(env.PLANIA_RUN_ISOLATION, newInstallSettings().PLANIA_RUN_ISOLATION);
    assert.equal(isolationOf(env), "project");
    const args = claudeArgs({ prompt: "x", settingsPath: "s", mcpConfigPath: "m", systemPromptPath: null, maxTurns: 1, resume: null, isolation: isolationOf(env) });
    assert.deepEqual(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2), ["--setting-sources", "project,local"]);
    // Existing: a .env without the variable keeps today's behaviour.
    const old = path.join(dir, "old.env");
    writeFileSync(old, "DATABASE_URL=postgres://localhost/plania_x\nSESSION_SECRET=a\nMCP_BEARER_TOKEN=b\n");
    assert.deepEqual(writeSettings(old, example, "postgres://localhost/plania_x", secret), []);
    assert.doesNotMatch(readFileSync(old, "utf8"), /PLANIA_RUN_ISOLATION/);
    assert.equal(isolationOf({}), null);
    // A re-run of the install on the new .env changes nothing, and "off" turns it off.
    assert.deepEqual(writeSettings(fresh, example, "postgres://localhost/plania_x", secret), []);
    assert.equal(isolationOf({ PLANIA_RUN_ISOLATION: "off" }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The page says which it is.
  assert.match(limitsPage(limitsInput({ PLANIA_RUN_ISOLATION: "project" })).where[2]!, /no cargan tus ajustes personales/);
  assert.match(limitsPage(limitsInput({})).where[2]!, /cargan también tus ajustes personales/);
});

test("I2-7 #3: the page is linked from Plomería and its link target is exported for first start", async () => {
  assert.equal(LIMITS_PATH, "/machine/limites");
  assert.ok(LIMITS_LINK.length > 0);
  const plomeria = read("ui/src/components/corriente/plomeria.tsx");
  assert.match(plomeria, /to=\{LIMITS_PATH\}/);
  assert.match(read("ui/src/App.tsx"), /path="\/machine\/limites" element=\{<LimitesPage \/>\}/);
  const res = await limitsRoutes().request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as LimitsPage;
  assert.equal(body.never.length, DENY_GROUPS.length);
  assert.equal(body.outbound.length, OUTBOUND.length);
});
