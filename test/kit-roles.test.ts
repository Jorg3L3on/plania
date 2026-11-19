// PLA-I2-20: what the team reads works on any install. Reads the repo's own kit/roles/ (not a fixture) and fails
// when a role prompt names a doc, skill, script or template a fresh install does not have, when a role in
// PROMPT_DOCS has no file, when the prompts and the readiness list name different project docs, or when a stale
// line (thread_post not existing, budgets, a fixed hour, a fixed start branch or language) comes back.
// No database: the modules are imported for their constants only.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { PROMPT_DOCS, RUNNER_ROLES } = await import("../src/runner/limits.js");
const { CONTEXT_DOCS, userPrompt } = await import("../src/runner/runner.js");
const { CONTEXT_IDS } = await import("../src/runner/readiness.js");
const { STAGE_DOCS } = await import("../src/mcp/ideas.js");
const { OWNER_LANGUAGE } = await import("../src/runner/owner-language.js");

const KIT = path.resolve(import.meta.dirname, "../kit");
const ROLES = path.join(KIT, "roles");
const kits = JSON.parse(readFileSync(path.join(KIT, "kits.json"), "utf8")) as Record<string, string[]>;
const skills = new Set(readdirSync(path.join(KIT, "skills")).filter((d) => statSync(path.join(KIT, "skills", d)).isDirectory()));

const prompts = RUNNER_ROLES.filter((r) => existsSync(path.join(ROLES, `${r}.md`))).map((role) => ({
  role,
  text: readFileSync(path.join(ROLES, `${role}.md`), "utf8").replace(/\r\n/g, "\n"),
}));
const spans = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

// The docs a prompt may name: the project context Plania appends to a session's first prompt (and the readiness
// list checks), the idea stage docs Plania checks, and the two docs a role writes on its own ticket.
const WRITTEN_BY_ROLE = ["Copy", "Security review"];
const KNOWN_DOCS = new Set<string>([...CONTEXT_DOCS, ...Object.values(STAGE_DOCS).map((s) => s.doc), ...WRITTEN_BY_ROLE]);
// A doc title in backticks: Capitalised words, or `Context: <Name>`. `Entendí:` and the like end in a colon.
const looksLikeDoc = (s: string) => /^(Context: [A-Z][a-z]+|[A-Z][a-z]+(?: [a-z]+)*)$/.test(s);

test("PLA-I2-20 check 1: every runner role has a prompt file in kit/roles", () => {
  for (const role of RUNNER_ROLES) {
    const file = path.join(ROLES, `${role}.md`);
    assert.ok(existsSync(file), `kit/roles/${role}.md is missing (PROMPT_DOCS lists ${PROMPT_DOCS[role]})`);
    const text = readFileSync(file, "utf8");
    assert.ok(text.startsWith(`# ${PROMPT_DOCS[role]}`), `kit/roles/${role}.md starts with «# ${PROMPT_DOCS[role]}»`);
  }
  for (const f of readdirSync(ROLES).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    assert.ok((RUNNER_ROLES as readonly string[]).includes(f.replace(/\.md$/, "")), `kit/roles/${f} is not a runner role`);
  }
});

test("PLA-I2-20 check 2: every doc title, skill, script and template a prompt names exists on a fresh install", () => {
  for (const { role, text } of prompts) {
    for (const s of spans(text).filter(looksLikeDoc)) assert.ok(KNOWN_DOCS.has(s), `${role}: names a doc «${s}» no install has`);

    // Skills: a slug next to the word skill must be a kit skill this role carries.
    const named = [...text.matchAll(/`([a-z][a-z0-9-]+)` skill|skill `([a-z][a-z0-9-]+)`|\(skill ([a-z][a-z0-9-]+)\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
    for (const slug of named) {
      assert.ok(skills.has(slug), `${role}: names the skill ${slug}, which is not in kit/skills/`);
      assert.ok((kits[role] ?? []).includes(slug), `${role}: names the skill ${slug}, which kits.json does not give it`);
    }

    // Scripts: a script file in a prompt only exists on the first owner's machine.
    assert.doesNotMatch(text, /[\w./-]+\.(py|sh|mjs|cjs|js|ts|rb)\b/, `${role}: names a script file`);
    assert.doesNotMatch(text, /\bscripts\//, `${role}: names a scripts/ folder`);

    // Templates: a doc's shape comes from a kit skill, never from a template outside the kit.
    assert.doesNotMatch(text, /\btemplate\b|\bPlaybook's\b/i, `${role}: cites a template or the Playbook`);

    // What existed only on the first install, by name.
    for (const gone of ["Notas del proyecto", "Verify recipe", "library-add", "library-query", "design library first (its"]) {
      assert.ok(!text.includes(gone), `${role}: names «${gone}»`);
    }
    // The design library is optional: named only together with «when your kit carries a skill for it».
    for (const line of text.split("\n").filter((l) => /design[- ]library/i.test(l))) {
      assert.match(line, /when your kit carries/i, `${role}: names the design library as if every install had one`);
    }
  }
});

test("PLA-I2-20 check 3: the readiness list and the prompts name the same project docs", () => {
  assert.deepEqual(Object.keys(CONTEXT_IDS).sort(), [...CONTEXT_DOCS].sort(), "readiness checks the context docs the runner appends");
  for (const { role, text } of prompts) {
    // Asistente works for the company, not a project: it has no project context.
    if (role === "asistente") continue;
    for (const title of CONTEXT_DOCS) assert.ok(text.includes(`\`${title}\``), `${role}: does not name ${title}`);
    for (const s of spans(text).filter((s) => s.startsWith("Context:"))) assert.ok((CONTEXT_DOCS as readonly string[]).includes(s), `${role}: names ${s}`);
  }
});

test("PLA-I2-20 check 4: no stale line, fixed start branch or fixed language in a prompt", () => {
  for (const { role, text } of prompts) {
    assert.doesNotMatch(text, /Until `thread_post` exists/, `${role}: thread_post exists`);
    assert.doesNotMatch(text, /budget/i, `${role}: budgets were removed (PLA-21)`);
    assert.doesNotMatch(text, /\b\d{1,2}:\d{2}\b/, `${role}: a fixed hour; the run says when`);
    assert.doesNotMatch(text, /\bsandbox\b/, `${role}: the start branch comes from the run`);
    assert.doesNotMatch(text, /\b(Spanish|English|español|inglés)\b/i, `${role}: the owner's language comes from the run`);
  }
});

test("PLA-I2-20: the run's prompt names the owner's language", () => {
  const prompt = userPrompt({
    agent: "Taller",
    role: "taller",
    project: { slug: "p", title: "P" },
    goal: null,
    task: { key: "P-1", title: "t" },
    workspace: { path: "/w", branch: "p-1" },
    sessionId: "s",
  });
  assert.ok(prompt.includes(`in plain ${OWNER_LANGUAGE}`), "the language line is in every run's prompt");
});
