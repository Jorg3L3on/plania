// PLA-I70: the pure logic behind the audit fixes, tested without a browser or a database.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const cam = (await import(new URL("../ui/src/lib/camino.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino.js");
const ent = (await import(new URL("../ui/src/lib/camino-entornos.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-entornos.js");
const ci = (await import(new URL("../ui/src/lib/camino-ci.ts", import.meta.url).href)) as typeof import("../ui/src/lib/camino-ci.js");
const { discoverMac } = await import("../src/camino/mac.js");

const TMP = mkdtempSync(path.join(tmpdir(), "plania-i70-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

test("P6: the home folder reads as ~, never /Users/name", () => {
  assert.equal(cam.tidyPath("/Users/ana/Developer/app"), "~/Developer/app");
  assert.equal(cam.tidyPath("/home/ana/app"), "~/app");
  assert.equal(cam.tidyPath("/srv/app"), "/srv/app");
});

test("P14: one rule matcher for ~DEFAULT_BRANCH and ~ALL", () => {
  assert.ok(cam.ruleCovers(["~DEFAULT_BRANCH"], "main", "main"));
  assert.ok(!cam.ruleCovers(["~DEFAULT_BRANCH"], "dev", "main"));
  assert.ok(cam.ruleCovers(["~ALL"], "anything", "main"));
  assert.ok(cam.ruleCovers(["main"], "main", "trunk"));
});

test("I21: the branch Camino opens for a file is recognised, and only while open", () => {
  const pre = cam.proposalBranchPrefix(".github/workflows/ci.yml");
  assert.equal(pre, "camino/workflows-ci-yml-");
  const r = { proposals: [{ number: 7, state: "open", head_branch: `${pre}abc`, url: "u" }, { number: 5, state: "closed", head_branch: `${pre}old`, url: "u" }] } as never;
  assert.equal(cam.openProposalFor(r, ".github/workflows/ci.yml")?.number, 7);
  assert.equal(cam.openProposalFor(r, ".github/workflows/other.yml"), null);
});

test("I9: the review says each changed environment field in plain words", () => {
  const e = ent.newEnv([], "produccion", "Producción", "main");
  const next = { ...e, database: { ...e.database!, sql_review: false, backup: "ninguna" as const }, freeze: true };
  const lines = ent.envChanges([e], [next], "es");
  assert.deepEqual(lines, [
    "Producción: la revisión del SQL pasa de sí a no",
    "Producción: la copia antes de migrar pasa de La del servicio (rama o punto en el tiempo) a Ninguna",
    "Producción: no publicar viernes tarde pasa de no a sí",
  ]);
  assert.ok(lines.every((l) => !/vercel|neon|paso →|build/i.test(l)));
  assert.deepEqual(ent.envChanges([e], [e], "es"), []);
});

test("P16: a paused step carries a comment saying why, and resuming removes it", () => {
  const t = "jobs:\n  a:\n    steps:\n      - run: echo 1\n      - run: echo 2\n";
  const paused = ci.edits.stepPause(t, "a", 1);
  assert.match(paused, /# Paused from Plania \(Camino\)/);
  assert.equal(ci.edits.stepPause(paused, "a", 1), t);
});

test("I19: pinning a template's actions leaves none unpinned", () => {
  const text = ci.newWorkflow(["test", "build"], "pnpm", ["main"]);
  const uses = [...text.matchAll(/uses: ([^\s@]+@[^\s]+)/g)].map((m) => m[1]!);
  assert.ok(uses.length >= 2);
  const sha = "a".repeat(40);
  const pinned = ci.edits.pin(text, Object.fromEntries(uses.map((u) => [u, sha])));
  const wf = ci.readWorkflow(".github/workflows/ci.yml", pinned);
  assert.ok(wf.actions.every((a) => a.pinned), JSON.stringify(wf.actions));
  assert.ok(!ci.warnings(wf, { required: [], publicRepo: false, quietDays: 0 }, "es").some((x) => x.id === "unpinned"));
});

test("I20: a folder that is a clone of another repo feeds nothing", async () => {
  const root = path.join(TMP, "projects");
  const other = path.join(root, "other");
  mkdirSync(path.join(other, ".git"), { recursive: true });
  writeFileSync(path.join(other, ".git", "config"), `[remote "origin"]\n\turl = git@github.com:acme/other.git\n`);
  writeFileSync(path.join(other, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
  writeFileSync(path.join(other, ".env.example"), "SECRET=\n");
  const d = await discoverMac(other, "acme/mine", { listDatabases: async () => [], projectsRoot: root });
  assert.equal(d.folder?.matches, false);
  assert.equal(d.scripts, null);
  assert.equal(d.env_example, null);
  assert.equal(d.pm, null);
  assert.equal(d.migrations, null);
  const same = await discoverMac(other, "acme/other", { listDatabases: async () => [], projectsRoot: root });
  assert.deepEqual(same.scripts, ["test"]);
});

test("P12/P3: with no GitHub read the strip says «sin leer» in grey", () => {
  const r = { slug: "x", title: "X", config: { model: "trunk", branches: { published: "main", integration: null, work_pattern: "p" }, required_checks: {}, envs: [], rules: {}, commits: {}, connections: {} }, settings: { repo: "a/b" }, discovery: null, plania: { envs: [] }, proposals: [], history: [] } as never;
  const nodes = cam.strip(r, [], "es");
  const tests = nodes.find((n) => n.go === "ci")!;
  assert.equal(tests.dot, "off");
  assert.equal(tests.sub, "sin leer");
});

test("B3: the pill is never green when GitHub could not be read", () => {
  const F = [{ id: "network", sev: "warn", sec: "resumen", title: "", detail: "", fix: null }] as never;
  const ready = cam.readyLine(F, "es");
  assert.equal(ready.text, "No se pudo comprobar");
  assert.notEqual(ready.dot, "ok");
});

test("I14: a Manual service's commands and checklist are stored on the environment and said in the review", () => {
  const e = { ...ent.newEnv([], "produccion", "Producción", "main"), server: { provider: "own_server" as const, project: null, note: null } };
  const next = { ...e, server: { ...e.server, manual: { deploy: "ssh srv ./deploy.sh", rollback: "ssh srv ./rollback.sh", check: ["abre /", "login"] } } };
  assert.deepEqual(ent.envChanges([e], [next], "es"), [
    "Producción: el comando que despliega pasa de nada a ssh srv ./deploy.sh",
    "Producción: el comando que vuelve atrás pasa de nada a ssh srv ./rollback.sh",
    "Producción: lo que se comprueba pasa de nada a abre /, login",
  ]);
});
