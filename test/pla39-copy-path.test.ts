// PLA-39: an app copy finds npm and node even when Plania runs under launchd with the bare system PATH.
import assert from "node:assert/strict";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { checkoutEnv, toolPath } = await import("../src/captures/run.js");

test("the running node's folder and the usual tool folders go first; PATH keeps what it had, once each", () => {
  assert.equal(toolPath("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/x/.nvm/versions/node/v24/bin/node", ":"), "/Users/x/.nvm/versions/node/v24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(toolPath("/opt/homebrew/bin:/usr/bin", "/opt/homebrew/bin/node", ":"), "/opt/homebrew/bin:/usr/local/bin:/usr/bin");
  assert.equal(toolPath(undefined, "/usr/local/bin/node", ":"), "/usr/local/bin:/opt/homebrew/bin");
});

test("checkoutEnv carries that PATH and none of Plania's secrets", () => {
  const was = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  process.env.PLANIA_SECRET_PROBE = "x";
  try {
    const env = checkoutEnv({ PORT: "3001" });
    assert.ok(env.PATH!.startsWith(`${process.execPath.replace(/\/node$/, "")}:`));
    assert.ok(env.PATH!.endsWith(":/usr/bin:/bin"));
    assert.equal(env.PORT, "3001");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.PLANIA_SECRET_PROBE, undefined);
  } finally {
    process.env.PATH = was;
    delete process.env.PLANIA_SECRET_PROBE;
  }
});
