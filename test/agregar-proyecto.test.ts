// PLA-180: «Agregar un proyecto» (once «Nuevo proyecto»): one sheet with four ways in. Local (a folder here, chosen in the
// machine's folder window or typed), Nube (a GitHub repository cloned with gh), SSH (any repository cloned with git over
// SSH) and Sin código (the old no_code body, unchanged). POST /api/company/projects with origen, POST
// /api/company/carpeta (src/runner/open-project.ts). git, gh, the filesystem and the folder window are fakes: nothing
// is cloned or pushed. Throwaway DB and kit.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

const scratch = mkdtempSync(path.join(tmpdir(), "plania-agregar-"));
const kit = path.join(scratch, "kit");
mkdirSync(path.join(kit, "roles"), { recursive: true });
for (const r of ["product-owner", "research", "artist", "taller"]) writeFileSync(path.join(kit, "roles", `${r}.md`), `# ${r}\n\nFixture prompt.\n`);
process.env.PLANIA_KIT_DIR = kit;
useTestEnv();
const projectsRoot = path.join(scratch, "proyectos");
process.env.PLANIA_PROJECTS_ROOT = projectsRoot;
for (const k of ["PLANIA_EVENT_WAKES", "PLANIA_PASSWORD_HASH", "PLANIA_RUNNER_TOKEN", "PLANIA_HOME_PROJECT", "PLANIA_PROMPTS_PROJECT"]) delete process.env[k];

const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { issueSetupCode } = await import("../src/db/install.js");
const state = await import("../src/install-state.js");
const { setOpenProjectDeps, setPickFolderDeps } = await import("../src/api/company.js");
const { pickFolder } = await import("../src/runner/open-project.js");
const ui = await import("../ui/src/lib/nuevo-proyecto.js");
const gha = await import("../ui/src/lib/github-aviso.js");
const guiaUi = await import("../ui/src/lib/primera-entrega.js");
type GitResult = { code: number; stdout: string; stderr: string };
type Json = Record<string, any>;

let raw: pg.Client;
let closeDb: () => Promise<void>;
let cookie = "";
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

before(async () => {
  raw = await resetTestDb();
  ({ close: closeDb } = makeDb());
  state.resetInstallState();
  const envFile = path.join(scratch, ".env");
  writeFileSync(envFile, "");
  const code = await issueSetupCode(raw, envFile, () => "AGREGAR-AGREGAR");
  const res = await app.request(
    "http://localhost:3737/api/first-start",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Ana", password: "una contraseña larga", time_zone: "Europe/Madrid" }) },
    LOOPBACK,
  );
  assert.equal(res.status, 201, await res.clone().text());
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});
beforeEach(async () => {
  await raw.query(`delete from agents where project_id is not null and project_id in (select id from projects where slug in ('tienda', 'otra', 'zeep'))`);
  await raw.query(`delete from projects where slug in ('tienda', 'otra', 'zeep')`);
});
after(async () => {
  setOpenProjectDeps(null);
  setPickFolderDeps(null);
  state.resetInstallState();
  await closeDb?.();
  await raw?.end();
  rmSync(scratch, { recursive: true, force: true });
});

const add = async (body: unknown) => {
  const r = await app.request("http://localhost:3737/api/company/projects", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Json };
};
const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
const SHA = "a".repeat(40);

