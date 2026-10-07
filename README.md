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

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs
`Authorization: Bearer <MCP_BEARER_TOKEN>`; otherwise `401 {"error":"UNAUTHORIZED"}`.
The screen cookie is never accepted here.

Read tools (slice 3): `get_resume`, `get_project`, `list_tasks`, `get_task`, `get_memory`, `get_next`.
Write tools arrive in slice 4. The ceiling is 12 tools.

Contract errors come back as an MCP tool error (`isError: true`) whose text is
`{"error":"<CODE>","status":<404|409|400>}`, e.g. `{"error":"PROJECT_NOT_FOUND","status":404}`.

Local client against the dev server:

```bash
claude mcp add --transport http plania http://localhost:3000/mcp --header "Authorization: Bearer ${PLANIA_MCP_TOKEN}"
```

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by Jorge on 2026-10-06.
- Contract errors listed as HTTP codes (404, 409, 400) are returned inside the MCP tool result,
  because JSON-RPC calls share one HTTP 200 response. Only the missing-Bearer case is a real HTTP 401.

## Open before deploy

- `api/index.ts` only receives `/api/*` on Vercel by default. `/`, `/login` and `/mcp` need a rewrite
  to `/api`, which `vercel.json` (fixed by the handoff as regions only) does not have.
- `hono/vercel`'s `handle` takes a Web `Request`. On the Node runtime, a bare `export default` may receive
  Node's `req, res` instead. Hono's Node examples export named `GET`/`POST` handlers. Confirm on a preview.
