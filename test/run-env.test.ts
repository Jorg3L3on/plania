// PLA-I2-13: what a run receives. The allow-list itself, the setting that keeps the old ANTHROPIC_* strip, the
// Motores sentence, and a scan that fails if code under src/ reads Claude's credential files or keychain entry.
// The spawn sites are covered where they are tested: runner.test.ts (runner), i57-preguntar.test.ts (Preguntar),
// i46-qa.test.ts (QA commands), i46-prueba.test.ts (test copies), brief-runner.test.ts (the brief).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { claudeSignIn, claudeSignInLine, PLANIA_OWN, projectEnvNames, runEnv } from "../src/runner/run-env.js";
import { childEnv } from "../src/runner/process.js";
import { briefChildEnv } from "../src/brief/claude.js";
import { checkoutEnv } from "../src/captures/run.js";

// Every secret Plania holds, with a value a leak would show.
const PLANIA_SECRETS: Record<string, string> = {
  DATABASE_URL: "postgres://plania:pw@localhost/plania",
  MCP_BEARER_TOKEN: "bearer-full-access",
  MCP_READ_TOKEN: "read-token",
  SESSION_SECRET: "session-secret",
  GITHUB_TOKEN: "ghp_server",
  VERCEL_TOKEN: "vercel-token",
  VAPID_PUBLIC_KEY: "vapid-pub",
  VAPID_PRIVATE_KEY: "vapid-priv",
  VAPID_SUBJECT: "mailto:x@example.com",
  PLANIA_CI_TOKEN: "ci-token",
  PLANIA_BRIEF_TOKEN: "server-brief-token",
  PLANIA_RUNNER_TOKEN: "server-runner-token",
  PLANIA_PASSWORD_HASH: "hash",
};

const BASE: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/a",
  USER: "a",
  LANG: "es_MX.UTF-8",
  LC_ALL: "es_MX.UTF-8",
  TMPDIR: "/tmp/a",
  HTTPS_PROXY: "http://proxy:3128",
  NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
  SSH_AUTH_SOCK: "/tmp/ssh.sock",
  GH_CONFIG_DIR: "/home/a/.config/gh",
  SOME_OTHER_APP_SECRET: "not-for-runs",
  ANTHROPIC_API_KEY: "sk-ant-buyer",
  ANTHROPIC_BASE_URL: "https://gateway.example",
  CLAUDE_CONFIG_DIR: "/home/a/.claude",
  ...PLANIA_SECRETS,
};

const leaked = (env: NodeJS.ProcessEnv, except: string[] = []) => Object.keys(PLANIA_SECRETS).filter((k) => !except.includes(k) && env[k] !== undefined);

test("check 1: the allow-list keeps the basics and drops every Plania secret and unknown variable", () => {
  const env = runEnv(BASE, { extra: { PLANIA_RUNNER_TOKEN: "the-run-token" } });
  assert.deepEqual(leaked(env, ["PLANIA_RUNNER_TOKEN"]), []);
  assert.equal(env.PLANIA_RUNNER_TOKEN, "the-run-token", "the run's own token, not the server's");
  for (const k of ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS", "SSH_AUTH_SOCK", "GH_CONFIG_DIR"]) assert.equal(env[k], BASE[k], k);
  assert.equal(env.SOME_OTHER_APP_SECRET, undefined);
  for (const k of PLANIA_OWN) assert.equal(env[k], undefined, k);
});

test("check 1: a project may name extra variables, never Plania's own", () => {
  const names = projectEnvNames({ runner: { env: ["SOME_OTHER_APP_SECRET", "DATABASE_URL", "MCP_BEARER_TOKEN", "PLANIA_CI_TOKEN", "bad name", 3] } });
  assert.deepEqual(names, ["SOME_OTHER_APP_SECRET"]);
  const env = runEnv(BASE, { names: ["SOME_OTHER_APP_SECRET", "DATABASE_URL", "GITHUB_TOKEN", "VAPID_PRIVATE_KEY"] });
  assert.equal(env.SOME_OTHER_APP_SECRET, "not-for-runs");
  assert.deepEqual(leaked(env), []);
  assert.deepEqual(projectEnvNames(null), []);
});

test("check 2: Claude's own variables reach the run unchanged; unset, nothing is added", () => {
  const env = childEnv(BASE, { PLANIA_RUNNER_TOKEN: "t" });
  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-buyer");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://gateway.example");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/home/a/.claude");
  // No key on the machine: the run gets no Claude variable at all, so claude uses the login it keeps itself.
  const bare = childEnv({ PATH: "/bin", HOME: "/h", ...PLANIA_SECRETS }, { PLANIA_RUNNER_TOKEN: "t" });
  assert.deepEqual(Object.keys(bare).filter((k) => /^(ANTHROPIC|CLAUDE)_/i.test(k)), []);
  assert.deepEqual(Object.keys(bare).sort(), ["HOME", "PATH", "PLANIA_RUNNER_TOKEN"]);
});