/** A repository as git and gh see it: whether the working branch is there, and every call made. */
function fakeRepo(opts: { hasBranch: boolean; dirs?: string[]; sshAnswer?: GitResult }) {
  const calls: string[] = [];
  let hasBranch = opts.hasBranch;
  const dirs = new Set(opts.dirs ?? []);
  const heads = () => ok(`${SHA}\trefs/heads/main\n${hasBranch ? `${SHA}\trefs/heads/sandbox\n` : ""}`);
  const git = async (args: string[]): Promise<GitResult> => {
    calls.push(`git ${args.join(" ")}`);
    const a = args.join(" ");
    if (a.includes("ls-remote --heads -- ")) return opts.sshAnswer ?? heads();
    if (a.includes(" clone -- ")) return (dirs.add(args.at(-1)!), ok());
    if (a === "rev-parse --is-inside-work-tree") return ok("true\n");
    if (a === "remote get-url origin") return ok("git@github.com:ana/tienda.git\n");
    if (a.startsWith("ls-remote --exit-code --heads origin")) return hasBranch ? ok(`${SHA}\trefs/heads/sandbox\n`) : { code: 2, stdout: "", stderr: "" };
    if (a === "ls-remote --symref origin HEAD") return ok(`ref: refs/heads/main\tHEAD\n${SHA}\tHEAD\n`);
    if (a === "ls-remote --heads origin") return ok(`${SHA}\trefs/heads/main\n`);
    if (a.startsWith("push")) return ((hasBranch = true), ok());
    return ok(SHA);
  };
  const gh = async (args: string[]): Promise<GitResult> => {
    calls.push(`gh ${args.join(" ")}`);
    const a = args.join(" ");
    if (a.startsWith("repo view ana/tienda --json viewerPermission")) return ok("WRITE\n");
    if (a.startsWith("repo view --json nameWithOwner")) return ok("ana/tienda\n");
    if (a.startsWith("api repos/ana/tienda/branches/")) return hasBranch ? ok("sandbox") : { code: 1, stdout: "", stderr: "HTTP 404: Branch not found" };
    if (a.startsWith("repo clone")) return (dirs.add(args[3]!), ok());
    return { code: 1, stdout: "", stderr: "HTTP 404: Not Found" };
  };
  setOpenProjectDeps({ check: { git, isDir: (p: string) => dirs.has(p), gh }, setup: { git, gh, fs: { list: (d: string) => (dirs.has(d) ? [".git"] : null), mkdir: () => {} } } });
  return { calls };
}

// ---- the sheet's rules and words

test("agregar: four ways in, in that order, in both languages; the gh notice only for Nube", () => {
  for (const lang of ["es", "en"] as const) assert.deepEqual(ui.codigoOpciones(lang).map((o) => o.key), ["carpeta", "github", "ssh", "ninguno"]);
  assert.deepEqual(ui.codigoOpciones("es").map((o) => o.label), ["Local", "Nube", "SSH", "Sin código"]);
  assert.deepEqual(["carpeta", "github", "ssh", "ninguno", null].map((o) => gha.pideGithub(o as never)), [false, true, false, false, false]);
  // The goal is asked only of a project with no code.
  assert.deepEqual(["carpeta", "github", "ssh", "ninguno"].map((o) => ui.metaObligatoria(o as never)), [false, false, false, true]);
});

test("agregar: the button reads «Agregar proyecto» on the guide and on Compañía", async () => {
  assert.equal(guiaUi.primeraEntregaWords("es").proyecto.boton, "Agregar proyecto");
  assert.equal(guiaUi.primeraEntregaWords("es").proyecto.titulo, "Agrega tu primer proyecto");
  assert.equal(guiaUi.primeraEntregaWords("en").proyecto.boton, "Add project");
  const { STREAM_WORDS } = await import("../ui/src/lib/stream-words.js");
  assert.equal(STREAM_WORDS.es.newProject, "+ Agregar proyecto");
  const { HOJAS_WORDS } = await import("../ui/src/lib/hojas-words.js");
  assert.equal(HOJAS_WORDS.es.newProject, "Agregar un proyecto");
});

