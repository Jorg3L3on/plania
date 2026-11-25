// The first-install audit (19 Nov 2026), the screen's part: the code in the address (F4), first start's «Más opciones»
// (F5), one resume for both pauses (F6), the home project off the lists while it holds no work (F7), gh before a
// project with code (F2), the machine check's wait line (P3) and «Conectar Claude Code» (P5). The words and rules in
// ui/src/lib/ without a browser, and the routes behind them on a throwaway database. No process is spawned.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Hono } from "hono";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-onboarding-"));
const kit = path.join(scratch, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
useTestEnv();
for (const k of ["PLANIA_EVENT_WAKES", "PLANIA_PASSWORD_HASH", "PLANIA_RUNNER_TOKEN", "PLANIA_HOME_PROJECT", "PLANIA_PROMPTS_PROJECT", "PLANIA_PROJECTS_ROOT", "PLANIA_WORKTREES_ROOT"]) delete process.env[k];
process.env.PLANIA_PORT = "3747";

const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { issueSetupCode } = await import("../src/db/install.js");
const state = await import("../src/install-state.js");
const { findToken } = await import("../src/auth/tokens.js");
const { offeredFolders, defaultFolders, worktreesDefault } = await import("../src/folders.js");
const onboarding = await import("../src/api/onboarding.js");
const primer = await import("../ui/src/lib/primer-arranque.js");
const guia = await import("../ui/src/lib/primera-entrega.js");
const pausas = await import("../ui/src/lib/pausas.js");
const visibles = await import("../ui/src/lib/proyectos-visibles.js");
const gh = await import("../ui/src/lib/github-aviso.js");
const revisando = await import("../ui/src/lib/revisando.js");
const conectar = await import("../ui/src/lib/conectar-claude.js");

type Json = Record<string, any>;
let raw: pg.Client;
let closeDb: () => Promise<void>;
let cookie = "";
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const headers = () => ({ Cookie: cookie, "Content-Type": "application/json" });
const get = async (url: string) => {
  const r = await app.request(url, { headers: headers() });
  assert.equal(r.status, 200, `${url}: ${await r.clone().text()}`);
  return (await r.json()) as Json;
};
const post = (url: string, body: unknown = {}, extra: Record<string, string> = {}) => app.request(url, { method: "POST", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });

before(async () => {
  raw = await resetTestDb();
  await raw.query(`delete from projects`);
  ({ close: closeDb } = makeDb());
  state.resetInstallState();
  writeFileSync(path.join(scratch, ".env"), "");
  const code = await issueSetupCode(raw, path.join(scratch, ".env"), () => "ONBO-ONBO-ONBO");
  const res = await app.request(
    "http://localhost:3737/api/first-start",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Ana", password: "una contraseña larga", time_zone: "Europe/Madrid" }) },
    LOOPBACK,
  );
  assert.equal(res.status, 201, await res.clone().text());
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});

after(async () => {
  state.resetInstallState();
  delete process.env.PLANIA_PORT;
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

test("F4: the one-time code comes from the address fragment; the field shows only without it or after a refusal", () => {
  assert.equal(primer.codeFromHash("#code=ABCD-EFGH-JKMN"), "ABCD-EFGH-JKMN");
  assert.equal(primer.codeFromHash("code=ABCD"), "ABCD");
  assert.equal(primer.codeFromHash("#code=%20ABCD%20"), "ABCD");
  assert.equal(primer.codeFromHash(""), null);
  assert.equal(primer.codeFromHash("#"), null);
  assert.equal(primer.codeFromHash("#other=1"), null);
  assert.equal(primer.codeFromHash(`#code=${"x".repeat(65)}`), null);
  assert.equal(primer.showCodeField(false, null), true);
  assert.equal(primer.showCodeField(true, null), false);
  assert.equal(primer.showCodeField(true, "INVALID_BODY"), false);
  assert.equal(primer.showCodeField(true, "SETUP_CODE_INVALID"), true, "a wrong code in the link shows the field to type it");
});

test("F5: first start offers the folders as this machine writes them, and opens «Más opciones» only for what lives there", () => {
  const win = defaultFolders("C:\\Users\\ana");
  assert.equal(win.projects, path.join("C:\\Users\\ana", "plania", "projects"));
  assert.deepEqual(offeredFolders({ PLANIA_PROJECTS_ROOT: "/srv/code" }, "/home/ana"), { projects: "/srv/code", worktrees: worktreesDefault(path.join("/home/ana", "plania")) });

  const offered = { projects: "C:\\Users\\ana\\plania\\projects", worktrees: "C:\\Users\\ana\\plania\\worktrees" };
  const f = primer.initialForm({ folders: offered }, "Europe/Madrid", "ABCD");
  assert.deepEqual(f, { code: "ABCD", name: "", password: "", repeat: "", time_zone: "Europe/Madrid", projects_root: offered.projects, worktrees_root: offered.worktrees });
  // An older server says nothing: the neutral defaults stay.
  assert.equal(primer.initialForm(undefined, "UTC").projects_root, primer.DEFAULT_PROJECTS_ROOT);

  const ok = { ...f, name: "Ana", password: "una contraseña larga", repeat: "una contraseña larga" };
  assert.equal(primer.problemInOptions(ok), false);
  assert.equal(primer.problemInOptions({ ...ok, time_zone: " " }), true);
  assert.equal(primer.problemInOptions({ ...ok, worktrees_root: "" }), true);
  assert.equal(primer.problemInOptions({ ...ok, name: "", time_zone: "" }), false, "the name is shown first, outside the options");
  assert.equal(primer.problemInOptions(ok, "time_zone"), true);
  assert.equal(primer.problemInOptions(ok, "projects_root"), true);
  assert.equal(primer.problemInOptions(ok, "password"), false);
  assert.equal(primer.FIRST_START.es.moreOptions, "Más opciones");
  assert.equal(primer.FIRST_START.en.moreOptions, "More options");
});

test("F6: one resume for both pauses, in the guide and on the project page", () => {
  assert.equal(pausas.pausaDe(true, true), "ambas");
  assert.equal(pausas.pausaDe(true, false), "compania");
  assert.equal(pausas.pausaDe(false, true), "proyecto");
  assert.equal(pausas.pausaDe(false, false), null);
  const es = pausas.pausasWords("es");
  assert.equal(es.ambasBoton("Ejemplo"), "Reanudar la compañía y Ejemplo");
  assert.equal(es.ambasAviso("Ejemplo"), "La compañía y Ejemplo están en pausa: nada arranca.");
  assert.equal(pausas.pausasWords("en").ambasBoton("Example"), "Resume the company and Example");

  const read = { visible: true, proyecto: { slug: "ejemplo", title: "Ejemplo" }, maquina: "lista", company_paused: true, project_paused: true, pedido: false, plan: "nada", entrega: "nada", fallo: null, est_pct_per_run: 3 } as const;
  const paso = guia.pasosDe(read, "en")[2]!;
  assert.equal(paso.accion, "reanudar");
  assert.equal(paso.texto, "The company and Ejemplo start paused. Resume starts both with one button.");
  assert.deepEqual(guia.aReanudar(read), { project: "ejemplo", company: true });
  assert.deepEqual(guia.aReanudar({ ...read, project_paused: false }), { project: null, company: true });
  assert.equal(guia.pasosDe({ ...read, proyecto: null }, "es")[2]!.accion, undefined, "no project yet: nothing to resume in place");
});

test("F7: the home project stays off the lists while it holds no work, and comes back once it does", async () => {
  assert.deepEqual(visibles.listedProjects([{ slug: "plania", quiet_home: true }, { slug: "ejemplo" }]), [{ slug: "ejemplo" }]);
  assert.deepEqual(visibles.listedProjects([{ slug: "plania", quiet_home: true }], "plania"), [{ slug: "plania", quiet_home: true }], "asked for by slug");

  // Right after first start: the home project exists, with no task.
  const company = await get("/api/company");
  const home = company.projects.find((p: Json) => p.slug === "plania");
  assert.ok(home, "reads by slug still find it");
  assert.equal(home.quiet_home, true);
  assert.deepEqual(visibles.listedProjects(company.projects as { slug: string; quiet_home?: boolean }[]), []);
  assert.equal((await get("/api/projects")).find((p: Json) => p.slug === "plania").quiet_home, true);
  assert.equal((await get("/api/projects?for=stream")).find((p: Json) => p.slug === "plania").quiet_home, true);

  // The example project shows; the home project still does not.
  assert.equal((await post("/api/guia/ejemplo")).status, 201);
  const listed = visibles.listedProjects((await get("/api/company")).projects as { slug: string; quiet_home?: boolean }[]).map((p) => p.slug);
  assert.deepEqual(listed, ["ejemplo"]);

  // Once the home project holds work it is listed like any other.
  const made = await post("/api/projects/plania/tasks", { title: "Algo para Plania" });
  assert.equal(made.status, 201, await made.clone().text());
  assert.equal((await get("/api/company")).projects.find((p: Json) => p.slug === "plania").quiet_home, false);
  assert.equal((await get("/api/projects")).find((p: Json) => p.slug === "plania").quiet_home, undefined);
});

test("F2: gh is asked before a project with code, with the fix in the owner's words", async () => {
  // «Agregar un proyecto»: only Nube clones with gh; Local reads its folder and SSH uses git with the owner's keys.
  assert.equal(gh.pideGithub("github", ""), true);
  assert.equal(gh.pideGithub("carpeta", " owner/repo "), false);
  assert.equal(gh.pideGithub("ssh", "git@github.com:o/r.git"), false);
  assert.equal(gh.pideGithub("ninguno", "owner/repo"), false);
  assert.equal(gh.pideGithub(null, "owner/repo"), false);
  assert.equal(gh.githubAviso("ok"), null);
  assert.equal(gh.githubAviso(undefined), null);
  assert.equal(gh.githubAviso("something_new"), null);
  assert.deepEqual(gh.githubAviso("gh_signed_out", "es"), { por: "gh no tiene la sesión iniciada", arregla: "En una terminal, corre esto y elige GitHub.com:", comando: "gh auth login" });
  assert.equal(gh.githubAviso("gh_no_write", "es")!.comando, "gh auth refresh -h github.com -s repo");
  assert.match(gh.githubAviso("gh_absent", "en")!.arregla, /https:\/\/cli\.github\.com/);
  assert.equal(gh.githubAviso("no_token", "es")!.comando, null);

  // The route answers with the readiness list's own access (injected here; the real one runs gh).
  const routes = new Hono().route("/onboarding", onboarding.onboardingRoutes({ githubAccess: async () => "gh_signed_out" }));
  assert.deepEqual(await (await routes.request("/onboarding/github")).json(), { access: "gh_signed_out" });
  // Behind the session like the rest of the screen's API.
  assert.equal((await app.request("/api/onboarding/github")).status, 401);
});

test("P3: the machine check says it is running while the Claude test runs", () => {
  assert.equal(revisando.revisandoLine("es"), "Revisando… la prueba de Claude tarda unos segundos.");
  assert.equal(revisando.revisandoLine("en"), "Checking… the Claude test takes a few seconds.");
});

test("P5: «Conectar Claude Code» makes a token of its own and the exact line, for the owner's session only", async () => {
  assert.equal(
    conectar.claudeMcpAddLine("http://localhost:3747/mcp", "pla_abc"),
    'claude mcp add --scope user --transport http plania http://localhost:3747/mcp --header "Authorization: Bearer pla_abc"',
  );
  assert.equal(onboarding.localMcpUrl({}), "http://localhost:3737/mcp");
  assert.equal(onboarding.localMcpUrl({}, "http://localhost:4000/api/onboarding/claude-code"), "http://localhost:4000/mcp", "the port the screen was reached on");

  assert.equal((await app.request("/api/onboarding/claude-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401, "no session");
  const bearer = await post("/api/onboarding/claude-code", {}, { Authorization: "Bearer pla_whatever" });
  assert.equal(bearer.status, 403, "a Bearer is a bot, even with the cookie");

  const r = await post("/api/onboarding/claude-code");
  assert.equal(r.status, 201, await r.clone().text());
  const out = (await r.json()) as Json;
  assert.equal(out.url, "http://localhost:3747/mcp");
  assert.match(out.secret, /^pla_/);
  assert.notEqual(out.secret, process.env.MCP_BEARER_TOKEN, "never the shared token");
  const { db } = makeDb();
  const id = await findToken(db, out.secret);
  assert.equal(id?.agent, onboarding.CLAUDE_CODE_AGENT);
  assert.deepEqual(id?.scopes, ["read", "write"]);
  // Shown once: the token list holds its prefix, never the secret.
  const listed = (await get("/api/tokens")) as unknown as Json[];
  const row = listed.find((t) => t.agent === "claude-code")!;
  assert.ok(row && !JSON.stringify(row).includes(out.secret));
});
