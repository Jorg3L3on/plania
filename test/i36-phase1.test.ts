// PLA-I36 phase 1: Compañía tells the truth. The honest light with its reason (PLA-I36-1), Te toca with every
// paso and the evidence in the row (PLA-I36-2), Tus órdenes (PLA-I36-3). Throwaway DB, fake values only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { ownerCode, resetTestDb, useOwnerCode, useTestEnv } from "./helpers.js";

useTestEnv();
await useOwnerCode();
process.env.PLANIA_EVENT_WAKES = "1";
process.env.PLANIA_HOME_PROJECT = "zigzag";
process.env.PLANIA_PROMPTS_PROJECT = "micasa";
const { makeDb } = await import("../src/db/client.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { seedOrg } = await import("../scripts/seed-org.js");
const writes = await import("../src/mcp/writes.js");
const questions = await import("../src/mcp/questions.js");
const { decisionsRead } = await import("../src/api/company-decisions.js");

type Json = Record<string, any>;
let raw: pg.Client;
let db: ReturnType<typeof makeDb>["db"];
let closeDb: () => Promise<void>;
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });
const company = async (): Promise<Json> => {
  const res = await app.request("/api/company", { headers: jorge() });
  assert.equal(res.status, 200);
  return (await res.json()) as Json;
};
const card = async (slug: string) => (await company()).projects.find((p: Json) => p.slug === slug) as Json;
const act = (id: string, body: unknown) => app.request(`/api/company/decisions/${encodeURIComponent(id)}`, { method: "POST", headers: jorge(), body: JSON.stringify(body) });
const PO = (slug: string) => ({ actor: { agent: `po-${slug}`, session_id: `s-po-${slug}` } });
const threadId = async (slug: string) => ((await (await app.request(`/api/threads/${slug}`, { headers: jorge() })).json()) as { id: string }).id;
const agentId = async (slug: string) => (await raw.query(`select id from agents where slug = $1`, [slug])).rows[0].id as string;
const projectId = async (slug: string) => (await raw.query(`select id from projects where slug = $1`, [slug])).rows[0].id as string;
const run = async (agent: string, project: string, status: string, summary: string, minutesAgo = 5) =>
  raw.query(
    `insert into agent_runs (agent_id, project_id, role, status, summary, started_at, ended_at) values ($1, $2, 'product-owner', $3, $4, now() - ($5 || ' minutes')::interval - interval '1 minute', now() - ($5 || ' minutes')::interval)`,
    [await agentId(agent), await projectId(project), status, summary, String(minutesAgo)],
  );

before(async () => {
  raw = await resetTestDb();
  await raw.query(`insert into projects (slug, title, key_prefix) values ('mianovia', 'Mianovia', 'MIA')`);
  ({ db, close: closeDb } = makeDb());
  await seedOrg(db);
  await raw.query(`update projects set runs_paused = false where slug in ('mianovia', 'micasa', 'workia', 'filmia')`);
  // Something moved in every running project today, so none of them is quiet; each has a weekly limit.
  for (const slug of ["mianovia", "micasa", "workia", "filmia"]) {
    const b = await app.request("/api/company/budgets", { method: "PUT", headers: jorge(), body: JSON.stringify({ scope: "project", project: slug, weekly_limit: 5_000_000, code: await ownerCode() }) });
    assert.equal(b.status, 200, await b.clone().text());
    await writes.createTask(db, { project: slug, title: `Base de ${slug}`, scope: "s", checks: ["c"] } as never, PO(slug));
  }
});

after(async () => {
  await closeDb?.();
  await raw?.end();
});

// ---- PLA-I36-1

test("I36-1 #4: Bien only when nothing waits, the last runs are ok and something moved in 48 h", async () => {
  const filmia = await card("filmia");
  assert.equal(filmia.light, "ok");
  assert.equal(filmia.light_reason, null);
  await raw.query(`update events set created_at = now() - interval '3 days' where project_id = $1`, [await projectId("filmia")]);
  const quiet = await card("filmia");
  assert.equal(quiet.light, "quiet");
  assert.equal(quiet.light_reason.text, "Nada se movió en 3 días.");
});

