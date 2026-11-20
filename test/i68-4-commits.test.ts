// PLA-I68-4: commits and PRs agents follow. The history classifier and its proposal, the preview and the agents'
// instructions moving with each setting, the lint rules, the hook a builder's run carries (a throwaway git repo in a
// temp folder: a bad commit or PR title is stopped before push with the reason, a forbidden AI trailer never leaves),
// the runner's hooks and context, and the CI option: the only write to the product repo, by PR, with a fake GitHub.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";
import { needs } from "./platform.js";

useTestEnv();
const TMP = mkdtempSync(path.join(tmpdir(), "plania-i68-4-"));
const { makeDb } = await import("../src/db/client.js");
const { setProject } = await import("../src/mcp/project.js");
const { findProject } = await import("../src/mcp/queries.js");
const keys = await import("../src/camino/keys.js");
const { caminoDeps } = await import("../src/camino/store.js");
const { applyChanges, ChangeSchema } = await import("../src/camino/changes.js");
const { commitHooks, commitInstructions, HOOK_SCRIPT } = await import("../src/camino/commits.js");
const { DEFAULT_COMMITS } = await import("../src/camino/config.js");
const C = (await import(new URL("../ui/src/lib/camino-commits.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-commits.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const ctx = { actor: { agent: "t", session_id: "s-i68-4", machine: "ci" } };
const REPO = "acme/zigzag";
const S = (over: Partial<typeof DEFAULT_COMMITS> = {}) => ({ ...DEFAULT_COMMITS, convention: "conventional" as const, ...over });

let calls: { method: string; path: string; body: any }[] = [];
const ok = (data: unknown, status = 200) => ({ status, headers: { get: () => null }, json: async () => data });
const fakeFetch = async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? "GET";
  const p = url.replace("https://api.github.com", "");
  calls.push({ method, path: p, body: init?.body ? JSON.parse(init.body) : null });
  if (p.startsWith(`/repos/${REPO}/git/ref/heads/`)) return ok({ object: { sha: "a".repeat(40) } });
  if (p === `/repos/${REPO}/git/refs`) return ok({}, 201);
  if (p.startsWith(`/repos/${REPO}/contents/`) && method === "GET") return ok({ message: "Not Found" }, 404);
  if (p.startsWith(`/repos/${REPO}/contents/`) && method === "PUT") return ok({}, 201);
  if (p === `/repos/${REPO}/pulls`) return ok({ number: 812, html_url: `https://github.com/${REPO}/pull/812` }, 201);
  return ok({ message: "Not Found" }, 404);
};

before(async () => {
  raw = await resetTestDb();
  const made = makeDb();
  db = made.db;
  closeDb = made.close;
  keys.useCaminoKeyStore(new keys.MemoryCaminoKeyStore());
  Object.assign(caminoDeps, { fetch: fakeFetch, env: { ...process.env, GITHUB_TOKEN: "ghp_test" }, now: () => new Date("2026-11-20T08:00:00Z"), listDatabases: async () => [] });
  const p = await findProject(db, "zigzag");
  await setProject(db, { project: "zigzag", version: p.version, settings: { github: { repo: REPO } } }, ctx);
});
after(async () => {
  keys.useCaminoKeyStore(null);
  await closeDb?.();
  await raw?.end();
  rmSync(TMP, { recursive: true, force: true });
});

describe("the project's real style", () => {
  test("each commit's style by its first line", () => {
    const cases: [string, string][] = [
      ["feat(citas): add the calendar", "conventional"],
      ["fix!: drop the old route", "conventional"],
      ["ZIG-38: show the services count", "ticket"],
      ["Pago: recibo por correo (TIE-41)", "area"],
      ["✨ new home", "gitmoji"],
      [":bug: fix crash", "gitmoji"],
      ["Add the calendar", "classic"],
      ["arreglos varios.", "plain"],
    ];
    for (const [m, k] of cases) assert.equal(C.classify(m), k, m);
  });

  test("the mix, the last 50, language, median, AI trailers; the dominant style is proposed at 60 % or more", () => {
    const msgs = [...Array(70).fill("feat: add x"), ...Array(30).fill("ZIG-1: el cambio de la agenda"), "fix: y\n\nCo-Authored-By: Claude <noreply@anthropic.com>"];
    const mix = C.historyMix(msgs);
    assert.equal(mix.n, 101);
    assert.equal(mix.share.conventional, 70);
    assert.equal(mix.share.ticket, 30);
    assert.equal(mix.dominant, "conventional");
    assert.equal(mix.propose, "conventional");
    assert.equal(mix.ai, 1);
    assert.equal(mix.lang, "en");
    const split = C.historyMix([...Array(5).fill("feat: a"), ...Array(5).fill("ZIG-2: b")]);
    assert.equal(split.propose, null, "50/50 proposes nothing");
    assert.equal(C.historyMix(Array(10).fill("arreglé la página de la agenda")).lang, "es");
  });

  test("the sample comes from the project's own last subject", () => {
    const s = C.sampleOf(["feat(agenda): Mueve la cita sin recargar", "fix: x"], ["app", "lib"], "ZIG-9");
    assert.deepEqual([s.desc, s.scope, s.key], ["mueve la cita sin recargar", "app", "ZIG-9"]);
    assert.equal(C.sampleOf(["ZIG-38: show the count (ZIG-38)"], [], "X-1").key, "ZIG-38");
  });
});

describe("the preview and the agents' instructions follow every setting", () => {
  const s = { area: "Agenda", scope: "agenda", key: "ZIG-9", desc: "move the appointment", body: "" };
  test("preview", () => {
    assert.equal(C.preview("conventional", S({ body: false, ticket: "no" }), s, "es"), "feat(agenda): move the appointment");
    assert.equal(C.preview("conventional", S({ scope: "no", body: false, ticket: "prefijo" }), s, "es"), "ZIG-9: feat: move the appointment");
    assert.equal(C.preview("conventional", S({ ticket: "trailer", body: false }), s, "es"), "feat(agenda): move the appointment\n\nRefs: ZIG-9");
    assert.match(C.preview("conventional", S({ ticket: "no" }), s, "es"), /\n\nAntes no pasaba esto/);
    assert.equal(C.preview("ticket", S({ ticket: "trailer", body: false }), s, "es"), "ZIG-9: move the appointment\n\nRefs: ZIG-9");
    assert.equal(C.preview("gitmoji", S({ emoji: true, ticket: "no", body: false }), s, "es"), ":sparkles: move the appointment");
    assert.equal(C.preview("classic", S({ ticket: "final", body: false }), s, "es"), "Move the appointment (ZIG-9)");
  });

  test("instructions", () => {
    const a = C.instructions(S({ types: ["feat", "fix"], lang: "es", examples: "feat(x): bien\n✗ cambios" }), ["app", "lib"], "es");
    assert.match(a, /^Escribe cada commit con el formato tipo\(alcance\): descripción\./);
    assert.match(a, /Tipos permitidos, en inglés: feat, fix\. Alcance opcional, de estas carpetas: app, lib\./);
    assert.match(a, /La descripción en español/);
    assert.match(a, /No agregues líneas de coautor ni de asistencia de IA/);
    assert.match(a, /Ejemplos buenos:\n {2}feat\(x\): bien\nEjemplos malos:\n {2}cambios/);
    const b = C.instructions(S({ ai: true, lang: "en", ticket: "prefijo" }), [], "es");
    assert.match(b, /Agrega «Assisted-by: <agente>» al final\./);
    assert.match(b, /Empieza con la clave del ticket/);
    assert.notEqual(a, b);
  });
});

describe("lint", () => {
  test("conventional: format, length, period, vague, body on feat/fix, Refs trailer, AI trailer, emoji", () => {
    const rules = C.lintRules(S({ max: 50, types: ["feat", "fix", "chore"] }), "es");
    assert.deepEqual(C.lint("feat(agenda): move the appointment\n\nIt jumped before.\n\nRefs: ZIG-9", rules), []);
    const bad = C.lint("Update files.", rules);
    assert.ok(bad.some((x) => x.startsWith("La primera línea no sigue el formato")));
    assert.ok(bad.some((x) => x.includes("termina en punto")));
    assert.ok(C.lint("docs: a\n\nRefs: ZIG-1", rules).some((x) => x.startsWith("La primera línea no sigue")), "docs is not an allowed type here");
    assert.ok(C.lint("feat: a\n\nRefs: ZIG-1", rules).some((x) => x.includes("porqué")));
    assert.ok(C.lint("chore: a", rules).some((x) => x.includes("Refs: CLAVE")));
    assert.ok(C.lint(`chore: ${"x".repeat(60)}\n\nRefs: ZIG-1`, rules).some((x) => x.includes("50 caracteres")));
    assert.ok(C.lint("chore: a ✨\n\nRefs: ZIG-1", rules).some((x) => x.includes("emoji")));
    assert.ok(C.lint("chore: a\n\nRefs: ZIG-1\nCo-Authored-By: Claude Opus <noreply@anthropic.com>", rules).some((x) => x.includes("coautor")));
    assert.deepEqual(C.lint("chore: a\n\nRefs: ZIG-1\nCo-authored-by: Ana <ana@example.com>", rules), [], "a person's co-author is fine");
  });

  test("ticket first and a PR title", () => {
    const rules = C.lintRules(S({ convention: "ticket", ticket: "no", body: false }), "es");
    assert.deepEqual(C.lint("ZIG-38: show the count", rules), []);
    assert.ok(C.lint("show the count", rules).length);
    assert.deepEqual(C.lint("ZIG-38: show the count", rules, "title"), []);
    assert.ok(C.lint("Show the count", rules, "title")[0]!.startsWith("El título de la propuesta no sigue"));
  });

  test("stripAi keeps everything but the AI line", () => {
    assert.equal(C.stripAi("feat: a\n\nwhy\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"), "feat: a\n\nwhy");
  });
});

describe("the hook a builder's run carries", () => {
  const repo = path.join(TMP, "repo");
  const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  const rulesFile = path.join(TMP, "rules.json");
  const hook = (command: string, event = "PreToolUse") => spawnSync(process.execPath, [HOOK_SCRIPT, rulesFile], { input: JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command }, cwd: repo }), encoding: "utf8" });
  before(() => {
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    g("commit", "-q", "--allow-empty", "-m", "chore: start\n\nRefs: ZIG-1");
    g("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(rulesFile, JSON.stringify({ base: "main", rules: C.lintRules(S({ body: false }), "en"), on_commit: true }));
  });

  test("a good commit pushes; anything that is not a push or a PR passes", () => {
    g("commit", "-q", "--allow-empty", "-m", "feat(app): add the calendar\n\nRefs: ZIG-2");
    assert.equal(hook("git push origin jl/zig-2").status, 0);
    assert.equal(hook("ls -la").status, 0);
  });

  test("a bad commit and a forbidden AI trailer stop the push with the reason and how to rewrite", () => {
    g("commit", "-q", "--allow-empty", "-m", "update files\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    const out = hook("git -C /w push origin jl/zig-2");
    assert.equal(out.status, 2);
    assert.match(out.stderr, /«update files»: The first line does not follow/);
    assert.match(out.stderr, /AI co-author/);
    assert.match(out.stderr, /git reset --soft origin\/main/);
    g("reset", "-q", "--hard", "HEAD~1");
  });

  test("a PR title that breaks the format stops gh pr create; a good one passes", () => {
    assert.equal(hook(`gh pr create --title "Add the calendar" --body x`).status, 2);
    assert.equal(hook(`gh pr create --title "feat(app): add the calendar" --body "x y"`).status, 0);
  });

  test("on each commit, when the owner asked: the commit just made is checked after it is made", () => {
    g("commit", "-q", "--allow-empty", "-m", "wip");
    const out = hook(`git commit -m "wip"`, "PostToolUse");
    assert.equal(out.status, 2);
    assert.match(out.stderr, /«wip»/);
  });
});

describe("the runner and the CI option", () => {
  test("no hook and no instructions until the owner chooses; then both, and «instr» checks only the AI rule", async () => {
    const p = await findProject(db, "zigzag");
    assert.equal(await commitHooks(db, p, TMP, "sandbox"), null);
    assert.equal(await commitInstructions(db, p), null);
    await raw.query(`insert into camino (project_id, config) values ($1, $2) on conflict (project_id) do update set config = excluded.config`, [p.id, JSON.stringify({ commits: { convention: "conventional", enforce: "revisa" } })]);
    const h = (await commitHooks(db, p, TMP, "sandbox"))!;
    assert.equal(h.PreToolUse![0]!.matcher, "Bash");
    assert.ok(h.PreToolUse![0]!.hooks[0]!.command.includes("camino-commit-hook.mjs"));
    assert.equal(h.PostToolUse, undefined);
    const written = JSON.parse(readFileSync(path.join(TMP, "commit-rules.json"), "utf8")) as Json;
    assert.equal(written.base, "sandbox");
    assert.ok(written.rules.some((r: Json) => r.id === "format"));
    assert.match((await commitInstructions(db, p))!, /^## Commits\n\nEscribe cada commit con el formato tipo\(alcance\)/);
    await raw.query(`update camino set config = $2 where project_id = $1`, [p.id, JSON.stringify({ commits: { convention: "conventional", enforce: "instr" } })]);
    await commitHooks(db, p, TMP, "sandbox");
    assert.deepEqual((JSON.parse(readFileSync(path.join(TMP, "commit-rules.json"), "utf8")) as Json).rules.map((r: Json) => r.id), ["ai", "signed"]);
    await raw.query(`update camino set config = $2 where project_id = $1`, [p.id, JSON.stringify({ commits: { convention: "conventional", enforce: "hook" } })]);
    assert.ok((await commitHooks(db, p, TMP, "sandbox"))!.PostToolUse);
  });

  test("the PR-title workflow: no permissions, no action, and its pattern works under grep -E", { skip: needs({ posix: true }) }, () => {
    const yml = C.prTitleWorkflow("conventional", S({ types: ["feat", "fix"], scope: "opcional", ticket: "no" }), "en")!;
    assert.match(yml, /^permissions: \{\}$/m);
    assert.doesNotMatch(yml, /uses:/);
    const ere = yml.match(/grep -Eq '(.+)'; then/)![1]!;
    const grep = (title: string) => spawnSync("grep", ["-Eq", ere], { input: title }).status;
    assert.equal(grep("feat(app): add the calendar"), 0);
    assert.equal(grep("fix: keep the clock"), 0);
    assert.equal(grep("docs: readme"), 1);
    assert.equal(grep("Add the calendar"), 1);
  });

  test("the CI option is the only write to the repo, and only as a PR under .github/ from a new branch", async () => {
    const p = await findProject(db, "zigzag");
    const v = Number((await raw.query(`select version from camino where project_id = $1`, [p.id])).rows[0].version);
    const content = C.prTitleWorkflow("conventional", S())!;
    calls = [];
    const out = await applyChanges(db, "zigzag", { version: v, changes: [{ kind: "file_pr", label: "Prueba del título", path: ".github/workflows/pr-title.yml", content, base: "sandbox", title: "ci: check PR titles", body: "Proposed from Plania." }] });
    assert.equal(out.applied, 1, JSON.stringify(out.stopped));
    assert.deepEqual(out.results[0]!.pr, { number: 812, url: `https://github.com/${REPO}/pull/812` });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`), [
      `GET /repos/${REPO}/git/ref/heads/sandbox`,
      `POST /repos/${REPO}/git/refs`,
      `GET /repos/${REPO}/contents/.github/workflows/pr-title.yml`,
      `PUT /repos/${REPO}/contents/.github/workflows/pr-title.yml`,
      `POST /repos/${REPO}/pulls`,
    ]);
    assert.match(calls[1]!.body.ref, /^refs\/heads\/camino\/workflows-pr-title-yml-/);
    assert.equal(Buffer.from(calls[3]!.body.content, "base64").toString("utf8"), content);
    assert.equal(calls[3]!.body.branch, calls[1]!.body.ref.replace("refs/heads/", ""));
    assert.equal(calls[4]!.body.base, "sandbox");
    const h = (await raw.query(`select undo, detail from camino_history where project_id = $1 order by at desc limit 1`, [p.id])).rows[0];
    assert.equal(h.undo, "Cerrar la propuesta #812 sin fusionarla");
    for (const bad of ["src/index.ts", ".github/../src/x", "README.md", ".plania/x"]) assert.equal(ChangeSchema.safeParse({ kind: "file_pr", label: "x", path: bad, content: "", base: "main", title: "t", body: "" }).success, false, bad);
  });
});
