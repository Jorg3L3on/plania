// PLA-I2-12: the machine check. Every outside call is a fake: the programs, the Postgres probe, the Claude dry run
// (except where the fake Claude in test/fixtures answers it), disk, memory and Chrome.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import type { ExecFn, ExecResult } from "../src/brief/doctor.js";
import { blocking, formatMachineCheck, installGate, machineCheck, skippedChecks, type MachineCheckDeps } from "../src/machine-check/index.js";
import { machineCheckRoutes } from "../src/api/machine-check.js";
import { isSignedOut } from "../src/runner/signed-out.js";
import { parseStream } from "../src/runner/stream.js";
import { MACHINE_ITEMS, REQUIRED, fixParts, machineHeadline, type MachineItem } from "../ui/src/lib/falta.js";
// calidad.ts uses the screen's "@/" paths: loaded by URL, as test/audit-calidad-ui.test.ts does.
const { runWords } = (await import(new URL("../ui/src/lib/calidad.ts", import.meta.url).href)) as { runWords: (s: string) => string | null };
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as { React?: unknown }).React = React;
const { FaltaView } = (await import(new URL("../ui/src/pages/falta.tsx", import.meta.url).href)) as { FaltaView: React.ComponentType<{ reading: unknown }> };

const FAKE_CLAUDE = path.join(import.meta.dirname, "fixtures/fake-claude.mjs");
const GB = 1024 ** 3;

type Gh = "ok" | "signed_out" | "no_write" | "fine_grained";
const AUTH: Record<Gh, ExecResult> = {
  ok: { code: 0, stdout: "github.com\n  ✓ Logged in to github.com account someone (keyring)\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n", stderr: "" },
  fine_grained: { code: 0, stdout: "github.com\n  ✓ Logged in to github.com account someone (GH_TOKEN)\n", stderr: "" },
  no_write: { code: 0, stdout: "github.com\n  ✓ Logged in to github.com account someone (keyring)\n  - Token scopes: 'read:org'\n", stderr: "" },
  signed_out: { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n" },
};
const GONE: ExecResult = { code: null, stdout: "", stderr: "spawn ENOENT" };

/** A machine with everything, minus the programs named in `missing`. */
function machine(o: { missing?: string[]; gh?: Gh; pgDump?: string } = {}): MachineCheckDeps & { calls: string[] } {
  const missing = new Set(o.missing ?? []);
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    const name = path.basename(cmd);
    calls.push(`${name} ${args.join(" ")}`);
    if (missing.has(name)) return GONE;
    if (name === "git") return { code: 0, stdout: "git version 2.43.0\n", stderr: "" };
    if (name === "gh") return args[0] === "--version" ? { code: 0, stdout: "gh version 2.45.0 (2024-03-04)\n", stderr: "" } : AUTH[o.gh ?? "ok"];
    if (name === "claude") return { code: 0, stdout: "2.1.302 (Claude Code)\n", stderr: "" };
    if (name === "pg_dump") return { code: 0, stdout: `pg_dump (PostgreSQL) ${o.pgDump ?? "16.2"}\n`, stderr: "" };
    return GONE;
  };
  return {
    calls,
    env: { HOME: "/home/someone", DATABASE_URL: "postgres://localhost:5432/plania_fake", CLAUDE_CODE_BIN: "/fake/bin/claude", PLANIA_PG_BIN: "/fake/pg" },
    exec,
    nodeVersion: "22.11.0",
    pgProbe: async () => ({ ok: true, versionNum: 160002 }),
    claudeDryRun: async () => ({ state: "signed_in", structuredOutput: true }),
    freeDisk: async () => 120 * GB,
    totalMemory: () => 16 * GB,
    findChrome: () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  };
}
const byId = (items: MachineItem[]) => new Map(items.map((i) => [i.id, i]));