test("I36-1 #1: a ceo-owned Ready ticket makes Te necesita, with the reason and the way to Te toca", async () => {
  await writes.createTask(db, { project: "mianovia", title: "Kickoff con la boutique", status: "Ready", owner_agent: "ceo", scope: "s", checks: ["c"] } as never, PO("mianovia"));
  const mia = await card("mianovia");
  assert.equal(mia.light, "needs_jorge");
  assert.equal(mia.light_reason.text, "Lo siguiente es tuyo: «Kickoff con la boutique».");
  assert.deepEqual(mia.light_reason.action, { label: "Ver en Te toca", href: "#te-toca" });
});

test("I36-1 #2: the last run ended fail: Falló, its reason and a link to Máquina; an ok run after clears it", async () => {
  await run("po-workia", "workia", "fail", "spawn claude ENOENT\nstack…", 10);
  const workia = await card("workia");
  assert.equal(workia.light, "failed");
  assert.equal(workia.light_reason.text, "La última corrida del PO falló: spawn claude ENOENT");
  assert.deepEqual(workia.light_reason.action, { label: "Ver en Máquina", href: "/machine" });
  assert.equal(workia.team.find((m: Json) => m.role === "product-owner").last.status, "fail");
  await run("po-workia", "workia", "ok", "listo", 1);
  assert.equal((await card("workia")).light, "ok");
});

test("I36-1 #3: readiness blocked says why in one sentence, without the key", async () => {
  const t = (await writes.createTask(db, { project: "micasa", title: "Formulario de contacto", scope: "s", checks: ["c"] } as never, PO("micasa"))) as Json;
  await raw.query(`update tasks set status = 'In review', pr_url = 'https://github.com/x/micasa/pull/7' where key = $1`, [t.key]);
  await raw.query(
    `insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state) select project_id, 'x/micasa', 7, 'https://github.com/x/micasa/pull/7', 'pr', id, 'open', 'failure' from tasks where key = $1`,
    [t.key],
  );
  const micasa = await card("micasa");
  assert.equal(micasa.light, "blocked");
  assert.equal(micasa.light_reason.text, "Las pruebas de «Formulario de contacto» fallaron.");
  assert.equal(micasa.light_reason.text.includes(t.key), false);
  assert.equal(micasa.light_reason.action.href, "/p/micasa");
});

// ---- PLA-I36-2

test("I36-2 #2: a human_action blocker shows as a step row; Hecho resolves it", async () => {
  const t = (await writes.createTask(db, { project: "workia", title: "Publicar la tienda", scope: "s", checks: ["c"] } as never, PO("workia"))) as Json;
  const [v] = (await raw.query(`select version from tasks where key = $1`, [t.key])).rows;
  await writes.setTask(db, { project: "workia", key: t.key, version: v.version, status: "Blocked", note: "falta la llave", blocked_by: [{ human_action: { text: "Crear la cuenta de la tienda" } }] } as never, PO("workia"));
  const c = await company();
  const step = c.decisions.find((d: Json) => d.kind === "step");
  assert.ok(step, "a step row");
  assert.deepEqual([step.project, step.title, step.actions, step.ref], ["workia", "Crear la cuenta de la tienda", ["hecho"], t.key]);
  assert.equal(c.projects.find((p: Json) => p.slug === "workia").light, "needs_jorge");
  const res = await act(step.id, { action: "hecho" });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await raw.query(`select count(*)::int as n from blockers where id = $1 and satisfied_at is not null`, [step.id.slice(2)])).rows[0].n, 1);
  assert.equal((await company()).decisions.some((d: Json) => d.id === step.id), false);
  assert.equal((await act(step.id, { action: "hecho" })).status, 409);
});

