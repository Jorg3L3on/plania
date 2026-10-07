# Plania

Source of the plan for Jorge and his agents. A short resume card per project on screen, long bodies over MCP.
The plan lives here, not in each product repo.

- App: Hono on Vercel Hobby (`iad1`), one Node function at `api/index.ts`.
- DB: Neon Free (`aws-us-east-1`), Drizzle over `pg`, one pool per request.
- Screen: React SPA (Vite, shadcn/ui) in `ui/`, served by the same app; password login (argon2id + `plania_session` cookie).
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

`pnpm seed` loads the day-one data from the handoff: `micasa`, `workia`, `filmia`, `zigzag`,
with their bodies and resume cards. It is safe to rerun:

- Title and body belong to the seed. Every run rewrites them, so fix a body in `scripts/seed.ts` and rerun.
- A resume card is written only while all four fields are empty. Cards that agents updated are kept.
- `rules_text` and design pages are not in the handoff seed. Load them by editing the seed or with SQL.

## Dev

```bash
pnpm dev     # API on 3738 (tsx watch) + Vite on http://localhost:5173 with hot reload
pnpm build   # typecheck server and UI, then build the SPA into dist/ui
pnpm start   # serve API, MCP and the built SPA on http://localhost:3737
pnpm test    # MCP, API, live-event and seed tests; rebuilds this checkout's local plania_test_<hash> database each run
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

## Running locally as a service

Plania currently runs on this Mac instead of Vercel.

- Database: local Postgres 14 (Homebrew service), database `plania`.
- Server: launchd agent `com.plania.server` at `~/Library/LaunchAgents/com.plania.server.plist`.
  It starts at login, restarts on crash, and logs to `~/Library/Logs/plania/server.log`.
  It runs nvm's Node by absolute path, so update the plist after switching Node versions.
- Clients, all pointing at `http://localhost:3737/mcp` with the Bearer from `.env`:
  Claude Code (user scope), Cursor (`~/.cursor/mcp.json`), Codex (`~/.codex/config.toml`).

```bash
pnpm build && launchctl kickstart -k gui/$(id -u)/com.plania.server   # deploy code changes locally
launchctl bootout gui/$(id -u)/com.plania.server        # stop and unload
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plania.server.plist  # load again
tail -f ~/Library/Logs/plania/server.log
```

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating all three client configs.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs
`Authorization: Bearer <MCP_BEARER_TOKEN>`; otherwise `401 {"error":"UNAUTHORIZED"}`.
The screen cookie is never accepted here.

Read: `get_resume`, `get_project`, `list_tasks`, `get_task`, `get_memory`, `get_next`.
Write: `update_resume`, `create_initiative`, `create_task`, `set_task`, `set_initiative`, `add_decision`.
That is the full ceiling of 12 tools.

Contract errors come back as an MCP tool error (`isError: true`) whose text is
`{"error":"<CODE>","status":<404|409|400>}`, e.g. `{"error":"PROJECT_NOT_FOUND","status":404}`.

## Clients

`PLANIA_MCP_TOKEN` is the same value as `MCP_BEARER_TOKEN`. Local URL: `http://localhost:3737/mcp`.
Canonical URL once deployed: `https://plania.vercel.app/mcp`. On this Mac all three clients are already set up for local.

Claude Code, available in every project:

```bash
claude mcp add --scope user --transport http plania http://localhost:3737/mcp --header "Authorization: Bearer ${PLANIA_MCP_TOKEN}"
```

Cursor, in `~/.cursor/mcp.json`:

```json
{"mcpServers":{"plania":{"url":"http://localhost:3737/mcp","headers":{"Authorization":"Bearer ${env:PLANIA_MCP_TOKEN}"}}}}
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.plania]
url = "http://localhost:3737/mcp"
bearer_token_env_var = "PLANIA_MCP_TOKEN"
```

The local configs on this Mac hold the token literally, because apps launched from the Dock do not see shell variables.
For Vercel, swap the URL for the canonical one.

### In a product repo

Add something like this to the repo's `CLAUDE.md` (or `AGENTS.md`) so agents look in Plania, not in the repo, for the plan:

