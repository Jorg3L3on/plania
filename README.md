# Plania

Source of the plan for Jorge and his agents. A short resume card per project on screen, long bodies over MCP.
The plan lives here, not in each product repo.

- App: Hono on Vercel Hobby (`iad1`), one Node function at `api/index.ts`.
- DB: Neon Free (`aws-us-east-1`), Drizzle over `pg`, one pool per request.
- Screen: server-rendered HTML, password login (argon2id + `plania_session` cookie).
- Agents: `POST /mcp` with `Authorization: Bearer <MCP_BEARER_TOKEN>`.

## Setup

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
```

Fill `.env`:

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (or a local Postgres for dev) |
| `MCP_BEARER_TOKEN` | Random token, e.g. `openssl rand -hex 32`. Clients use it as `PLANIA_MCP_TOKEN`. |
| `SESSION_SECRET` | At least 32 bytes, e.g. `openssl rand -base64 48` |
| `PLANIA_PASSWORD_HASH` | Output of `pnpm hash-password`. Quote it in `.env`. Never a plain password. |

## Database

Migrations are generated here and applied by Jorge.

```bash
pnpm db:generate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/0000_curvy_wolfpack.sql
pnpm seed
```

`pnpm seed` is idempotent: it inserts `micasa`, `workia`, `filmia`, `zigzag` if missing.

## Dev

```bash
pnpm dev     # http://localhost:3000
pnpm build   # typecheck
```

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by Jorge on 2026-10-06.
