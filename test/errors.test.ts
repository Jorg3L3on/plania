// The error catalog is the contract: every code is documented in the README and exercised by a test.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { ERRORS } from "../src/mcp/errors.js";

const dir = new URL("./", import.meta.url);
const tests = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts") && f !== "errors.test.ts")
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("every error code is exercised by a test", () => {
  const missing = Object.keys(ERRORS).filter((code) => !tests.includes(`"${code}"`));
  assert.deepEqual(missing, []);
});

test("every error code is in the README catalog with its status", () => {
  const missing = Object.entries(ERRORS).filter(([code, [status]]) => !readme.includes(`| \`${code}\` | ${status} |`));
  assert.deepEqual(missing.map(([code]) => code), []);
});