```markdown
## Plan

The plan for this product lives in Plania (MCP server `plania`, project `<slug>`), not in this repo.
- Start: `get_next` or `get_resume` + `get_project` + `get_memory`, then `get_task`.
- Claim: `set_task` status "In progress", note "claimed by <agent>".
- Finish a phase: `set_task` status "In review" with branch, pr_url and a note
  `Result: <✓|⚠|✗> <unit|integration|test|live|grep|subagent> — <cite>`; then `update_resume`.
- Never mark Done. Jorge does that after merging.
- Decisions: `add_decision` with one line; the full ADR stays in `docs/adr/`.
```

## Screen

`http://localhost:3737`, password login. React 19, Tailwind 4 and shadcn/ui, in light, dark or system theme.

- `/` lists projects with their resume line. `/p/<slug>` shows the resume card and the work grouped by initiative,
  with status and priority filters and a toggle for closed items.
- Rows show codes only for initiatives; tickets are known by title, since inside a project every key shares
  the same prefix. The side panel header still shows a ticket's key for talking to agents.
- Status and priority change from menus on each row. Blocked asks for its note. Done is one click on In review
  tickets and open initiatives. Every change offers Undo for 8 seconds.
- Clicking a task's title opens a side panel with its full body rendered as Markdown (PRD, scope, Done when
  checklists, notes and Result lines), plus its initiative, phases, blockers, branch and PR. The open task is in
  the URL (`?task=MIC-01-F2`), so it can be linked; Back and Escape close it.
- **Live:** agent writes over MCP appear within a second and briefly highlight the row. The header shows "En vivo"
  while the event stream is connected.

How live updates flow: every write in `src/mcp/writes.ts` publishes on the in-process bus in `src/events.ts`.
`GET /api/events` streams those as server-sent events, and the UI refetches what changed.

### JSON API (cookie only)

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/session` | Session |
| `GET /api/projects` | Projects with resume cards |
| `GET /api/projects/:slug` | Resume card and all tasks, without bodies |
| `GET /api/projects/:slug/tasks/:key` | One task with its body, in the `get_task` shape |
| `PATCH /api/projects/:slug/tasks/:key` | `{ status?, priority?, note? }`, same rules as `set_task` |
| `GET /api/events` | Server-sent change events |

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by Jorge on 2026-10-06.
- Contract errors listed as HTTP codes (404, 409, 400) are returned inside the MCP tool result,
  because JSON-RPC calls share one HTTP 200 response. Only the missing-Bearer case is a real HTTP 401.

- **UI v2, decided by Jorge on 2026-10-07:** the screen is a React SPA with shadcn/ui instead of server-rendered HTML,
  and it changes status and priority inline. That adds a cookie-only JSON API under `/api` and a server-sent event
  stream, which the handoff did not have. The handoff's screen routes (`GET /p/:slug` as HTML and the two POST Done
  routes) are replaced by the SPA and `PATCH /api/projects/:slug/tasks/:key`. Counts are still not on screen.

## Edge cases the contract does not spell out

Resolved with existing error codes, no new ones. Revisit if Asistente rules otherwise.

- `create_task` with status `Blocked` returns `BLOCKED_REQUIRES_NOTE`, because the tool takes no note.
- `create_task` with a `parent_key` that does not exist returns `TASK_NOT_FOUND`.
- A task listing itself in `blocked_by` returns `BLOCKER_NOT_FOUND`. Blockers must be in the same project.
- `set_task` on an initiative edits summary, body, branch, pr_url and notes. Its status must be an initiative status.
  Passing `priority` returns `INVALID_PRIORITY`, and passing `parent_key` returns `PARENT_MUST_BE_INITIATIVE`.
- `set_task` with `parent_key: null` turns a ticket into a standalone spec. Moving a ticket keeps its origin.
- Leaving `Blocked` clears `blocked_note`. Leaving `Done` clears `resolved_at`. Re-marking Done keeps the first timestamp.
- Note dates use the server's local calendar day.

## Open before deploy

- Live updates use an in-process bus. On Vercel each request may run in a different function, so the bus in
  `src/events.ts` must become polling or a hosted pub/sub. The UI does not change.
- The built SPA in `dist/ui` must be served by Vercel as static output, with `/api` and `/mcp` routed to the function.

- `api/index.ts` only receives `/api/*` on Vercel by default. `/`, `/login` and `/mcp` need a rewrite
  to `/api`, which `vercel.json` (fixed by the handoff as regions only) does not have.
- `hono/vercel`'s `handle` takes a Web `Request`. On the Node runtime, a bare `export default` may receive
  Node's `req, res` instead. Hono's Node examples export named `GET`/`POST` handlers. Confirm on a preview.