test("check 2: a cloud provider's credentials pass only while Claude is switched to it", () => {
  const aws = { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s", AWS_REGION: "us-east-1" };
  assert.equal(runEnv({ ...aws }).AWS_ACCESS_KEY_ID, undefined);
  const on = runEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: "1" });
  assert.deepEqual([on.CLAUDE_CODE_USE_BEDROCK, on.AWS_ACCESS_KEY_ID, on.AWS_SECRET_ACCESS_KEY, on.AWS_REGION], ["1", "AKIA", "s", "us-east-1"]);
  const vertex = runEnv({ CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_PROJECT_ID: "p", GOOGLE_APPLICATION_CREDENTIALS: "/k.json" });
  assert.deepEqual([vertex.CLOUD_ML_REGION, vertex.ANTHROPIC_VERTEX_PROJECT_ID, vertex.GOOGLE_APPLICATION_CREDENTIALS], ["us-east5", "p", "/k.json"]);
});

test("check 2: PLANIA_STRIP_ANTHROPIC_ENV=1 keeps the old behaviour (no ANTHROPIC_*), off by default", () => {
  const on = childEnv({ ...BASE, PLANIA_STRIP_ANTHROPIC_ENV: "1", anthropic_model: "x" }, { PLANIA_RUNNER_TOKEN: "t" });
  assert.deepEqual(Object.keys(on).filter((k) => /^ANTHROPIC_/i.test(k)), []);
  assert.equal(on.CLAUDE_CONFIG_DIR, "/home/a/.claude");
  assert.equal(on.PLANIA_STRIP_ANTHROPIC_ENV, undefined, "the setting is Plania's own");
  assert.equal(childEnv({ ...BASE, PLANIA_STRIP_ANTHROPIC_ENV: "0" }).ANTHROPIC_API_KEY, "sk-ant-buyer");
});

test("check 1: the brief gets the same list and only its read token", () => {
  const env = briefChildEnv(BASE, "brief-read");
  assert.equal(env.PLANIA_BRIEF_TOKEN, "brief-read");
  assert.deepEqual(leaked(env, ["PLANIA_BRIEF_TOKEN"]), []);
  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-buyer");
});

test("check 1: an app's commands (QA, test copies) get the basics, no Claude sign-in, and their own values as given", () => {
  const env = checkoutEnv({ PORT: "3001", DATABASE_URL: "postgres://localhost/app_copy" }, BASE);
  assert.deepEqual(leaked(env, ["DATABASE_URL"]), []);
  assert.equal(env.DATABASE_URL, "postgres://localhost/app_copy", "the copy's own database, set by Plania for it");
  assert.equal(env.PORT, "3001");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.HOME, "/home/a");
  assert.ok(env.PATH!.includes("/usr/bin"));
  // Nothing an app's own env file sets is pre-set here (Node's --env-file and dotenv do not override a set variable).
  assert.equal(checkoutEnv({}, BASE).DATABASE_URL, undefined);
  assert.equal(checkoutEnv({}, BASE).NODE_ENV, undefined);
});

