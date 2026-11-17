// PLA-38: an app copy (sandbox's or the delivery's) gets the project's env file, which git does not carry.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { syncEnvFile } = await import("../src/captures/prueba.js");
const root = mkdtempSync(path.join(tmpdir(), "plania-pla38-"));
after(() => rmSync(root, { recursive: true, force: true }));
const dirs = (n: string) => {
  const repo = path.join(root, n, "repo");
  const wt = path.join(root, n, "wt");
  mkdirSync(repo, { recursive: true });
  mkdirSync(wt, { recursive: true });
  return { repo, wt };
};

test("a copy gets the repo's env file when it has none, mode 0600; a newer one replaces it; an up-to-date one stays", () => {
  const { repo, wt } = dirs("a");
  writeFileSync(path.join(repo, ".env.local"), "DATABASE_URL=postgres://x@localhost:5433/demo_dev\n");
  assert.equal(syncEnvFile(repo, wt), ".env.local");
  assert.equal(readFileSync(path.join(wt, ".env.local"), "utf8"), "DATABASE_URL=postgres://x@localhost:5433/demo_dev\n");
  assert.equal(statSync(path.join(wt, ".env.local")).mode & 0o777, 0o600);
  writeFileSync(path.join(repo, ".env.local"), "DATABASE_URL=new\n");
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(repo, ".env.local"), later, later);
  syncEnvFile(repo, wt);
  assert.equal(readFileSync(path.join(wt, ".env.local"), "utf8"), "DATABASE_URL=new\n");
  writeFileSync(path.join(wt, ".env.local"), "LOCAL=1\n");
  utimesSync(path.join(wt, ".env.local"), new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
  syncEnvFile(repo, wt);
  assert.equal(readFileSync(path.join(wt, ".env.local"), "utf8"), "LOCAL=1\n", "a newer file in the copy is left alone");
});

test("settings.maquinas.env_file wins; no env file in the repo copies nothing", () => {
  const { repo, wt } = dirs("b");
  writeFileSync(path.join(repo, ".env.local"), "A=1\n");
  writeFileSync(path.join(repo, ".env.app"), "B=2\n");
  assert.equal(syncEnvFile(repo, wt, { env_file: ".env.app" } as never), ".env.app");
  assert.equal(readFileSync(path.join(wt, ".env.app"), "utf8"), "B=2\n");
  const empty = dirs("c");
  assert.equal(syncEnvFile(empty.repo, empty.wt), null);
  assert.equal(syncEnvFile(empty.repo, empty.wt, { env_file: "../secrets" } as never), null, "never outside the repo");
});