test("I2-12: a machine with everything is ready, item by item, in the shared order", async () => {
  const items = await machineCheck(machine());
  assert.deepEqual(items.map((i) => i.id), [...MACHINE_ITEMS]);
  assert.deepEqual(items.filter((i) => i.state !== "ready").map((i) => i.id), []);
  assert.equal(blocking(items).length, 0);
  assert.equal(byId(items).get("postgres")!.sentence, "Postgres 16.2 responde.");
  assert.equal(byId(items).get("claude")!.sentence, "Claude Code 2.1.302 está instalado.");
  assert.equal(machineHeadline(items), "El entorno está listo para continuar.");
  assert.ok(items.every((i) => i.fix === null));
});

test("I2-12 #1: each required program missing in turn is named with its fix, and the install gate stops", async () => {
  const cases: { label: string; deps: MachineCheckDeps; id: MachineItem["id"]; also?: MachineItem["id"][] }[] = [
    { label: "git", deps: machine({ missing: ["git"] }), id: "git" },
    { label: "claude", deps: machine({ missing: ["claude"] }), id: "claude", also: ["claude_session"] },
    { label: "pg_dump", deps: machine({ missing: ["pg_dump"] }), id: "pg_dump" },
    { label: "postgres off", deps: { ...machine(), pgProbe: async () => ({ ok: false }) }, id: "postgres" },
    { label: "postgres unset", deps: { ...machine(), env: { ...machine().env, DATABASE_URL: "" } }, id: "postgres" },
    { label: "old node", deps: { ...machine(), nodeVersion: "20.11.1" }, id: "node" },
    { label: "old postgres", deps: { ...machine(), pgProbe: async () => ({ ok: true, versionNum: 130012 }) }, id: "postgres" },
    { label: "old pg_dump", deps: machine({ pgDump: "14.10" }), id: "pg_dump" },
    { label: "little disk", deps: { ...machine(), freeDisk: async () => 3 * GB }, id: "disk" },
    { label: "little memory", deps: { ...machine(), totalMemory: () => 4 * GB }, id: "memory" },
  ];
  for (const c of cases) {
    const items = await machineCheck(c.deps);
    const missing = blocking(items).map((i) => i.id);
    assert.deepEqual(missing, [c.id, ...(c.also ?? [])].sort((a, b) => MACHINE_ITEMS.indexOf(a) - MACHINE_ITEMS.indexOf(b)), c.label);
    const item = byId(items).get(c.id)!;
    assert.equal(item.state, "missing", c.label);
    assert.ok(item.required, c.label);
    assert.ok(item.sentence.length > 10 && item.fix && item.fix.length > 10, `${c.label}: ${item.sentence} / ${item.fix}`);
    const gate = await installGate(c.deps);
    // PLA-I2-4 (from zero): Claude Code is the owner's to install; the install goes on and names it at the end.
    assert.equal(gate.proceed, c.id === "claude", c.label);
    assert.deepEqual(gate.later.map((i) => i.id), c.id === "claude" ? ["claude", "claude_session"] : [], c.label);
    assert.ok(gate.text.includes(item.sentence) && gate.text.includes(item.fix!), c.label);
    assert.match(gate.text, new RegExp(`✗ ${item.name.replace(/[()]/g, "\\$&")}`), c.label);
  }
  // The names a stranger reads, with the step that fixes each.
  const gone = byId(await machineCheck(machine({ missing: ["git", "gh", "claude", "pg_dump"] })));
  assert.equal(gone.get("git")!.fix, "Instala git: https://git-scm.com/downloads");
  // F2: gh missing is named with its fix, but does not stop the install.
  assert.equal(gone.get("gh")!.state, "optional");
  assert.equal(gone.get("gh")!.fix, "Instálala: https://cli.github.com");
  assert.match(gone.get("claude")!.fix!, /^Instálalo: https:\/\//);
  assert.equal(gone.get("claude_session")!.reason, "not_checked");
  assert.match(gone.get("pg_dump")!.sentence, /sin él no hay respaldos/);
});

test("I2-12 #1: the install gate goes on when only the optional Chrome is missing, and never runs a program twice", async () => {
  const deps = { ...machine(), findChrome: () => null };
  const gate = await installGate(deps);
  assert.equal(gate.proceed, true);
  const chrome = byId(gate.items).get("chrome")!;
  assert.deepEqual([chrome.state, chrome.required], ["optional", false]);
  assert.ok(gate.text.includes("· Chrome, para las fotos de pantalla:"));
  assert.ok(gate.text.includes("(opcional)"));
  assert.equal(new Set(deps.calls).size, deps.calls.length, deps.calls.join(" | "));
  // Only gh (F2: needed before the first project with code, not to install) and Chrome are optional.
  assert.deepEqual(MACHINE_ITEMS.filter((id) => !REQUIRED[id]), ["gh", "chrome"]);
});

test("PLA-I2-4: PLANIA_UNSUPPORTED_SKIP_CHECK (CI only) lets the gate pass an item; unknown ids are ignored", async () => {
  const deps = { ...machine(), totalMemory: () => 7 * GB };
  assert.equal((await installGate(deps)).proceed, false);
  const skip = skippedChecks({ GITHUB_ACTIONS: "true", PLANIA_UNSUPPORTED_SKIP_CHECK: " memory, nonsense" });
  assert.deepEqual(skip, ["memory"]);
  const gate = await installGate(deps, { skip });
  assert.equal(gate.proceed, true);
  assert.equal(byId(gate.items).get("memory")!.state, "missing", "still reported");
  assert.deepEqual(skippedChecks({}), []);
  assert.deepEqual(skippedChecks({ PLANIA_UNSUPPORTED_SKIP_CHECK: "memory" }), [], "off a GitHub Actions runner it is ignored");
});

test("I2-12 #4: gh not installed, signed out, and signed in without write access are three different items", async () => {
  const gh = async (deps: MachineCheckDeps) => byId(await machineCheck(deps)).get("gh")!;
  const absent = await gh(machine({ missing: ["gh"] }));
  const out = await gh(machine({ gh: "signed_out" }));
  const noWrite = await gh(machine({ gh: "no_write" }));
  const ok = await gh(machine({ gh: "ok" }));
  const fine = await gh(machine({ gh: "fine_grained" }));
  assert.deepEqual([absent.reason, out.reason, noWrite.reason, ok.reason, fine.reason], ["absent", "signed_out", "no_write", "ok", "ok"]);
  // F2: none of them stops the install; each says gh is needed before the first project with code.
  assert.deepEqual([absent.state, out.state, noWrite.state, ok.state], ["optional", "optional", "optional", "ready"]);
  for (const i of [absent, out, noWrite]) assert.match(i.sentence, /antes del primer proyecto con código/);
  assert.equal((await installGate(machine({ missing: ["gh"] }))).proceed, true);
  assert.equal(new Set([absent.sentence, out.sentence, noWrite.sentence]).size, 3);
  assert.equal(out.fix, "En una terminal corre: gh auth login");
  assert.equal(noWrite.fix, "En una terminal corre: gh auth refresh -s repo");
  assert.match(noWrite.sentence, /sin permiso para escribir/);
});

// The fake Claude, run for real through node: what a signed-out Claude Code prints.
const fakeClaude =
  (extraEnv: Record<string, string>): ExecFn =>
  (_cmd, args, opts) =>
    new Promise((resolve) => {
      execFile(process.execPath, [FAKE_CLAUDE, ...args], { env: { ...process.env, ...opts.env, ...extraEnv, FAKE_MS: "30" }, timeout: opts.timeoutMs }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    });

test("I2-12 #2: a signed-out Claude is reported by the check in words (fake Claude, the brief doctor's dry run)", async () => {
  const base = machine();
  const claudeOnly = (extra: Record<string, string>): ExecFn => async (cmd, args, opts) =>
    path.basename(cmd) === "claude" ? fakeClaude(extra)(cmd, args, opts) : base.exec!(cmd, args, opts);
  const { claudeDryRun: _skip, ...rest } = base;
  const out = byId(await machineCheck({ ...rest, exec: claudeOnly({ FAKE_SIGNED_OUT: "1" }) }));
  assert.equal(out.get("claude")!.state, "ready", "the version answers even when signed out");
  const s = out.get("claude_session")!;
  assert.deepEqual([s.state, s.reason], ["missing", "signed_out"]);
  assert.equal(s.sentence, "Claude no tiene la sesión iniciada en esta máquina.");
  assert.equal(s.fix, "En una terminal corre claude y entra con tu cuenta (/login).");
  // Signed in, the same fake run reads as ready (it has no structured output; the machine check does not need one).
  const inn = byId(await machineCheck({ ...rest, exec: claudeOnly({}) }));
  assert.equal(inn.get("claude_session")!.state, "ready");
});

test("I2-12 #2: the runner's test reads the fake Claude's signed-out output, and the screen words the run", async () => {
  const run = await fakeClaude({ FAKE_SIGNED_OUT: "1" })("claude", ["-p", "x"], { env: {}, cwd: ".", timeoutMs: 20_000 });
  assert.equal(run.code, 1);
  const result = parseStream(run.stdout).result;
  assert.ok(isSignedOut(result));
  const ok = await fakeClaude({})("claude", ["-p", "x"], { env: {}, cwd: ".", timeoutMs: 20_000 });
  assert.equal(isSignedOut(parseStream(ok.stdout).result), false);
  // A real run that failed late and mentions a login page is not a signed-out Claude.
  assert.equal(isSignedOut({ isError: true, numTurns: 30, hasModelUsage: true, resultText: "the login page still fails" }), false);
  assert.equal(runWords("fail: signed out (1 turns, session fake-ses)"), "Falló: sin sesión de Claude en esta máquina (1 turnos)");
  assert.equal(runWords("fail: no result"), "Falló: terminó sin dar resultado");
});

test("I2-12 #3: the screen's route returns the same items the install command prints; ten minutes, then fresh", async () => {
  const deps = machine({ gh: "no_write", missing: ["pg_dump", "git"] });
  let runs = 0;
  let clock = Date.parse("2026-11-18T10:00:00Z");
  const app = machineCheckRoutes(
    () => {
      runs += 1;
      return machineCheck(deps);
    },
    () => new Date(clock),
  );
  const read = async (q = "") => (await (await app.request(`/${q}`)).json()) as { items: MachineItem[]; ready: boolean; checked_at: string };
  const screen = await read();
  const gate = await installGate(deps);
  assert.deepEqual(screen.items, gate.items);
  assert.equal(screen.ready, gate.proceed);
  for (const i of screen.items) assert.ok(gate.text.includes(i.sentence), i.id);
  assert.equal(formatMachineCheck(screen.items), gate.text);
  assert.equal(machineHeadline(screen.items), "A esta máquina le faltan 2 cosas.");
  // The page renders every item of that reading: its name, its sentence and its fix, the link clickable.
  const html = renderToStaticMarkup(React.createElement(FaltaView, { reading: screen }));
  const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  assert.ok(text.includes("A esta máquina le faltan 2 cosas."));
  for (const i of gate.items) {
    assert.ok(text.includes(i.name) && text.includes(i.sentence), i.id);
    if (i.fix) assert.ok(text.includes(i.fix), `${i.id}: ${i.fix}`);
  }
  assert.ok(html.includes('href="https://www.google.com/chrome/"') === false, "Chrome is installed in this reading");
  assert.equal((html.match(/aria-label="Falta"/g) ?? []).length, 2);
  // Kept for ten minutes, checked again with ?fresh=1 or after.
  await read();
  assert.equal(runs, 1);
  await read("?fresh=1");
  assert.equal(runs, 2);
  clock += 11 * 60_000;
  await read();
  assert.equal(runs, 3);
});

test("I2-12: a fix's link is split out for the page", () => {
  assert.deepEqual(fixParts("Instálala: https://cli.github.com"), { before: "Instálala: ", url: "https://cli.github.com", after: "" });
  assert.deepEqual(fixParts("Instálalo: https://x.dev/setup (o escribe su ruta)"), { before: "Instálalo: ", url: "https://x.dev/setup", after: " (o escribe su ruta)" });
  assert.deepEqual(fixParts("En una terminal corre: gh auth login"), { before: "En una terminal corre: gh auth login", url: null, after: "" });
});