test("agregar: GitHub repositories are read from owner/name, https and ssh; SSH URLs as git takes them", () => {
  for (const t of ["ana/tienda", "https://github.com/ana/tienda", "https://github.com/ana/tienda.git", "github.com/ana/tienda/", "git@github.com:ana/tienda.git", "ssh://git@github.com/ana/tienda"]) {
    assert.equal(ui.githubRepoDe(t), "ana/tienda", t);
  }
  for (const t of ["", "tienda", "https://gitlab.com/ana/tienda", "ana/tienda/extra", "-ana/tienda", "ana/.."]) assert.equal(ui.githubRepoDe(t), null, t);
  for (const t of ["git@github.com:rafaelMMGH/zeep.git", "git@gitlab.com:grupo/sub/app.git", "ssh://git@github.com/rafaelMMGH/zeep.git", "ssh://git@host.example:2222/srv/app.git/"]) assert.ok(ui.sshUrlDe(t), t);
  for (const t of ["", "github.com:ana/x", "https://github.com/ana/x", "-oProxyCommand=x@h:p", "git@-h:p", "git@h:-p", "git@h:../x", "git@h:a//b", "ssh://git@h/a/../b"]) assert.equal(ui.sshUrlDe(t), null, t);
});

test("agregar: the name follows the folder or the repository; each way sends its own body", () => {
  assert.equal(ui.nombreSugerido("carpeta", "/Users/ana/code/mi-tienda/"), "mi-tienda");
  assert.equal(ui.nombreSugerido("github", "https://github.com/rafaelMMGH/zeep.git"), "zeep");
  assert.equal(ui.nombreSugerido("ssh", "git@github.com:rafaelMMGH/zeep.git"), "zeep");
  assert.equal(ui.nombreSugerido("ninguno", "x"), "");
  assert.equal(ui.codigoBody(null, "/a", "o/r", "git@h:x"), null);
  assert.deepEqual(ui.codigoBody("ninguno", "", "", ""), { no_code: true });
  assert.deepEqual(ui.codigoBody("carpeta", " ~/code/tienda ", "", ""), { origen: "local", repo_path: "~/code/tienda" });
  assert.equal(ui.codigoBody("carpeta", "relativa/x", "", ""), null);
  assert.deepEqual(ui.codigoBody("github", "", "https://github.com/rafaelMMGH/zeep", ""), { origen: "nube", repo: "rafaelMMGH/zeep" });
  assert.equal(ui.codigoBody("github", "", "https://gitlab.com/a/b", ""), null);
  assert.deepEqual(ui.codigoBody("ssh", "", "", "git@github.com:rafaelMMGH/zeep.git"), { origen: "ssh", repo: "git@github.com:rafaelMMGH/zeep.git" });
  assert.equal(ui.codigoBody("ssh", "", "", "https://github.com/rafaelMMGH/zeep"), null);
});

test("agregar: refusals are plain words in both languages; the missing branch is offered, a stale server named", () => {
  for (const lang of ["es", "en"] as const) {
    const w = ui.agregarWords(lang);
    assert.equal(ui.agregarError("REPO_NO_START_BRANCH", { field: "github_repo" }, lang), w.sinRama);
    assert.equal(ui.agregarError("HTTP_404", {}, lang), w.servidorViejo);
    assert.equal(ui.agregarError("INVALID_BODY", { field: "repo" }, lang), w.repoMal);
    assert.equal(ui.agregarError("INVALID_BODY", { field: "repo", origen: "ssh" }, lang), w.sshMal);
    for (const code of ["REPO_SSH_DENIED", "REPO_SSH_HOST_UNKNOWN", "REPO_SSH_NOT_FOUND", "REPO_ORIGIN_UNREACHABLE"]) assert.equal(ui.agregarError(code, { field: "ssh" }, lang), w.ssh[code]);
    for (const code of ["REPO_FOLDER_NOT_EMPTY", "REPO_PUSH_FAILED", "REPO_GIT_FAILED"]) {
      const line = ui.agregarError(code, { field: "setup" }, lang);
      assert.ok(line && !line.includes(code), `${lang} ${code}: ${line}`);
    }
    // The folder checks point at «Sin código», which is in this sheet.
    assert.match(ui.agregarError("REPO_NOT_GIT", { field: "repo_path", path: "/x/tienda" }, lang), lang === "es" ? /«Sin código»/ : /«No code»/);
  }
});

// ---- the folder window on each system

