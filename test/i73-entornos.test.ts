// PLA-I73-4: warm environments: modules cloned copy-on-write when the lockfile matches, database copies from a
// template rebuilt every few hours. No database: the template's commands go to a fake exec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { cloneModules, sameLockfile } = await import("../src/lib/clone-modules.js");
const prueba = await import("../src/captures/prueba.js");

const scratch = mkdtempSync(path.join(tmpdir(), "plania-i73-env-"));
const dir = (name: string, lock: string | null) => {
  const d = path.join(scratch, name);
  mkdirSync(d, { recursive: true });
  if (lock !== null) writeFileSync(path.join(d, "package-lock.json"), lock);
  return d;
};

test("I73-4 #1: the same lockfile is required, byte for byte", () => {
  const a = dir("a", '{"v":1}');
  assert.equal(sameLockfile(a, dir("b", '{"v":1}')), "package-lock.json");
  assert.equal(sameLockfile(a, dir("c", '{"v":2}')), null);
  assert.equal(sameLockfile(a, dir("d", null)), null);
});

test("I73-4 #2: modules are cloned with cp -c on macOS, never elsewhere or across lockfiles", async () => {
  const from = dir("from", '{"v":1}');
  mkdirSync(path.join(from, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(path.join(from, "node_modules", "left-pad", "index.js"), "module.exports = 1;");
  // PLA-I74-6: npm's own marker: these modules were installed by the tool package-lock.json names.
  writeFileSync(path.join(from, "node_modules", ".package-lock.json"), "{}");
  const calls: string[] = [];
  const fake = async (cmd: string) => {
    calls.push(cmd);
    return { code: 0, stdout: "", stderr: "" };
  };
  assert.equal(await cloneModules(from, dir("to1", '{"v":1}'), fake, "linux"), false);
  assert.equal(await cloneModules(from, dir("to2", '{"v":2}'), fake, "darwin"), false);
  assert.deepEqual(calls, []);
  assert.equal(await cloneModules(from, dir("to3", '{"v":1}'), fake, "darwin"), true);
  assert.match(calls[0]!, /^cp -c -R '.*from\/node_modules' '.*to3\/node_modules'$/);
  if (process.platform === "darwin") {
    const to = dir("to4", '{"v":1}');
    assert.equal(await cloneModules(from, to), true, "a real clone on APFS");
    assert.equal(readFileSync(path.join(to, "node_modules", "left-pad", "index.js"), "utf8"), "module.exports = 1;");
  }
  const failing = async () => ({ code: 1, stdout: "", stderr: "no" });
  const to5 = dir("to5", '{"v":1}');
  assert.equal(await cloneModules(from, to5, failing, "darwin"), false);
  assert.equal(existsSync(path.join(to5, "node_modules")), false, "a failed clone leaves nothing half made");
});

test("I74-6 #2: installed packages are never copied across package managers", async () => {
  const { installedBy, lockTool } = await import("../src/lib/clone-modules.js");
  const calls: string[] = [];
  const fake = async (cmd: string) => {
    calls.push(cmd);
    return { code: 0, stdout: "", stderr: "" };
  };
  // An npm-locked checkout whose modules pnpm installed (the run that went flaky): never lent.
  const pnpmOnNpm = dir("pnpm-on-npm", '{"v":7}');
  mkdirSync(path.join(pnpmOnNpm, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(pnpmOnNpm, "node_modules", ".modules.yaml"), "layoutVersion: 5\n");
  assert.equal(installedBy(pnpmOnNpm), "pnpm");
  assert.deepEqual(lockTool(pnpmOnNpm), { lockfile: "package-lock.json", tool: "npm" });
  assert.equal(await cloneModules(pnpmOnNpm, dir("to-npm", '{"v":7}'), fake, "darwin"), false);
  // Modules with no marker at all: unknown tool, never lent.
  const bare = dir("bare", '{"v":7}');
  mkdirSync(path.join(bare, "node_modules", "x"), { recursive: true });
  assert.equal(installedBy(bare), null);
  assert.equal(await cloneModules(bare, dir("to-bare", '{"v":7}'), fake, "darwin"), false);
  assert.deepEqual(calls, []);
  // A pnpm-locked checkout pnpm installed: lent.
  const pnpm = path.join(scratch, "pnpm-ok");
  mkdirSync(path.join(pnpm, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(path.join(pnpm, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  const to = path.join(scratch, "pnpm-to");
  mkdirSync(to, { recursive: true });
  writeFileSync(path.join(to, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  assert.equal(await cloneModules(pnpm, to, fake, "darwin"), true);
  assert.equal(calls.length, 1);
});

test("I73-4 #3: the template is built once, reused for six hours, rebuilt after, and a failure means no template", async () => {
  prueba.resetPlantillasForTests();
  const cmds: string[] = [];
  let code = 0;
  const exec = async (cmd: string) => {
    cmds.push(cmd);
    return { code, stdout: "", stderr: "" };
  };
  const base = "postgresql://localhost:5433/mianovia_dev";
  const t0 = Date.parse("2026-11-22T00:00:00Z");
  assert.equal(await prueba.plantillaOf(exec, scratch, "", base, t0), "mianovia_dev_plantilla");
  assert.equal(await prueba.plantillaOf(exec, scratch, "", base, t0 + 60_000), "mianovia_dev_plantilla");
  assert.equal(cmds.length, 1, "reused, not rebuilt");
  assert.match(cmds[0]!, /create database mianovia_dev_plantilla' && pg_dump/);
  assert.doesNotMatch(cmds[0]!, /localhost:5433/, "URLs travel in the environment, never the command");
  assert.equal(await prueba.plantillaOf(exec, scratch, "", base, t0 + 7 * 3600_000), "mianovia_dev_plantilla");
  assert.equal(cmds.length, 2, "rebuilt after six hours");
  code = 1;
  assert.equal(await prueba.plantillaOf(exec, scratch, "", base, t0 + 14 * 3600_000), null);
  assert.equal(await prueba.plantillaOf(exec, scratch, "", "postgresql://db.example.com/app", t0), null, "never a remote database");
});
