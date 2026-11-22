// PLA-158 (F-17): the merge and deploy lines read the field each writer sets (base_branch or base; branch or env)
// and leave out the "en …" part when there is none, never "mezclado en  (KEY)".
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetLanguage } from "../src/language.js";
import { summarize } from "../src/mcp/summary.js";

const actor = { agent: "plania", session_id: "s" };
const ev = (type: string, payload: Record<string, unknown>, task_key: string | null = "ZIG-1") => ({ type, task_key, actor, payload });

function inLanguage<T>(lang: "es" | "en", fn: () => T): T {
  const was = process.env.PLANIA_LANGUAGE;
  process.env.PLANIA_LANGUAGE = lang;
  resetLanguage();
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.PLANIA_LANGUAGE;
    else process.env.PLANIA_LANGUAGE = was;
    resetLanguage();
  }
}

test("pr.merged reads base_branch (GitHub poll) or base (thread action), and omits the branch when there is none", () => {
  inLanguage("es", () => {
    assert.equal(summarize(ev("pr.merged", { number: 68, base_branch: "main" })), "PR #68 mezclado en main (ZIG-1)");
    assert.equal(summarize(ev("pr.merged", { number: 68, base: "sandbox" })), "PR #68 mezclado en sandbox (ZIG-1)");
    assert.equal(summarize(ev("pr.merged", { number: 68 })), "PR #68 mezclado (ZIG-1)");
  });
  inLanguage("en", () => {
    assert.equal(summarize(ev("pr.merged", { number: 68, base: "sandbox" })), "PR #68 merged into sandbox (ZIG-1)");
    assert.equal(summarize(ev("pr.merged", { number: 68 }, null)), "PR #68 merged");
  });
});

test("release.recorded reads branch (release by branch) or env, and omits the target when there is none", () => {
  inLanguage("es", () => {
    assert.equal(summarize(ev("release.recorded", { branch: "main", commit: "abc" }, "ZIG-3")), "ZIG-3 desplegado en main");
    assert.equal(summarize(ev("release.recorded", { env: "prod", commit: "abc" }, "ZIG-3")), "ZIG-3 desplegado en prod");
    assert.equal(summarize(ev("release.recorded", { commit: "abc" }, "ZIG-3")), "ZIG-3 desplegado");
  });
  inLanguage("en", () => {
    assert.equal(summarize(ev("release.recorded", { branch: "main" }, "ZIG-3")), "ZIG-3 deployed to main");
    assert.equal(summarize(ev("release.recorded", {}, null)), "deployed");
  });
});
