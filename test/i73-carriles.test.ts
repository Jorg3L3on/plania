// PLA-I73-5: the heavy-work queue (which commands wait, the slots, the PATH a Taller run gets). The lanes themselves
// are covered in test/runner.test.ts with the admission fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { isHeavy } = await import("../src/runner/heavy-shim.mjs");
const { heavyEnv, heavySlots } = await import("../src/runner/heavy.js");

test("I73-5 #1: test suites, type checks, builds and browser tests wait for a slot; dev servers and installs never do", () => {
  for (const [tool, args] of [
    ["npm", ["test"]],
    ["npm", ["run", "test:db"]],
    ["npm", ["run", "typecheck"]],
    ["npm", ["run", "build"]],
    ["pnpm", ["test"]],
    ["pnpm", ["build"]],
    ["npx", ["vitest", "run"]],
    ["npx", ["tsc", "--noEmit"]],
    ["npx", ["playwright", "test"]],
    ["npx", ["next", "build"]],
    ["pnpm", ["exec", "tsc", "-p", "ui"]],
  ] as const)
    assert.equal(isHeavy(tool, [...args]), true, `${tool} ${args.join(" ")}`);
  for (const [tool, args] of [
    ["npm", ["run", "dev"]],
    ["npm", ["ci"]],
    ["npm", ["install"]],
    ["npx", ["next", "dev", "-p", "3111"]],
    ["npx", ["prettier", "--write", "."]],
    ["npx", ["tsx", "scripts/x.ts"]],
    ["pnpm", ["dev"]],
    ["npm", ["run", "db:migrate"]],
  ] as const)
    assert.equal(isHeavy(tool, [...args]), false, `${tool} ${args.join(" ")}`);
});

test("I73-5 #2: slots follow the memory: one on an 8 GB Mac, more on bigger ones, the variable wins", () => {
  const gb = 1024 ** 3;
  assert.equal(heavySlots(8 * gb, {}), 1);
  assert.equal(heavySlots(16 * gb, {}), 4);
  assert.equal(heavySlots(4 * gb, {}), 1);
  assert.equal(heavySlots(8 * gb, { PLANIA_HEAVY_SLOTS: "3" }), 3);
});

test("I73-5 #3: a run's PATH starts with the wrappers; off on Windows or with PLANIA_HEAVY_QUEUE=0", () => {
  const root = mkdtempSync(path.join(tmpdir(), "plania-i73-heavy-"));
  const env = heavyEnv(root, { PATH: "/usr/bin" }, "darwin");
  assert.ok(env.PATH!.startsWith(path.join(root, ".plania-heavy", "bin")));
  assert.ok(env.PATH!.endsWith("/usr/bin"));
  for (const t of ["npm", "npx", "pnpm", "yarn"]) assert.match(readFileSync(path.join(root, ".plania-heavy", "bin", t), "utf8"), new RegExp(`heavy-shim.mjs" ${t} "\\$@"`));
  assert.deepEqual(heavyEnv(root, {}, "win32"), {});
  assert.deepEqual(heavyEnv(root, { PLANIA_HEAVY_QUEUE: "0" }, "darwin"), {});
});

test("I73-5 #4: the wrapper runs the real command with its exit code, holding and then freeing a slot", { skip: process.platform === "win32" ? "POSIX shell wrappers" : false }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "plania-i73-heavy-run-"));
  const real = path.join(root, "real");
  mkdirSync(real);
  const fake = path.join(real, "npm");
  writeFileSync(fake, `#!/bin/sh\nls "$PLANIA_HEAVY_DIR" > "${root}/seen"\nexit 3\n`);
  chmodSync(fake, 0o755);
  const env = heavyEnv(root, { PATH: `${real}:${process.env.PATH}` }, "darwin");
  let code = 0;
  try {
    execFileSync(path.join(root, ".plania-heavy", "bin", "npm"), ["test"], { env: { ...process.env, ...env } });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  assert.equal(code, 3, "the real command's exit code");
  assert.equal(readFileSync(path.join(root, "seen"), "utf8").trim(), "slot-1", "it ran holding a slot");
  assert.equal(existsSync(path.join(env.PLANIA_HEAVY_DIR!, "slot-1")), false, "the slot is free again");
});