test("check 4: Motores says which sign-in is in use, from variable names only", () => {
  assert.equal(claudeSignIn({}), "plan");
  assert.equal(claudeSignIn({ ANTHROPIC_API_KEY: "k" }), "key");
  assert.equal(claudeSignIn({ ANTHROPIC_AUTH_TOKEN: "k" }), "key");
  assert.equal(claudeSignIn({ ANTHROPIC_API_KEY: "k", PLANIA_STRIP_ANTHROPIC_ENV: "1" }), "plan");
  assert.equal(claudeSignIn({ CLAUDE_CODE_USE_BEDROCK: "1" }), "bedrock");
  assert.equal(claudeSignIn({ CLAUDE_CODE_USE_VERTEX: "true" }), "vertex");
  assert.equal(claudeSignIn({ CLAUDE_CODE_USE_FOUNDRY: "1" }), "foundry");
  const line = claudeSignInLine({});
  assert.match(line, /^Los agentes usan Claude con la sesión de tu plan/);
  assert.match(line, /Plania no la elige\.$/);
  assert.equal(line.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, 1, "one sentence");
  assert.match(claudeSignInLine({ ANTHROPIC_API_KEY: "k" }), /con una clave de API/);
  assert.equal(claudeSignInLine({ ANTHROPIC_API_KEY: "sk-ant-secret" }).includes("sk-ant"), false);
});

// ---- check 3: no code path reads Claude's credentials

// Claude Code keeps its login in ~/.claude/.credentials.json (Linux, WSL) or the macOS keychain item
// "Claude Code-credentials"; ~/.claude.json holds the account and, on old installs, a primary API key.
const CREDENTIAL_PATTERNS: { why: string; re: RegExp }[] = [
  { why: "Claude's credentials file", re: /\.credentials\.json/i },
  { why: "Claude's keychain item", re: /Claude Code-credentials/i },
  { why: "Claude's account file", re: /\.claude\.json/i },
  { why: "Claude's stored key or account", re: /\b(primaryApiKey|oauthAccount|claudeAiOauth)\b/ },
];
const KEYCHAIN_READ = /\b(find-generic-password|find-internet-password|dump-keychain)\b/;
// The one keychain item Plania reads is its own owner code (service plania-owner).
const OWN_KEYCHAIN_FILES = new Set(["auth/owner-store.ts"]);

function credentialReads(rel: string, text: string): string[] {
  const out = CREDENTIAL_PATTERNS.filter((p) => p.re.test(text)).map((p) => `${rel}: ${p.why}`);
  if (KEYCHAIN_READ.test(text) && !OWN_KEYCHAIN_FILES.has(rel)) out.push(`${rel}: a keychain read`);
  // Claude's folder and a credential on the same line (a deny rule naming ~/.claude/** elsewhere is fine).
  if (text.split("\n").some((l) => /["'`/\\]\.claude["'`/\\]/.test(l) && /credential/i.test(l))) out.push(`${rel}: Claude's folder and a credential`);
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(name) ? [p] : [];
  });
}

test("check 3: no code under src/ reads Claude's credential files or keychain entry (scan)", () => {
  const src = path.resolve(import.meta.dirname, "../src");
  const files = walk(src);
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  const found = files.flatMap((f) => credentialReads(path.relative(src, f).split(path.sep).join("/"), readFileSync(f, "utf8")));
  assert.deepEqual(found, []);
});

test("check 3: the scan catches the reads it is meant to", () => {
  const bad = [
    `readFileSync(path.join(homedir(), ".claude", ".credentials.json"))`,
    `execFile("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"])`,
    `JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).oauthAccount`,
    `const p = join(home, ".claude", "credentials")`,
  ];
  for (const text of bad) assert.notDeepEqual(credentialReads("x.ts", text), [], text);
  assert.deepEqual(credentialReads("auth/owner-store.ts", `["find-generic-password", "-s", "plania-owner"]`), []);
});

test("check 4: the Motores console shows the sentence", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MemoryRouter } = await import("react-router");
  (globalThis as { React?: unknown }).React = React;
  const mod = (await import(new URL("../ui/src/components/corriente/motores.tsx", import.meta.url).href)) as Record<string, any>;
  const member = { agent: "po-mia", role: "product-owner", template: "product-owner", state: "idle", now: null, last: null, produced: null, waiting: null, motor: null, used_week: { tokens: 0, share: 0 } };
  const p = { slug: "mia", title: "Mianovia", team: [member] };
  const line = claudeSignInLine({ ANTHROPIC_API_KEY: "k" });
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(mod.Motores, { p, def: { model: null, effort: null }, signIn: line, onSave: async () => undefined, planTo: "/" })),
  );
  assert.match(html, /data-motores-sign-in[^>]*>Los agentes usan Claude con una clave de API, la que tú configuraste en Claude Code; Plania no la elige\.</);
});
