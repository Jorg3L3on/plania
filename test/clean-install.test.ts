// PLA-I2-15: a clean install proves itself. From an empty Postgres, with only what a buyer has (the install, first
// start, the screen's routes, the runner with the fake Claude), to a run that finished and left its work on the
// project. It fails if any step needed a value typed into .env, a seed script or SQL by hand: the server's
// environment is only the settings file the install wrote, and this file runs no SQL of its own.
// Its own database, plania_test_<hash>_e2e, created by the install and dropped at the end; never plania.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { parseEnv } from "node:util";
import { ADMIN_URL, TEST_DB } from "./helpers.js";
import * as step from "./clean-install-harness.js";

const w = step.newCleanInstall(ADMIN_URL, `${TEST_DB}_e2e`);
after(() => step.teardown(w));

test("a clean install reaches a finished run whose work shows on the project, then an accepted delivery", async () => {
  await step.emptyMachine(w);

  const installed = await step.install(w);
  assert.equal(installed.created, true, "the install made the database");
  assert.ok(installed.applied.length > 0);
  assert.match(w.setupCode ?? "", /\S{6,}/, "the install printed a one-time code");
  const written = parseEnv(readFileSync(w.envPath, "utf8"));
  assert.equal(written.DATABASE_URL, w.url);
  assert.equal(written.PLANIA_PASSWORD_HASH ?? "", "", "no password in .env: first start makes the owner");
  assert.equal(written.PLANIA_RUNNER_TOKEN ?? "", "", "no runner token in .env: first start stores it");

  const started = await step.startServer(w);
  assert.equal(started.startupProblem, null, "the start-up check passes on what the install made");

  const first = await step.firstStart(w);
  assert.equal(first.ok, true);
  await step.login(w);

  // PLA-I2-16: a project on a GitHub repository, so the delivery is a PR that Aceptar merges.
  const project = await step.createProject(w, "Primero", { repo: "ana/primero" });
  assert.equal(project.paused, true, "a new project starts paused");
  await step.resume(w);

  const asked = await step.ask(w);
  assert.ok(w.ticket, JSON.stringify(asked));

  // PLA-I2-16: the product owner's run answers the request with a plan, as a real one does.
  const drained = await step.heartbeat(w, { CLAUDE_FAKE_CALLS: step.PLAN_CALLS });
  assert.ok(drained.started >= 1, `the heartbeat started a run: ${JSON.stringify(drained)}`);

  const { ticket, comments, project: page } = await step.workOnProject(w);
  assert.equal(ticket.key, w.ticket);
  // The run wrote to the plan through its MCP with the token first start stored.
  assert.ok(
    comments.some((c) => c.body === step.RUN_NOTE && c.author_agent === "plania-runner"),
    `the run's note is on the ticket: ${JSON.stringify(comments)}`,
  );
  // The project's page shows the finished run on that ticket, by its product owner.
  const run = (page.runs as Array<Record<string, unknown>>).find((r) => r.ticket === w.ticket);
  assert.equal(run?.status, "ok", `a finished run on the ticket: ${JSON.stringify(page.runs)}`);
  assert.equal(run?.role, "product-owner");
  const po = (page.team as Array<Record<string, any>>).find((m) => m.role === "product-owner");
  assert.equal(po?.last?.status, "ok");
  assert.equal(po?.last?.ticket, w.ticket);

  // PLA-I2-16: on to an accepted delivery, the way the guide on the home screen walks it.
  const guide = async () => (await step.http(w, "GET", "/api/guia")).json;
  assert.equal((await guide()).plan, "espera", "the plan waits for «Sí, empiecen»");
  await step.approvePlan(w);
  assert.match(w.step, /^PRI-/, "«Sí, empiecen» made the builder's step");
  assert.equal((await guide()).plan, "aprobado");

  const built = await step.heartbeat(w, { CLAUDE_FAKE_COMMENT: "", CLAUDE_FAKE_CALLS: step.FINISH_CALLS });
  assert.ok(built.started >= 1, `the builder's run started: ${JSON.stringify(built)}`);
  const inReview = await step.http(w, "GET", `/api/projects/${w.project}/tasks/${w.step}`);
  assert.equal(inReview.json.status, "In review", `the builder finished with its PR: ${JSON.stringify((await step.http(w, "GET", `/api/company/projects/${w.project}`)).json.runs)}`);
  assert.equal((await guide()).entrega, "espera");

  const calls: string[][] = [];
  const { DEFAULT_START_BRANCH } = await import("../src/runner/start-branch.js");
  await step.acceptDelivery(w, step.fakeGh(DEFAULT_START_BRANCH, calls));
  assert.ok(calls.some((a) => a[0] === "pr" && a[1] === "merge"), `Aceptar merged the PR through gh: ${JSON.stringify(calls)}`);
  const merged = await step.http(w, "GET", `/api/projects/${w.project}/tasks/${w.step}`);
  assert.equal(merged.json.status, "Merged", "the accepted delivery is in the working branch");
  const after = await guide();
  assert.equal(after.entrega, "aceptada");
  assert.equal(after.visible, false, "the guide goes away after the first accepted delivery");
});