test("agregar: the folder window answers the path, null on Cancel, and is unavailable where it cannot show", async () => {
  const seen: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const deps = (platform: NodeJS.Platform, answers: Record<string, GitResult>, env: NodeJS.ProcessEnv = {}) => ({
    platform,
    env,
    run: async (cmd: string, args: string[], e?: NodeJS.ProcessEnv) => (seen.push({ cmd, args, env: e }), answers[cmd] ?? { code: 127, stdout: "", stderr: "ENOENT" }),
  });
  // macOS: Finder.
  assert.deepEqual(await pickFolder("Elige", deps("darwin", { osascript: ok("/Users/ana/zeep/\n") })), { available: true, path: "/Users/ana/zeep" });
  assert.match(seen.at(-1)!.args[1]!, /choose folder with prompt "Elige"/);
  assert.deepEqual(await pickFolder("Elige", deps("darwin", { osascript: { code: 1, stdout: "", stderr: "User canceled. (-128)" } })), { available: true, path: null });
  assert.deepEqual(await pickFolder("Elige", deps("darwin", { osascript: { code: 1, stdout: "", stderr: "No user interaction allowed. (-1713)" } })), { available: false, path: null });
  // Quotes in the title cannot end AppleScript's string.
  await pickFolder('a "b" \\c', deps("darwin", { osascript: ok("/x") }));
  assert.ok(seen.at(-1)!.args[1]!.includes('"a \\"b\\" \\\\c"'));
  // Windows: the folder window through PowerShell; the title comes in through the environment, not the script.
  assert.deepEqual(await pickFolder("Elige; rm -rf", deps("win32", { "powershell.exe": ok("C:\\Users\\ana\\zeep\\\r\n") })), { available: true, path: "C:\\Users\\ana\\zeep" });
  assert.equal(seen.at(-1)!.env?.PLANIA_PICK_TITLE, "Elige; rm -rf");
  assert.ok(!seen.at(-1)!.args.join(" ").includes("rm -rf"));
  assert.ok(seen.at(-1)!.args.includes("-STA"));
  assert.deepEqual(await pickFolder("Elige", deps("win32", { "powershell.exe": ok("") })), { available: true, path: null });
  assert.deepEqual(await pickFolder("Elige", deps("win32", { "powershell.exe": ok("D:\\") })), { available: true, path: "D:\\" });
  assert.deepEqual(await pickFolder("Elige", deps("win32", {})), { available: false, path: null });
  // Linux: zenity, then kdialog; none, or no screen, is unavailable.
  const screen = { DISPLAY: ":0", HOME: "/home/ana" };
  assert.deepEqual(await pickFolder("Elige", deps("linux", { zenity: ok("/home/ana/zeep\n") }, screen)), { available: true, path: "/home/ana/zeep" });
  assert.deepEqual(await pickFolder("Elige", deps("linux", { zenity: { code: 1, stdout: "", stderr: "" } }, screen)), { available: true, path: null });
  assert.deepEqual(await pickFolder("Elige", deps("linux", { kdialog: ok("/home/ana/zeep\n") }, screen)), { available: true, path: "/home/ana/zeep" });
  assert.deepEqual(seen.at(-1)!.args, ["--getexistingdirectory", "/home/ana", "--title", "Elige"]);
  assert.deepEqual(await pickFolder("Elige", deps("linux", {}, screen)), { available: false, path: null });
  const before = seen.length;
  assert.deepEqual(await pickFolder("Elige", deps("linux", { zenity: ok("/x") }, {})), { available: false, path: null });
  assert.equal(seen.length, before, "no screen: nothing is run");
});

