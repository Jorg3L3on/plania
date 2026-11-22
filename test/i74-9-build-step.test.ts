// PLA-I74-9: the host's production build in the verify list by default. The command is the one the host runs
// (vercel.json's buildCommand, else vercel-build, else build, through the lockfile's package manager); finish and the
// QA lane run it (the lane's failing build is in test/i46-qa.test.ts); the owner removes it only with a reason, which
// Ajustes shows. Files are read through a fake reader or a scratch folder; the database is the test one.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { hostBuildOf, verifyListOf, buildRead, packageManagerOf } = await import("../src/runner/build-step.js");
const { verifyPlan } = await import("../src/runner/verify.js");
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");

(globalThis as { React?: unknown }).React = React;
const ajustes = (await import(new URL("../ui/src/components/corriente/ajustes.tsx", import.meta.url).href)) as Record<string, any>;
const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(MemoryRouter, null, el)));

let raw: pg.Client;
const scratch = mkdtempSync(path.join(tmpdir(), "plania-i74-9-"));
const files = (map: Record<string, string>) => (f: string) => {
  const hit = Object.entries(map).find(([name]) => f.endsWith(`/${name}`));
  return hit ? hit[1] : null;
};
const jorge = () => ({ Cookie: `${SESSION_COOKIE}=${createSession()}`, "Content-Type": "application/json" });

before(async () => {
  raw = await resetTestDb();
});
after(async () => {
  await raw.end();
});

test("the build the host runs: vercel.json's buildCommand, else vercel-build, else build, with the lockfile's package manager", () => {
  assert.deepEqual(hostBuildOf("/r", files({ "package.json": JSON.stringify({ scripts: { build: "next build" } }), "pnpm-lock.yaml": "x" })), { name: "build", command: "pnpm run build", timeout_minutes: 20, source: "build" });
  assert.equal(hostBuildOf("/r", files({ "package.json": JSON.stringify({ scripts: { build: "next build", "vercel-build": "prisma generate && next build" } }), "yarn.lock": "x" }))?.command, "yarn run vercel-build");
  assert.equal(hostBuildOf("/r", files({ "package.json": JSON.stringify({ scripts: { build: "x" } }), "vercel.json": JSON.stringify({ buildCommand: "pnpm turbo build --filter web" }) }))?.command, "pnpm turbo build --filter web");
  assert.equal(hostBuildOf("/r", files({ "package.json": JSON.stringify({ scripts: { build: "x" } }) }))?.command, "npm run build");
  assert.equal(hostBuildOf("/r", files({ "package.json": JSON.stringify({ scripts: { test: "x" } }) })), null, "no build script, no step");
  assert.equal(hostBuildOf("/r", files({ "package.json": "{not json" })), null);
  assert.equal(hostBuildOf(null), null);
  assert.equal(packageManagerOf("/r", files({ "bun.lock": "x" })), "bun");
});

test("check 1: a project with a build script gets the build step last in its verify list; a list that builds already, or the owner's removal, leaves it out", () => {
  const read = files({ "package.json": JSON.stringify({ scripts: { build: "next build" } }), "pnpm-lock.yaml": "x" });
  const own = [{ name: "test", command: "pnpm test" }];
  assert.deepEqual(verifyListOf({ settings: { qa: { verify: own } } }, "/r", read), [...own, { name: "build", command: "pnpm run build", timeout_minutes: 20 }]);
  assert.deepEqual(verifyListOf({ settings: {} }, "/r", read), [{ name: "build", command: "pnpm run build", timeout_minutes: 20 }], "even with no list of its own");
  assert.deepEqual(verifyListOf({ settings: { qa: { verify: [{ name: "compila", command: "pnpm build" }] } } }, "/r", read).length, 1, "pnpm build already builds");
  assert.deepEqual(verifyListOf({ settings: { qa: { verify: own, no_build: { reason: "El servicio compila con Node 18" } } } }, "/r", read), own);
  assert.deepEqual(buildRead({ settings: { qa: { verify: own, no_build: { reason: "El servicio compila con Node 18" } } } }, "/r", read), { command: "pnpm run build", source: "build", on: false, in_list: false, off_reason: "El servicio compila con Node 18" });
});

test("finish (AUDIT-1) runs the build from the ticket's workspace, even on a project with no list of its own", () => {
  const ws = path.join(scratch, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(path.join(ws, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
  const t = { kind: "ticket", workType: "code", workspace: { worktree_path: ws }, owner: { agent: "a", session_id: "s1" } } as never;
  const plan = verifyPlan({ settings: {} }, t, "s1");
  assert.equal(plan.run, true);
  assert.deepEqual(plan.run && plan.items.map((i) => i.command), ["npm run build"]);
  assert.equal(verifyPlan({ settings: { qa: { verify: [], no_build: { reason: "sin servicio" } } } }, t, "s1").run, false);
});

test("check 3: removing the step from Ajustes needs a reason, the reason is read back and shown, and it can be put back", async () => {
  const repo = path.join(scratch, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  writeFileSync(path.join(repo, "pnpm-lock.yaml"), "x");
  await raw.query(`update projects set settings = settings || $2::jsonb where slug = $1`, ["filmia", JSON.stringify({ local: { repo_path: repo }, qa: { verify: [{ name: "test", command: "pnpm test" }] } })]);
  const base = "/api/company/projects/filmia/settings";
  let read = (await (await app.request(base, { headers: jorge() })).json()) as Record<string, any>;
  assert.deepEqual(read.build, { command: "pnpm run build", source: "build", on: true, in_list: false, off_reason: null });
  const put = (b: unknown) => app.request(`${base}/verify`, { method: "PUT", headers: jorge(), body: JSON.stringify(b) });
  assert.equal((await put({ version: read.version, commands: ["pnpm test"], no_build: "" })).status, 400, "no reason, no removal");
  const ok = await put({ version: read.version, commands: ["pnpm test"], no_build: "El servicio compila con otra versión" });
  assert.equal(ok.status, 200);
  read = (await ok.json()) as Record<string, any>;
  assert.deepEqual([read.build.on, read.build.off_reason], [false, "El servicio compila con otra versión"]);
  // Saving the commands alone keeps the removal.
  read = (await (await put({ version: read.version, commands: ["pnpm test", "pnpm lint"] })).json()) as Record<string, any>;
  assert.equal(read.build.off_reason, "El servicio compila con otra versión");
  // On the screen.
  const off = html(h(ajustes.Construccion, { a: read, commands: ["pnpm test"] }));
  assert.match(off, /data-build="off"/);
  assert.match(off, /Sin construcción de producción[\s\S]*La quitaste: «El servicio compila con otra versión»/);
  assert.match(off, /data-control="build-volver"/);
  read = (await (await put({ version: read.version, commands: ["pnpm test"], no_build: null })).json()) as Record<string, any>;
  assert.deepEqual([read.build.on, read.build.off_reason], [true, null]);
  const on = html(h(ajustes.Construccion, { a: read, commands: ["pnpm test"] }));
  assert.match(on, /Construcción de producción[\s\S]*pnpm run build/);
  assert.match(on, /mismo comando que corre el servicio/);
  assert.match(on, /data-control="build-quitar"/);
});
