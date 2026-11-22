// PLA-I74-2: the canary's product repo. A tiny web app (a login form and two pages) in a temp folder, with a bare
// "origin" next to it holding main and sandbox, one variant locked with npm and one with pnpm. Nothing is installed:
// the canary fakes the exec layer and only asserts which install command Plania chose.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Locker = "npm" | "pnpm";
export type Fixture = { root: string; repo: string; origin: string; locker: Locker; installCommand: string };

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const FILES: Record<string, string> = {
  "server.mjs": `// The canary app: a login form and two pages. node server.mjs <port>
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const page = (name) => readFileSync(new URL(\`./pages/\${name}.html\`, import.meta.url), "utf8");
createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const signedIn = /session=ok/.test(req.headers.cookie ?? "");
  if (url.pathname === "/login" && req.method === "POST") {
    res.writeHead(303, { Location: "/", "Set-Cookie": "session=ok; Path=/" });
    return res.end();
  }
  if (url.pathname === "/login" || !signedIn) {
    res.writeHead(url.pathname === "/login" ? 200 : 303, url.pathname === "/login" ? { "Content-Type": "text/html" } : { Location: "/login" });
    return res.end(url.pathname === "/login" ? page("login") : "");
  }
  const name = url.pathname === "/" ? "home" : url.pathname === "/clientes" ? "clientes" : null;
  if (!name) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(page(name));
}).listen(port);
`,
  "pages/login.html": `<!doctype html><title>Entrar</title>
<form method="post" action="/login"><label>Correo <input name="email" type="email"></label>
<label>Contraseña <input name="password" type="password"></label><button>Entrar</button></form>
`,
  "pages/home.html": `<!doctype html><title>Inicio</title><h1>Inicio</h1><a href="/clientes">Clientes</a>
`,
  "pages/clientes.html": `<!doctype html><title>Clientes</title><h1>Clientes</h1><ul id="clientes"></ul>
`,
  "test/app.test.mjs": `import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("the two pages exist", () => {
  for (const p of ["home", "clientes"]) assert.ok(readFileSync(new URL(\`../pages/\${p}.html\`, import.meta.url), "utf8").includes("<h1>"));
});
`,
  ".gitignore": "node_modules\n.env.local\n",
};

const PACKAGE = (locker: Locker) =>
  JSON.stringify(
    {
      name: `canary-app-${locker}`,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "node server.mjs", test: "node --test test/*.test.mjs", build: "node -e \"process.exit(0)\"" },
      ...(locker === "pnpm" ? { packageManager: "pnpm@10.4.1" } : {}),
    },
    null,
    2,
  );

const LOCK: Record<Locker, [string, string]> = {
  npm: ["package-lock.json", JSON.stringify({ name: "canary-app-npm", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "canary-app-npm", version: "0.0.0" } } }, null, 2)],
  pnpm: ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n"],
};

/** Builds the repo under root/<locker>: origin (bare) with main and sandbox at the same commit, and a clone. */
export function makeFixture(root: string, locker: Locker): Fixture {
  const base = path.join(root, locker);
  const origin = path.join(base, "origin.git");
  const repo = path.join(base, "app");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "--bare", "-b", "main");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "canary");
  git(repo, "config", "user.email", "canary@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  for (const [file, body] of Object.entries({ ...FILES, "package.json": PACKAGE(locker), [LOCK[locker][0]]: LOCK[locker][1] })) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "The canary app: a login form and two pages");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "push", "-q", "origin", "main:sandbox");
  git(repo, "fetch", "-q", "origin");
  return { root: base, repo, origin, locker, installCommand: locker === "npm" ? "npm ci" : "pnpm install --frozen-lockfile" };
}

export const head = (repo: string, ref = "HEAD") => git(repo, "rev-parse", ref);
export const gitIn = git;
