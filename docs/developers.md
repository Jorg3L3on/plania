# Developing Plania

## Stack

- App: Hono on Node, one long-lived process on this machine (`scripts/dev.ts`, run as a service).
- DB: local Postgres, Drizzle over `pg`, one shared pool per process (`src/db/client.ts`).
- Screen: React SPA (Vite, shadcn/ui) in `ui/`, served by the same app; password login (argon2id + `plania_session` cookie).
- Agents: `POST /mcp` with `Authorization: Bearer <token>`: an agent token issued on screen (`/tokens`), or the
  static `MCP_BEARER_TOKEN` / `MCP_READ_TOKEN` from `.env`.
- CI: `POST /hooks/*` with `Authorization: Bearer <PLANIA_CI_TOKEN>`.

## Dev commands

```bash
pnpm dev     # API on 3738 (tsx watch) + Vite on http://localhost:5173 with hot reload
pnpm build   # typecheck server and UI, then build the SPA into dist/ui
pnpm start   # serve API, MCP and the built SPA on http://localhost:3737
pnpm test    # MCP, API, live-event, hooks, seed and backup tests; rebuilds this checkout's local plania_test_<hash> database each run
```

Port 3737 avoids the 3000 that product repos use. The server only listens on 127.0.0.1.
In dev, Vite proxies `/api` and `/mcp` to the dev API on 3738, so the service on 3737 keeps running.

Each checkout and worktree gets its own test database, `plania_test_` plus a six-character hash of the repo's absolute path,
so test runs in different worktrees can run at the same time. Tests only ever drop databases named `plania_test_*`, never `plania`.
Databases from deleted worktrees stay behind. To list and remove them:

```bash
psql -l | grep plania_test_
```

```bash
dropdb plania_test_3f9a2c
```

### Scanning a diff for personal data and secrets

`pnpm scan:diff` is a scan you can run on a diff before merging. It reports; it does not block anything. Flags, the JSON report, the local hash file, and the gitleaks pin are in [docs/scan-diff.md](scan-diff.md).

```bash
pnpm scan:diff <repo-path> [base]
pnpm scan:diff --json <repo-path> --base main --head HEAD
```

It prints `file:line` and a rule id. It does not print the matched value. Exit 0 when there are no findings, 1 when there is at least one, 2 when the scan does not finish (usage, git, or gitleaks). The allowlist is `~/.config/plania/scan-allowlist` or `PLANIA_SCAN_ALLOWLIST`: a literal value, `/regex/`, or `path:` entry per line.