test("I36-2 #1: a pending release shows commits ahead, the tickets it ships and open checks; acting is refused here", async () => {
  const all = await raw.query(`select id, slug, title from projects`);
  const inbox = new Map<string, Json[]>();
  inbox.set("zigzag", [
    {
      id: "release:zigzag",
      kind: "release",
      group: "pasos",
      project: "zigzag",
      waiting_since: "2026-11-09T10:00:00.000Z",
      target: {
        from: { branch: "sandbox", head_sha: "a" },
        into: { branch: "main", head_sha: "b" },
        env: "prod",
        ahead: 4,
        tickets: [
          { key: "ZIG-1", title: "Uno", status: "Merged", pr_url: "https://github.com/x/z/pull/1" },
          { key: "ZIG-2", title: "Dos", status: "Merged", pr_url: null },
        ],
        open_checks: 1,
        before: [{ blocker_id: "x", key: "ZIG-3", text: "migrar" }],
      },
    },
  ]);
  void all;
  const rows = await decisionsRead(db, new Date(), inbox as never);
  const r = rows.find((d) => d.kind === "release")!;
  assert.deepEqual([r.id, r.project, r.title, r.actions], ["r-zigzag", "zigzag", "2 cambios listos para publicar", []]);
  assert.deepEqual(r.release, { from: "sandbox", into: "main", env: "prod", ahead: 4, tickets: [{ key: "ZIG-1", title: "Uno" }, { key: "ZIG-2", title: "Dos" }], open_checks: 1, before: 1 });
  assert.deepEqual(r.checks, { open: 1, ci: null });
  assert.deepEqual(r.links, [{ kind: "pr", ref: "https://github.com/x/z/pull/1", title: "Uno" }]);
  const res = await act("r-zigzag", { action: "hecho" });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as Json).error, "OWNER_CODE");
});

test("I36-2 #3: the payload counts Bandeja's decisiones and pasos, also those Te toca leaves out", async () => {
  await raw.query(`update projects set runs_paused = true where slug = 'filmia'`);
  const t = (await writes.createTask(db, { project: "filmia", title: "Tráiler", scope: "s", checks: ["c"] } as never, PO("filmia"))) as Json;
  await questions.ask(db, { project: "filmia", key: t.key, question: "¿Qué música?", options: ["A", "B"] } as never, PO("filmia"));
  const c = await company();
  assert.equal(c.decisions.some((d: Json) => d.kind === "question" && d.project === "filmia"), false, "a paused project's question stays out of Te toca");
  assert.ok(c.inbox.decisiones >= 1, "but Bandeja counts it");
  assert.deepEqual(Object.keys(c.inbox).sort(), ["decisiones", "pasos"]);
});