test("agregar: only a browser on this machine may open the folder window", async () => {
  let opened = 0;
  setPickFolderDeps({ platform: "darwin", env: {}, run: async () => (opened++, ok("/Users/ana/tienda\n")) });
  const ask = async (url: string, env: unknown, headers: Record<string, string> = {}) =>
    (await app.request(url, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", ...headers }, body: "{}" }, env as never)).json();
  assert.deepEqual(await ask("http://localhost:3737/api/company/carpeta", LOOPBACK), { available: true, path: "/Users/ana/tienda" });
  // The phone through tailscale serve connects from loopback too; the proxy's headers give it away.
  assert.deepEqual(await ask("http://localhost:3737/api/company/carpeta", LOOPBACK, { "X-Forwarded-For": "100.64.0.2" }), { available: false, path: null });
  assert.deepEqual(await ask("http://plania.tail.ts.net/api/company/carpeta", { incoming: { socket: { remoteAddress: "100.64.0.2" } } }), { available: false, path: null });
  assert.equal(opened, 1);
  setPickFolderDeps(null);
});

// ---- the route, each way in

test("agregar local: a ready folder becomes a paused project with its team, its GitHub repository read from origin, no goal needed", async () => {
  const folder = path.join(scratch, "tienda");
  const { calls } = fakeRepo({ hasBranch: true, dirs: [folder] });
  const { status, json } = await add({ origen: "local", name: "Tienda", repo_path: folder });
  assert.equal(status, 201, JSON.stringify(json));
  assert.deepEqual([json.slug, json.paused], ["tienda", true]);
  const [p] = (await raw.query(`select settings from projects where slug = 'tienda'`)).rows;
  assert.deepEqual([p.settings.local.repo_path, p.settings.github.repo, p.settings.plan_approval], [folder, "ana/tienda", true]);
  assert.ok(!calls.some((c) => c.startsWith("git push")), "nothing pushed");
});

test("agregar local: a folder that is not ready is refused with the sheet's code; no working branch asks first", async () => {
  const folder = path.join(scratch, "tienda");
  fakeRepo({ hasBranch: true });
  const missing = await add({ origen: "local", name: "Tienda", repo_path: path.join(scratch, "no-existe") });
  assert.deepEqual([missing.status, missing.json.error], [400, "REPO_FOLDER_MISSING"]);
  const { calls } = fakeRepo({ hasBranch: false, dirs: [folder] });
  const first = await add({ origen: "local", name: "Tienda", repo_path: folder });
  assert.deepEqual([first.status, first.json.error], [400, "REPO_NO_START_BRANCH"]);
  assert.ok(!calls.some((c) => c.startsWith("git push")), "no push before the owner says so");
  const second = await add({ origen: "local", name: "Tienda", repo_path: folder, crear_rama: true });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.ok(calls.includes(`git push origin ${SHA}:refs/heads/sandbox`), calls.join("\n"));
});

test("agregar nube: cloned with gh into the projects folder; no branch asks first; a bad spelling or a taken name stops early", async () => {
  const noBranch = fakeRepo({ hasBranch: false });
  const r1 = await add({ origen: "nube", name: "Tienda", repo: "https://github.com/ana/tienda.git" });
  assert.deepEqual([r1.status, r1.json.error], [400, "REPO_NO_START_BRANCH"]);
  assert.ok(!noBranch.calls.some((c) => c.startsWith("gh repo clone")), "nothing cloned before the owner says so");
  const r2 = await add({ origen: "nube", name: "Tienda", repo: "https://github.com/ana/tienda.git", crear_rama: true });
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  const dest = path.join(projectsRoot, "tienda");
  assert.ok(noBranch.calls.includes(`gh repo clone ana/tienda ${dest}`), noBranch.calls.join("\n"));
  const [p] = (await raw.query(`select settings from projects where slug = 'tienda'`)).rows;
  assert.deepEqual([p.settings.local.repo_path, p.settings.github.repo], [dest, "ana/tienda"]);

  const again = fakeRepo({ hasBranch: true });
  const taken = await add({ origen: "nube", name: "Tienda", repo: "ana/tienda", crear_rama: true });
  assert.deepEqual([taken.status, taken.json.error], [409, "PROJECT_EXISTS"]);
  assert.deepEqual(again.calls, [], "a taken name touches no repository");
  const gitlab = await add({ origen: "nube", name: "Otra", repo: "https://gitlab.com/ana/otra" });
  assert.deepEqual([gitlab.status, gitlab.json.error, gitlab.json.field], [400, "INVALID_BODY", "repo"]);
  const unknown = await add({ origen: "nube", name: "Otra", repo: "ana/otra" });
  assert.deepEqual([unknown.status, unknown.json.error], [400, "REPO_GITHUB_NOT_FOUND"]);
  const extra = await add({ origen: "nube", name: "Otra", repo: "ana/otra", extra: 1 });
  assert.deepEqual([extra.status, extra.json.error], [400, "INVALID_BODY"]);
});

test("agregar ssh: git reads and clones in batch mode with the owner's keys; each SSH failure says which", async () => {
  const { calls } = fakeRepo({ hasBranch: true });
  const r = await add({ origen: "ssh", name: "zeep", repo: "git@github.com:ana/tienda.git" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const dest = path.join(projectsRoot, "zeep");
  assert.ok(calls.includes("git -c core.sshCommand=ssh -o BatchMode=yes ls-remote --heads -- git@github.com:ana/tienda.git"), calls.join("\n"));
  assert.ok(calls.includes(`git -c core.sshCommand=ssh -o BatchMode=yes clone -- git@github.com:ana/tienda.git ${dest}`), calls.join("\n"));
  assert.ok(!calls.some((c) => c.startsWith("gh repo clone") || c.startsWith("git push")), "no gh clone, no push");

  const noBranch = fakeRepo({ hasBranch: false });
  const r1 = await add({ origen: "ssh", name: "Otra", repo: "git@github.com:ana/otra.git" });
  assert.deepEqual([r1.status, r1.json.error, r1.json.field], [400, "REPO_NO_START_BRANCH", "ssh"]);
  assert.ok(!noBranch.calls.some((c) => c.includes(" clone ")), "nothing cloned before the owner says so");
  const cases: Array<[string, string]> = [
    ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "REPO_SSH_DENIED"],
    ["Host key verification failed.\nfatal: Could not read from remote repository.", "REPO_SSH_HOST_UNKNOWN"],
    ["ERROR: Repository not found.\nfatal: Could not read from remote repository.", "REPO_SSH_NOT_FOUND"],
    ["ssh: Could not resolve hostname nohost: nodename nor servname provided", "REPO_ORIGIN_UNREACHABLE"],
  ];
  for (const [stderr, code] of cases) {
    fakeRepo({ hasBranch: true, sshAnswer: { code: 128, stdout: "", stderr } });
    const f = await add({ origen: "ssh", name: "Otra", repo: "git@github.com:ana/otra.git", crear_rama: true });
    assert.deepEqual([f.status, f.json.error], [400, code], stderr);
  }
  const bad = await add({ origen: "ssh", name: "Otra", repo: "-oProxyCommand=evil@h:x" });
  assert.deepEqual([bad.status, bad.json.error, bad.json.field, bad.json.origen], [400, "INVALID_BODY", "repo", "ssh"]);
});

test("agregar: the old body (repo_path, github_repo, no_code) still makes projects as before", async () => {
  const r = await add({ name: "Otra", goal: "Algo pequeño.", no_code: true });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const noGoal = await add({ name: "Zeep", no_code: true });
  assert.deepEqual([noGoal.status, noGoal.json.error], [400, "INVALID_BODY"], "with no code the goal is still asked");
});

// ---- the sheet after adding: three short sections instead of one long list

test("agregar: the added project reads in sections, Resumen first; Falta only when something is missing", async () => {
  const listo = await import("../ui/src/lib/listo.js");
  const item = (id: string, state: "ready" | "missing" | "not_needed", blocks = false) => ({ id, state, blocks });
  const r = (items: ReturnType<typeof item>[]) => ({ slug: "zeep", title: "zeep", items, blocking: items.filter((i) => i.blocks && i.state === "missing").length, tasks: 0 });
  // The owner's screenshot: five things missing, none stopping a start, eight ready.
  const zeep = r([
    ...["capture", "verify", "context.glossary", "context.commands", "context.map"].map((id) => item(id, "missing")),
    ...["prompt:artist", "prompt:po", "prompt:research", "prompt:taller", "runner_token", "claude_bin", "code", "github"].map((id) => item(id, "ready")),
  ]);
  assert.deepEqual(listo.listoSecciones(zeep), { falta: 5, para: 0, listo: 8, secciones: ["resumen", "falta", "listo"] });
  const lleno = r([item("code", "ready"), item("github", "not_needed")]);
  assert.deepEqual(listo.listoSecciones(lleno), { falta: 0, para: 0, listo: 2, secciones: ["resumen", "listo"] });
  assert.equal(listo.listoSecciones(r([item("code", "missing", true), item("github", "missing")])).para, 1);
  for (const lang of ["es", "en"] as const) {
    const w = listo.listoSeccionWords(lang);
    assert.ok(w.resumenFalta(5).includes("5") && w.resumenListo(8).includes("8") && w.resumenFalta(1) !== w.resumenFalta(2));
    assert.ok(w.secciones.resumen && w.secciones.falta && w.secciones.listo && w.verFalta && w.verListo && w.resumenNada && w.resumenNoPara);
  }
  // The creation sheet uses the sections; the long list stays only where it was (Reanudar, the project page).
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("../ui/src/components/corriente/hojas.tsx", import.meta.url), "utf8");
  const nuevo = sheet.slice(sheet.indexOf("export const NuevoProyecto"), sheet.indexOf("export const Pausar"));
  assert.match(nuevo, /<ListoSecciones r=\{listo\.data\}/);
  assert.doesNotMatch(nuevo, /<ListoLista/);
});

test("agregar, PLA-132: in the sections a missing item links where it is fixed, and the summary names those places", async () => {
  const listo = await import("../ui/src/lib/listo.js");
  const item = (id: string, state: "ready" | "missing" | "not_needed") => ({ id, state, blocks: false });
  // The code's folder and repository moved to Despliegue; the rest stays in Ajustes.
  assert.deepEqual(listo.listoLugares([item("verify", "missing"), item("context.map", "missing")]), ["ajustes"]);
  assert.deepEqual(listo.listoLugares([item("code", "missing"), item("github", "missing")]), ["camino"]);
  assert.deepEqual(listo.listoLugares([item("github", "missing"), item("capture", "missing"), item("code", "ready")]), ["ajustes", "camino"]);
  assert.deepEqual(listo.listoLugares([item("prompt:po", "missing"), item("verify", "ready")]), [], "no control on the screen, no place");
  const es = listo.listoSeccionWords("es");
  assert.equal(es.resumenNoPara(listo.listoDonde([item("verify", "missing")], "es")), "Ninguna impide empezar: puedes arreglarlas después, desde Ajustes.");
  assert.equal(es.resumenNoPara(listo.listoDonde([item("code", "missing")], "es")), "Ninguna impide empezar: puedes arreglarlas después, desde Despliegue.");
  assert.equal(es.resumenNoPara(listo.listoDonde([item("code", "missing"), item("verify", "missing")], "es")), "Ninguna impide empezar: puedes arreglarlas después, desde Ajustes o Despliegue.");
  assert.equal(es.resumenNoPara(listo.listoDonde([item("prompt:po", "missing")], "es")), "Ninguna impide empezar.");
  assert.equal(listo.listoDonde([item("code", "missing"), item("verify", "missing")], "en"), "Settings or Deploy");
  // The sections route every link the way ListoLista does: listoIrA and its href, never a hand-built #ajustes link.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../ui/src/components/listo.tsx", import.meta.url), "utf8");
  const secciones = src.slice(src.indexOf("export const ListoSecciones"));
  assert.match(secciones, /<Link to=\{irHref\(r\.slug, listoIrA\(l\.id\)!\)\}/);
  assert.match(secciones, /w\.resumenNoPara\(listoDonde\(r\.items\)\)/);
  assert.doesNotMatch(src, /listoAjuste|#ajustes-\$\{listoAjuste/);
});