test("I36-2 #4: a proposal row carries the PO's full message and its linked doc, which opens", async () => {
  const t = (await writes.createTask(db, { project: "mianovia", title: "Campos y flujos", scope: "s", checks: ["c"] } as never, PO("mianovia"))) as Json;
  const doc = await raw.query(
    `insert into docs (project_id, task_id, title, markdown, actor) select project_id, id, 'Campos y flujos', '# Campos\nnombre, fecha', '{"agent":"po-mianovia"}'::jsonb from tasks where key = $1 returning id`,
    [t.key],
  );
  const docId = doc.rows[0].id as string;
  const body = "Leí el borrador.\nTres caminos:\n1. Formulario corto (recomendado)\n2. Formulario largo\n3. Esperar al kickoff\nEl doc tiene los campos.";
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'po-mianovia', 'product-owner', $2, $3::jsonb, now())`, [
    await threadId("mianovia"),
    body,
    JSON.stringify([{ kind: "doc", ref: docId, title: "Campos y flujos" }]),
  ]);
  const p = (await company()).decisions.find((d: Json) => d.kind === "proposal" && d.project === "mianovia");
  assert.equal(p.body, body);
  assert.deepEqual(p.links, [{ kind: "doc", ref: docId, title: "Campos y flujos" }]);
  const res = await app.request(`/api/company/docs/${docId}`, { headers: jorge() });
  assert.equal(res.status, 200);
  assert.match(((await res.json()) as Json).markdown, /nombre, fecha/);
});

test("I36-2 #5: a PR row shows its link and whether checks are open before Fusionar", async () => {
  const t = (await writes.createTask(db, { project: "micasa", title: "Galería", scope: "s", checks: ["c1", "c2"] } as never, PO("micasa"))) as Json;
  const url = "https://github.com/x/micasa/pull/9";
  await raw.query(`update tasks set status = 'In review', pr_url = $2 where key = $1`, [t.key, url]);
  await raw.query(`update checks set done = true where n = 1 and task_id = (select id from tasks where key = $1)`, [t.key]);
  await raw.query(`insert into pull_requests (project_id, repo, number, url, title, task_id, state, ci_state) select project_id, 'x/micasa', 9, $2, 'pr', id, 'open', 'pending' from tasks where key = $1`, [t.key, url]);
  await raw.query(`insert into thread_messages (thread_id, author_agent, author_role, body, links, at) values ($1, 'taller-micasa', 'taller', $2, $3::jsonb, now())`, [
    await threadId("micasa"),
    `${t.key} queda En revisión: Galería.`,
    JSON.stringify([
      { kind: "ticket", ref: t.key, title: "Galería" },
      { kind: "pr", ref: url, title: `PR de ${t.key}` },
    ]),
  ]);
  const pr = (await company()).decisions.find((d: Json) => d.kind === "pr" && d.ref === t.key);
  assert.ok(pr, "a pr row");
  assert.deepEqual(pr.actions, ["fusionar", "cambios"]);
  assert.deepEqual(pr.checks, { open: 1, ci: "pending" });
  assert.ok(pr.links.some((l: Json) => l.kind === "pr" && l.ref === url));
});

// ---- PLA-I36-3

test("I36-3 #1, #2: an origin-jorge order shows on its card: enviada, entendida with the PO's line, entregada with its PR", async () => {
  const res = await app.request("/api/company/projects/workia/ask", { method: "POST", headers: jorge(), body: JSON.stringify({ text: "Agrega un botón de WhatsApp" }) });
  assert.equal(res.status, 201, await res.clone().text());
  const key = ((await res.json()) as Json).key as string;
  const order = async () => (await card("workia")).orders.find((o: Json) => o.title === "Agrega un botón de WhatsApp");
  let o = await order();
  assert.deepEqual([o.kind, o.state, o.understood], ["order", "enviada", null]);
  await writes.setTask(db, { project: "workia", key, note: "Entendí: un botón fijo abajo que abre WhatsApp con el número de la tienda" } as never, PO("workia"));
  o = await order();
  assert.deepEqual([o.state, o.understood], ["entendida", "un botón fijo abajo que abre WhatsApp con el número de la tienda"]);
  await raw.query(`update tasks set status = 'In progress' where key = $1`, [key]);
  assert.equal((await order()).state, "en_curso");
  await raw.query(`update tasks set status = 'Done', pr_url = 'https://github.com/x/w/pull/3' where key = $1`, [key]);
  o = await order();
  assert.equal(o.state, "entregada");
  assert.deepEqual(o.link, { kind: "pr", ref: "https://github.com/x/w/pull/3", title: "PR" });
});

test("I36-3 #3: an order Ready for more than 24 h with no run is sin tomar with its age", async () => {
  const res = await app.request("/api/company/projects/workia/ask", { method: "POST", headers: jorge(), body: JSON.stringify({ text: "Cambia el logo" }) });
  const key = ((await res.json()) as Json).key as string;
  await raw.query(`delete from agent_runs where task_key = $1`, [key]);
  await raw.query(`update tasks set status_changed_at = now() - interval '30 hours', created_at = now() - interval '30 hours' where key = $1`, [key]);
  const o = (await card("workia")).orders.find((x: Json) => x.title === "Cambia el logo");
  assert.deepEqual([o.state, o.age_h], ["sin_tomar", 30]);
});

test("I36-3 #4: a choice made in Te toca shows in the trail after its row leaves the strip; five at most", async () => {
  const id = (await company()).decisions.find((d: Json) => d.kind === "proposal" && d.project === "mianovia").id;
  const res = await act(id, { action: "elegir", option: 1 });
  assert.equal(res.status, 200, await res.clone().text());
  const created = ((await res.json()) as Json).created.key as string;
  await raw.query(`update thread_messages set action_state = jsonb_set(action_state, '{at}', to_jsonb((now() - interval '2 days')::text)) where id = $1`, [id.slice(2)]);
  const c = await company();
  assert.equal(c.decisions.some((d: Json) => d.id === id), false, "the row left Te toca");
  const mia = c.projects.find((p: Json) => p.slug === "mianovia");
  const choice = mia.orders.find((o: Json) => o.kind === "choice");
  assert.equal(choice.title, "Elegiste 1: Formulario corto");
  assert.equal(choice.state, "enviada");
  assert.equal(mia.orders.filter((o: Json) => o.title === "Formulario corto" || o.title.includes(created)).length, 0, "its ticket is not a second row");
  for (let i = 0; i < 6; i++) await app.request("/api/company/projects/workia/ask", { method: "POST", headers: jorge(), body: JSON.stringify({ text: `Pedido ${i}` }) });
  assert.equal((await card("workia")).orders.length, 5);
});
