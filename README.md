# Plania

Plania keeps the plan for your projects and runs Claude Code agents (a product owner, research, design, building and
QA) that work through it while you decide. It runs on your own computer: one small server, a local database, and a page
in your browser where you follow the work and answer what only you can answer.

## Install

### What you need

A computer with Windows, macOS or Linux, 8 GB of memory and 10 GB free. The installer gets the rest: it lists what
the machine lacks (Node 22 or newer, git, Postgres), asks once, and installs it with the system's own tool (winget on
Windows, Homebrew on macOS, apt or dnf on Linux). Expect your computer's password or Windows' permission prompt.

- **macOS** needs Homebrew for that. If it's missing, the installer says so: get it from [brew.sh](https://brew.sh)
  and run the line again.
- **Postgres** installed by the installer gets a generated password, kept only in Plania's `.env`: you never type it.
  If a Postgres already answers on this machine, Plania uses it, and asks for the user name and password only if it
  can't connect on its own.
- **Claude Code** stays yours to install and sign in
  ([claude.com/claude-code](https://claude.com/claude-code)): Plania's agents run on it, and only you can sign it in.
  Plania installs without it and reminds you at the end.
- **The GitHub CLI** is only needed later, for projects with code; Plania's guide tells you when.

### One line

On macOS or Linux, in a terminal:

```bash
curl -fsSL https://github.com/Jorg3L3on/plania/releases/latest/download/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://github.com/Jorg3L3on/plania/releases/latest/download/install.ps1 | iex
```

It installs into the `plania` folder in your home folder, and asks first in case you want another. Releases live on
this repository's [GitHub Releases](https://github.com/Jorg3L3on/plania/releases); the installer checks the package
against its `.sha256` before it unpacks anything.

From a package file you already have, with the installer that came beside it:

```bash
sh install.sh --from plania-<version>.tar.gz
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -From plania-<version>.tar.gz
```

Options: `--dir <folder>` (`-Dir`) installs elsewhere, `--yes` (`-Yes`) asks nothing and installs what is missing,
`--no-service` (`-NoService`) skips the background service, `--no-open` (`-NoOpen`) leaves the browser closed, and
anything after `--` (`-InstallArgs`) goes to `pnpm plania:install`, for example
`-- --url postgres://user@localhost:5432/plania`.

### What you'll see

The installer checks your machine first and, if something it can't install is missing, stops with one sentence and
the fix before it changes anything. Then it unpacks Plania, sets up the database, starts Plania in the background and
opens your browser on the first-start page. Type your name and a password, and the guide takes you to your first
project. Nothing runs, and nothing is spent, until you press resume.

If the browser doesn't open, go to `http://localhost:3737` and type the code the installer printed last.

### Supported systems

macOS, Linux and native Windows. Plania runs as a service of your user and starts when you sign in: a launchd agent
on macOS, a systemd user unit on Linux, a Scheduled Task on Windows. WSL with systemd works as Linux. Details in
Running locally as a service.

### Help

If something goes wrong, run `pnpm help:report` in Plania's folder. It writes a text file with what's needed to help
you, with every secret hidden. It sends nothing: you choose whether to send it. When the page works, Plomería has the
same report as a button. More in [Getting help](#getting-help).

### Before selling

- **Licence.** `LICENSE` is still a placeholder, and `pnpm release:pack` warns while it is. Write the licence before
  anyone else installs Plania. Plania's copy may say that it runs Claude Code, but its own name and logo never use
  Claude's or Anthropic's names or marks.
- **Releases.** Pushing a `v<version>` tag publishes the GitHub Release the one-line installers download from
  ([docs/releasing.md](docs/releasing.md)).

## For developers

- [docs/developers.md](docs/developers.md): the stack, dev commands, test databases, scanning a diff.
- [docs/releasing.md](docs/releasing.md): packing a release, the installers, the manifest.
- [docs/upgrading.md](docs/upgrading.md): upgrade notes for 2.1 to 2.18, the agents' kit and the migration record.
- [docs/agents-kit.md](docs/agents-kit.md): what a runner agent knows, and how runs are checked.
- [CLAUDE.md](CLAUDE.md) is the map for coding agents, [GLOSSARY.md](GLOSSARY.md) has Plania's words, and
  [docs/adr/](docs/adr/README.md) the decisions already made.

The rest of this file is the reference: settings, the database, the service, updating, the MCP tools and errors, and
the screen.

## Setup by hand

What the one-line installer runs, for a git checkout or a package you unpacked yourself. Needs Node 22 or newer and
Postgres 14 or newer, installed and running, on macOS, Linux or Windows. pnpm comes from npm (corepack is not needed,
and Node 25 and newer no longer ship it); use the version that `packageManager` in `package.json` names:

```bash
npm install -g pnpm@<version>
pnpm install
pnpm plania:install
```

In a package, install with `pnpm install --prod --frozen-lockfile` and add `--service` to `pnpm plania:install`.

`pnpm plania:install` does the rest, the same from bash or PowerShell, and is safe to run again:

1. Checks the machine. Anything to fix stops the install before anything is created.
2. Creates the database `plania` on `localhost:5432`. `--database <name>` picks another name, `--url
   postgres://user@host:port/<name>` another server or role. A database that already exists is used only when this
   command made it (it carries the migration record) or when its name is given on the command line; one with tables
   and no record is refused.
3. Writes `.env` from `.env.example`: `DATABASE_URL`, and a generated `SESSION_SECRET` and `MCP_BEARER_TOKEN`
   (clients use the token as `PLANIA_MCP_TOKEN`). A value already set is kept.
4. Applies every migration and records each one (see Database).
5. Builds the screen into `dist/ui` when it is not there. `--skip-screen` leaves it as it is.
6. While Plania has no owner, prints a one-time code for the first-start screen (only its hash is stored). Running
   the install again prints a new one and the old one stops working.

Then `pnpm start`, and open `http://localhost:3737` in a browser on the same machine. The first-start screen asks
for the code, your name, a password (12 characters or more) and your time zone (taken from the browser), and links
the machine check so you see what is missing before finishing. In one write it makes the home project, the `ceo` and
`asistente` rows, the runner and brief tokens, and stores the password hash, the tokens and the zone in the database
(`install_state`, migration 0063). No `pnpm hash-password`, `seed-org`, `/tokens`, `.env` edit or restart. The company
starts paused, with wakes on while `PLANIA_JOBS` is unset: nothing runs until you press resume. The screen answers
only on loopback (not through `tailscale serve`) and closes for good once an owner exists. Values set in `.env`
(`PLANIA_PASSWORD_HASH`, `PLANIA_RUNNER_TOKEN`, `PLANIA_BRIEF_TOKEN`, `PLANIA_TZ`, `PLANIA_JOBS`) still win, so an
install configured by hand is unchanged and never sees the first-start screen. Ten wrong passwords in a minute and the
login waits before the next try. At start the server checks that the database is reachable and has no unapplied migration; when
either fails it says so in one sentence and exits.

The other settings in `.env` are optional:

| Var | Value |
|---|---|
| `PLANIA_PASSWORD_HASH` | The screen's password, as the output of `pnpm hash-password`. Quote it in `.env`. Never a plain password. Wins over the one made at first start; when set, first start never opens. |
| `MCP_READ_TOKEN` | A second token for planning sessions: read tools only. |
| `PLANIA_CI_TOKEN` | Token for `/hooks/*` only; it cannot use `/mcp`. |
| `PLANIA_TZ` | Time zone the screen shows times in, and the nightly backup's clock. Default: the zone chosen at first start, else `UTC`. |
| `PLANIA_PG_BIN` | Directory of the `pg_dump` and `psql` Plania uses. Default: the one for the server's major version (Homebrew, `/usr/lib/postgresql/<N>/bin`, `/usr/pgsql-<N>/bin`), else the one on `PATH`. |
| `PLANIA_OWNER_SECRET_FILE` | Where the owner's code lives off macOS's keychain (Linux, or a Mac without `security`). Default `~/.config/plania/owner-secret`, mode `0600`. |
| `PLANIA_BACKUP_DIR` | Where the nightly dumps go. Default `~/plania-backups`. |

### A first project on a new install

No SQL by hand and no `plania` project needed:

1. Run `pnpm plania:install` (above).
2. Check the role prompts. The four seats a project starts with (product owner, Research, Artist, Taller) each
   need one. They come with the repo in `kit/roles/<role>.md` (`product-owner.md`, `research.md`, `artist.md`,
   `taller.md`) once the owner has exported them from the live server with `pnpm kit:export` and committed them.
   A project-level doc `Prompt: <Role>` in the project named by `PLANIA_PROMPTS_PROJECT` (default `plania`)
   replaces the file for that role when it exists; neither the project nor the doc has to exist.
3. Start Plania (`pnpm start`, or the service) and finish first start (above), or sign in on the screen.
4. Press «+ Nuevo proyecto», give it a name and a one-sentence goal. The project is created paused, with its team;
   resume it to wake its product owner. If a seat has no prompt, the sheet names it and nothing is created: add
   its file to `kit/roles/` (or its doc) and try again.

`pnpm project:add` (see Database) creates the same project from the shell and does not check the prompts; a seat
without one fails its first run with `no prompt doc`.

## Database

Migrations are generated here (`pnpm db:generate`) and applied with `pnpm db:migrate`. It applies, in file-name
order, every file not yet recorded in `plania_migrations` (name, checksum, applied at), each in its own transaction
together with its record. It stops at the first failure and names the file; the database stays as it was before that
file. A recorded file whose content changed is reported, never re-applied. The record is what makes this safe: most
files before 0027 fail when run twice.

`pnpm db:migrate` works on the database in `.env` only when it already carries the record. Any other database is
named on the command line: `pnpm db:migrate --database <name>` bootstraps the record on an empty one.

A database that already has the migrations and no record (one set up before the record existed) is marked once,
without running anything, up to the last file applied to it:

```bash
pnpm db:migrate --database <name> --baseline 0061_run_kit.sql
```

That is the only way in for a database with tables and no record. Afterwards `pnpm db:migrate` applies only newer
files.

Then add your own projects. Each one comes with its team (product owner, Research, Artist, Taller), starts
paused with plan approval on, and gets a key prefix from its slug unless `--prefix` names one:

```bash
pnpm project:add <slug> --title "<Title>" [--prefix <PFX>] [--repo owner/name] [--path /abs/repo]
pnpm tsx --env-file=.env scripts/seed-org.ts
```

`--path` is the repo on this machine (default `PLANIA_PROJECTS_ROOT/<slug>`, else the folder chosen at first start, else `~/plania/projects/<slug>`).
`--repo` is its GitHub `owner/name`. Both are safe to rerun.

Projects come from first start, the screen or `pnpm project:add`; nothing is preloaded.

### GitHub token file

The GitHub poller used to run `gh auth token`, which reads the login keychain through `security`. With the keychain locked that call hit its timeout and left `security` waiting on the dialog, and every cache expiry started another. The poller now takes the token in this order: the env var named by `settings.github.token_env` (default `GITHUB_TOKEN`; that variable still wins), then `~/.config/plania/github-token` (`PLANIA_GITHUB_TOKEN_FILE` overrides the path). The file is one trimmed line. Empty or more than one line counts as no token. The poller stats the file on every tick and re-reads it when the mtime or size changes. A mode that lets the group or others read it still works; the log gets one note per mtime and never the token. With no token it does not call GitHub and does not spawn anything, and `poll_state.error` is `no token: GITHUB_TOKEN unset, ~/.config/plania/github-token missing or empty`.

`gh auth token` runs only when `PLANIA_GH_FALLBACK=1`, detached in its own process group, with a 5 second timeout that kills the group. A token is cached for 10 minutes; a failure is not retried for an hour. That attempt, and the hour it is remembered, keeps the missing-file text and adds that `gh auth token` failed (`timeout`, `missing`, `exit`, or `empty`).

Lanzar (`settings.release.mode` `merge`) uses the same helper (60 seconds) and sets `GH_TOKEN` from `~/.config/plania/github-release-token`, else `~/.config/plania/github-token`, plus `GH_PROMPT_DISABLED=1`. With no token and the fallback off it returns `RELEASE_MERGE_FAILED` (`step` `token`, `falta token: …`) and starts no process. A 403 from GitHub adds a hint that the token needs write access to contents and pull requests.

### What a run receives

No migration. Every process Plania starts for work (an agent run, a Preguntar run, the Morning brief, a QA command,
a test copy, the capture browser) gets its environment from one allow-list, `src/runner/run-env.ts`:

- system basics: `PATH`, `HOME`, user, shell, locale (`LANG`, `LC_*`), `TZ`, the temp dir, `XDG_*`, and the Windows
  names for the same where WSL passes them;
- what git, gh and Node need: `SSH_AUTH_SOCK`, `GH_CONFIG_DIR`, the proxy variables (`HTTPS_PROXY`, `NO_PROXY`, …)
  and the CA variables (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, …);
- Claude Code's own variables, untouched: `ANTHROPIC_*`, `CLAUDE_*` (including `CLAUDE_CODE_USE_BEDROCK`,
  `_VERTEX`, `_FOUNDRY`), and the provider's credentials (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`) only while
  that provider is switched on. App commands (QA, test copies) get none of these;
- the run's own values: its token (`PLANIA_RUNNER_TOKEN`, or `PLANIA_BRIEF_TOKEN` for the brief), `PORT`, a test
  copy's own database URL;
- the names a project lists in `settings.runner.env` (for example `["STRIPE_TEST_KEY"]`), agent runs only.

Never Plania's own: `DATABASE_URL`, `MCP_BEARER_TOKEN`, `MCP_READ_TOKEN`, `SESSION_SECRET`, `GITHUB_TOKEN`,
`VERCEL_TOKEN`, the VAPID keys, or anything named `PLANIA_*`, even when a project names it. A test copy still
reads its app's own env file: nothing that file sets is pre-set by Plania.

Claude signs in the way you set it up (your plan's login, an API key, or a cloud provider); Plania does not choose
and never reads Claude's credential files or keychain entry (`test/run-env.test.ts` scans `src/` for that).
Motores says in one sentence which sign-in is in use. Before this change a run got the server's whole environment
minus `ANTHROPIC_*`, which forced the plan's login; to keep that, set `PLANIA_STRIP_ANTHROPIC_ENV=1` (off by
default).

## Human-only questions

`ask` with `human_only: true` makes a question only the owner's screen can answer. `answer` from an agent returns `HUMAN_ONLY`, including from actor agent `plania-bot`. The screen session cookie is the only proof on that path. `POST /api/projects/:slug/questions/:id/answer` stores `answered_by` as the screen actor. It refuses a request that carries `Authorization: Bearer`, and it refuses an actor sent in the body or in a header. The MCP bearer never opens `/api`. On the screen every open question has its option buttons and a free answer. The Bandeja also has the kill switch «El bot puede responder por ti» (default on) and every delegated answer with the «Delegada» badge, the quote and the time.

Questions asked before 2.17 that carried a letter (A, B or C) are history in `question.archived` events (see [Upgrading to 2.18](docs/upgrading.md#upgrading-to-218-direct-moves)). They are not stored on the question and they change nothing.

### Delegated answers

When the owner is away from the machine he can tell the Plania bot (actor agent exactly `plania-bot`) in his own chat what to answer. That bot calls MCP `answer_delegated` on the existing write token. The call answers one human_only question that has named options with one of those options. An `approval_id` on that call is ignored. Required: `delegated_by_owner.message_id` (8 to 200 characters) and `delegated_by_owner.quote` (8 to 280 characters). Empty or short evidence is `DELEGATION_EVIDENCE`. Any other agent, including `owner` (`RESERVED_ACTOR`) and a caller that spoofs the screen session, is refused. The normal `answer` tool stays `HUMAN_ONLY`.

Won't do and reopening are not this tool. Any agent calls `set_task` with `reason` and the same `delegated_by_owner` evidence. The screen does it with the reason alone. Both are logged. Agent moves join this delegated list.

The answer or decision is stored as the owner's (the screen actor). `delegated_answers` keeps the message id, the quote, the delegating actor and the time. The audit lists each one as `DELEGATED_ANSWER` (warn) for review.

Limits: 10 delegated answers and agent Won't do or reopen moves per hour, and one answer per question (`DELEGATION_LIMIT`). The kill switch defaults on. Off, the tool and those agent moves return `DELEGATION_OFF`. The switch is `POST /api/delegation` with the session cookie. No cookie is 401. A Bearer is 403, with or without the cookie. MCP, `/hooks` and `/bot/v1` cannot toggle it, and the bot cannot raise its own limit.

Honest limit: the actor `plania-bot` is an identity declared in the request, and all bots on the machine share the same write token, so the server cannot technically prove that the caller is the Plania bot or that the quoted message really exists. The controls are the required evidence (message id and quote), the audit plus the visible badge, the rate limit, the kill switch, and the rule that only the owner's own message counts. This is not a proof of identity. Do not treat it as one.

What proves a human on this machine answered, on the click path, is the screen session only. A bot that has the MCP bearer, or that sends the screen actor in a header or a body, cannot use that path. A process that can mint a session cookie can. The delegated path is the narrow exception above, and it does not prove the message.

## Running locally as a service

`pnpm service:install` (or `pnpm plania:install --service`) leaves Plania running as a service of the user who runs
it, from the folder it is run in, on port 3737: it starts at login, restarts when it crashes, and runs the Node that
ran the command, with that shell's `PATH` (so it finds `claude`, `git` and `gh`). Run it again after moving the folder
or switching Node versions. `pnpm service:uninstall` stops it and removes the service; data and logs stay.

Supported on macOS, Linux and native Windows:

| | macOS | Linux (and WSL with systemd) |
|---|---|---|
| Service | launchd agent `com.plania.server`, `~/Library/LaunchAgents/com.plania.server.plist` | systemd user unit `~/.config/systemd/user/plania.service` |
| Logs | `~/Library/Logs/plania/server.log` | `~/.local/state/plania/server.log`, and the user journal (`journalctl --user -u plania -f`) |
| Starts | at login | at login; `--at-boot` also runs `loginctl enable-linger` so it starts at boot |
| Restart by hand | `launchctl kickstart -k gui/$(id -u)/com.plania.server` | `systemctl --user restart plania.service` |
| Stop | `launchctl bootout gui/$(id -u)/com.plania.server` | `systemctl --user stop plania.service` |

On Windows the service is a Scheduled Task of your user that starts Plania when you sign in; no administrator shell is
needed. WSL without systemd: the command changes nothing and says how to turn systemd on (`[boot]` `systemd=true` in
`/etc/wsl.conf`, then `wsl --shutdown`); until then start Plania by hand with `pnpm start`.

`pnpm server:restart` restarts the service on either system, and refuses while a run, a QA check or a test copy's pass
is in flight (`--check` lists them, `--force` restarts anyway). In a checkout the restart is the deploy: the server
rebuilds `dist/ui` at start when its stamp is not HEAD.

PLA-I2-9: the live server changes only when you restart it. After a restart, `pnpm server:restart` waits up to two
minutes for `/health/ui` to report the commit (or version) the folder holds. If it never does, it checks out the last
commit that started well (detached) and restarts again, and says so; your checkout is then on that commit with no
branch. The service records a good start in `~/.config/plania/last-good.json` (`PLANIA_LAST_GOOD_FILE`) once it has
been up for 30 seconds; dev servers and test copies (`PLANIA_JOBS=0`) never do. A release package cannot go back by
itself: the restart names the last version that started.

When a project's repo is this server's own checkout (Plania working on Plania, `src/self/plania-self.ts`): its test
copies get a new database of their own (`<live>_prueba`, `<live>_entrega`, built from the copy's migrations), a
rewritten env file with `PLANIA_JOBS=0`, and never the live port; its runs carry extra deny rules (no live database,
no migrations, no restart) and do not start when their folder points at the live database. Migrations agents wrote in
its deliveries are listed on its Máquinas page, for you to apply with `pnpm db:migrate`.

Deploy note: the service reads `~/.config/plania/github-token` itself. It does not run `gh`, and it does not read the macOS keychain, unless `PLANIA_GH_FALLBACK=1`. `pnpm server:restart` is enough after a code deploy; the plist or unit stays as it is. A group-readable token file still works and logs one line, with no token in it.

To let the GitHub poller read your repos, create a read-only fine-grained GitHub token and save it as one line in
`~/.config/plania/github-token`, readable only by you (see GitHub token file). Plania works without it.

Backups: the `backup` job dumps the database once a day after 03:00 (`PLANIA_TZ`) into
`~/plania-backups/plania-<YYYYMMDD>.sql.gz` and keeps the last 14; hand-made `plania-pre-*` dumps stay. The Máquina
page shows the last copy, and `BACKUP_STALE` appears there when the last one is older than 48 h. To bring one back,
see "Restoring a backup".

Change the screen password with `pnpm hash-password`, paste the result into `.env` as
`PLANIA_PASSWORD_HASH='...'`, then restart. Rotating `MCP_BEARER_TOKEN` means updating every client that uses it (see Clients).

## Updating

A new version arrives as a package file (`plania-<version>.tar.gz`, with its `.sha256` beside it). Plania never
fetches it: download it, then from the installed folder:

```bash
pnpm update:plania ~/Downloads/plania-0.2.0.tar.gz
```

Each step says one sentence (PLA-I2-8, `src/update/index.ts`):

1. Refuses while a run, a QA check or a test copy's pass is in flight, as `pnpm server:restart` does.
2. Opens the package beside the install, checks its `.sha256` when present and its `release.json`, and refuses a
   version that is not newer.
3. Installs its production dependencies there (`pnpm install --prod --frozen-lockfile`). Nothing is built.
4. Backs up the database into the backup folder as `plania-pre-update-<from>-to-<to>-<time>.sql.gz`, which the
   nightly pruning never removes.
5. Stops the service. Without one, stop Plania yourself and pass `--no-service`.
6. Swaps the program files: the install folder becomes `<folder>.previous-<from>` (only the latest is kept) and the
   new release takes its place. `.env` comes across. Kit files you edited are never overwritten: yours go into the new
   files, and when the release changed the same file its version is put in `kit.new/` for you to compare.
7. Checks that a backup from today exists, then applies the new migrations in one transaction.
8. Role prompts nobody edited in Plania take the release's text (`kit:sync` without `--force`); ones you edited in
   Plania stay and are reported.
9. Starts the service and points at the release notes, `http://localhost:3737/novedades`. That page also lists what
   the update kept of your kit and what to do; Plomería shows a hint while something waits.

A failure before step 5 changes nothing. A failure at step 6 or 7 puts the previous folder back, starts it, and names
the backup and the restore command. The migration is all or nothing, so the database is as it was and the old
version passes its start-up check. To go back by hand after a successful update: stop the service, swap the folder
with `<folder>.previous-<from>`, restore the pre-update backup, start the service.

## Restoring a backup

```bash
pnpm restore:plania ~/plania-backups/plania-20261016.sql.gz --database plania_restore
pnpm restore:plania <file> --database plania --overwrite --confirm plania
```

It creates the named database when it does not exist and loads the dump with `psql` (`ON_ERROR_STOP`; the `psql` of
the server's major version, `PLANIA_PG_BIN` first). A database that already holds tables is replaced only when asked
twice, `--overwrite` and its name again in `--confirm`; it is then dropped and made again. Stop Plania before
replacing the database it uses. `--url` names another server.

## Morning brief

A daily brief of every project, made by a headless `claude -p` on this machine with the owner's own Claude subscription
(no API key, nothing paid) and shown in Compañía (`/ceo?v=brief`). It runs once a day at `run_at` (default 07:00, local time) and on
"Generate now". Passes A (brief) and B (ideas) are read-only: they read Plania with a read token and each repo with
`git`, and write nothing.

To turn it on:

1. Apply migration `0045` (take a dump first, like every migration):

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/migrations/0045_morning_brief.sql
   ```

2. On `/tokens`, issue a token with read scope (name it `morning-brief`) and put it in `.env` as `PLANIA_BRIEF_TOKEN`.
   Without it the brief falls back to `MCP_READ_TOKEN`, and with neither it stores a facts-only brief that says so.
   If `.env` has no `PLANIA_RUNNER_TOKEN` yet (the agent runner uses it too), issue one with write scope there as well:
   Send to Plania wakes each project's product owner with it.
3. Make sure `claude` is installed and logged in with your subscription: run `claude` once and log in. The brief uses
   `CLAUDE_CODE_BIN` when it is set, else `~/.local/bin/claude`, else the `claude` on `PATH`, like the runner.
4. Run the setup check. Every line should be ✓; each ✗ line says what to fix. It never prints a token or a path.

   ```bash
   pnpm brief:doctor                 # includes a short claude dry run (one small turn on your plan)
   pnpm brief:doctor --skip-claude   # everything except that dry run
   ```

5. Build and restart the service:

   ```bash
   pnpm build && launchctl kickstart -k gui/$(id -u)/com.plania.server
   ```

Then open Compañía → Brief (`/ceo?v=brief`) and press "Generar ahora" (or `pnpm brief:run`). The first brief takes a few minutes.

What the doctor checks: claude found and its version; claude logged in (the dry run also confirms the result carries
`structured_output`); read token set; runner token set (`PLANIA_RUNNER_TOKEN`, needed for Send to Plania); GitHub
token readable (`GITHUB_TOKEN`, else `~/.config/plania/github-token`, see GitHub token file); each included
project's repo path exists; the brief settings (saved or first-run defaults, on or off) and a valid time zone; each
included project's product owner and the home project (both for Send to Plania); the prompts folder
`prompts/morning-brief` is present; migration `0045` applied. The same lines, without the claude dry run, are the
"Setup check" at the bottom of the brief's settings sheet (Ajustes) (`GET /api/brief/doctor`).

First-run defaults (change them in the brief's Ajustes): on, 07:00, time zone `PLANIA_TZ` (else
the zone chosen at first start, else `UTC`; the label is the city name unless you set one), language `es` (migration `0051` moved a saved `en` to `es`; English stays one setting away), owner name `PLANIA_CEO_NAME` (else "the owner"), every project included, each
project's idea letter taken from its key prefix (X is for cross ideas), no hidden refs, facts-only fallback at 11:00.
A project's repo is `settings.local.repo_path`, else `PLANIA_PROJECTS_ROOT/<slug>`. Its GitHub repo is
`settings.github.repo`. Send to Plania needs a product-owner agent per project (`po-<slug>`, made by
`create_company_project`, or `scripts/seed-org.ts` above); cross ideas go to `PLANIA_HOME_PROJECT` (default `plania`;
set it to one of your projects if you have no `plania` project). The doctor checks both.

### The page: Brief in Compañía, la desembocadura (PLA-I63)

The brief is a tab of Compañía, after Plomería: `/ceo?v=brief` (the old `/brief` address redirects there, so saved
links and notices still work; Brief is no longer in the app bar). Its count is what still waits on you in today's brief
(open blockers and «te toca»). It is drawn in La corriente's look as a delta: one stream per project of the brief, in
brief order, then "Entre apps". On a stream, new ideas spark near the source, what follows is a violet light with its
key, what waits on you is an amber rhombus with its verb, and a blocker is an amber dam that cuts the stream (dotted
after it). A stream is as wide as what it carries; it holds at most three ideas and five rows, the rest behind «+N».
Every stream meets at «Tú» (amber while something waits on you, violet when nothing does); what you settle leaves by
the green river of Resuelto, which grows through the day. The headline is one sentence that rewrites itself as you
settle things («Dieciséis cosas esta mañana. Una bloquea y cuatro te esperan.»). The tools are Generar ahora (a menu:
Pendientes e ideas, Solo pendientes, Solo ideas, each with its time; it sends `passes` to `POST /api/brief/run`), Días
anteriores (`?dia=YYYY-MM-DD`, read-only, Volver a hoy) and Ajustes (the settings sheet).

The card in hand, at the right, shows what Plania says now about the picked light and every action its row offers, in
Compañía's words (Aceptar, Pedir ajuste, Publicar, Paso, Entrega): one white button (Enter), the rest secondary, the
cost line before waking someone, Después (L) and No aplica (X). A settled light drops into the river with its stamp and
time; Deshacer (on the card, in the footer, or Z) brings it back; the next open light of the same project is picked.
Keys: J/K or ↑/↓ move, ← → change project, Enter, L, X, Z, Esc; nothing acts while typing. «Ver KEY» opens the paso or
idea in Compañía; only GitHub leaves the page. A failed run keeps the brief and says when and why in the footer, with
«Cómo arreglarlo» and Reintentar; a missing part says so. Ideas already in Plania are not drawn (they live in each
project's Ideas tab). Under 640 px the delta is a list per project with the card under the chosen light.

### Acting from the brief (V2)

Every row knows the Plania object it is about (a question, a human
step, the release, a PR, a ticket, an initiative, an idea, a paused project, an env record or an audit finding): pass A
names it from `facts.json` handles and the server checks the handle, else reads the row's ref, URL and action.

Each action runs the same server function as the button it mirrors elsewhere in Plania, through
`POST /api/brief/act` (screen cookie only; a Bearer token is refused). Three levels:

- **Instant, with Undo:** Later, Not relevant, Postpone, Put first, Put on hold, Keep (ideas), Discard (ideas). Answer
  and Done on a step are instant too, with no Undo.
- **Confirm first:** Publish to main (only when the release can ship), Accept into sandbox, Ask for changes, Add to
  PR, Turn on runs, Fix it. The box says exactly what will happen.
- **Wake, with a cost line first:** Give to PO (any row), Start now (a Ready ticket), Start building (an initiative's
  first open phase), and for ideas Plan it, Sketch it, Research it. The line says who wakes, about how long, that it
  uses your plan ($0), and that it waits when the project's runs are paused. The row then follows the run.

Rows read Plania every 30 s while the tab is open, so a row handled in Bandeja or Compañía leaves by itself. A retry
with the same request id writes once; a row whose object moved meanwhile answers "stale" and refreshes. Later keeps a
row out until its date; Not relevant keeps it out of the next briefs. Discarded ideas are passed to the ideas prompt
for 60 days so they are not proposed again; an idea shown in 3 briefs with no action is dropped. A past day shows its
outcomes and no buttons. Migration `0050` adds `brief_actions`, one row per action; `0051` makes Spanish the default.

## MCP

`POST /mcp`, stateless JSON (no sessions, no GET listen stream). Every call needs a Bearer token;
otherwise `401 {"error":"UNAUTHORIZED"}`. The screen cookie is never accepted here.
`MCP_BEARER_TOKEN` sees every tool; `MCP_READ_TOKEN` sees only the read tools.

The working protocol (Start / Work / Finish, under 900 words since 2.13; each tool's own rules live in its
description) is served as the server's `instructions`
on `initialize`, versioned (`PROTOCOL_VERSION` in `src/mcp/protocol.ts`, also in `get_project`). Project-specific
additions are the project's `rules` (`set_project`). Product repos point here instead of copying the rules.

### Readiness

`get_resume`, `list_projects`, `get_digest` and `GET /api/projects` add `readiness`: `{ state, reasons, line }`. It is read-only. Nothing is written and the schema does not change. Existing fields keep their shape. `line` is one sentence. Each reason is `{ code, severity, text, task_key }`. `text` is one short Spanish sentence and names the ticket key (for example `MC-12: el dueño ya no está en la máquina`). The screen shows that `text`. It does not recompute readiness or rewrite the sentence.

`state` is `ready`, `caution`, `blocked` or `no_context`. Precedence is `no_context`, then `blocked`, then `caution`, otherwise `ready`.

`no_context` (`NO_CONTEXT`): no live claim, no expired claim, no ticket In review, no initiative `next_action`, no next claimable ticket, and no event in 14 days (`CONTEXT_WINDOW_DAYS` in `src/mcp/readiness.ts`).

`blocked`: the ticket to resume has an unsatisfied blocker or is Blocked (`BLOCKER_OPEN`); its pull request `ci_state` is `failure` (`CI_FAILURE`); a failed deploy (the Vercel poller's last error) or an environment behind the integration branch blocks a ticket In review (`DEPLOY_BLOCKED`); two live claims overlap `areas` (`AREAS_OVERLAP`); that ticket waits on a human decision (`DECISION_PENDING`: an open question, a pending approval, or a `human_action` blocker).

`caution`: an expired lease (`LEASE_EXPIRED`); the owner's footprint is old or missing on the machine (`OWNER_ABSENT`, fresh window `FOOTPRINT_FRESH_MS`); the claim has been quiet past `PLANIA_QUIET_MIN` (`CLAIM_QUIET`, default 20 minutes, the same constant as `get_running`); a dirty worktree (`WORKTREE_DIRTY`); dirty unknown (`DIRTY_UNKNOWN`); an environment with no known commit, or an open initiative's integration branch with no head, while a ticket is In review (`ENV_UNKNOWN`); a stale headline or state note (`NOTE_STALE`); a pending pull-request check (`PR_PENDING`); an unreadable pull request (`PR_UNREADABLE`); a human decision on some other ticket (`DECISION_ELSEWHERE`); a recent event and no step to resume (`NO_NEXT`).

`ready`: a healthy live claim, a ticket In review whose checks are passing, or a clear next step, and none of the above.

Unknown or missing data is caution, never ready. `details.dirty` null, a live claim with no footprint row, a pull request whose `ci_state` cannot be read, a missing environment commit, and an integration branch with no head are caution. A missing commit or head is not treated as up to date. A footprint that is not fresh counts as the owner gone; dirty is read only on a fresh worktree. No environment rows and a known head is not `ENV_UNKNOWN`: there is nothing to compare.

<!-- mcp-tools:start -->
| Read | |
|---|---|
| `get_resume` | Where the project stands, generated from data: live claims (who, until when, where), requests (the owner's open asks from the screen, newest first: read them first), the next claimable ticket, and per open initiative its derived state {phase_now, done, total, in_progress, in_review, waiting_on, line}, the notes (state_note, in_progress, next_action with next_claimable), must_keep (pinned decisions) and status counts, plus readiness. |
| `get_project` | Project title, long body (stack, repo, prod, constraints), rules (project-specific additions to the protocol in the server instructions) with rules_version, protocol_version, headline (the note set_project writes; get_resume has the generated line), settings (release_target, branch_pattern, claim_from, resources, quotas, github, vercel, release), ticket counts, env (per environment: commit, branch, migrations, flags, deployed_at and its source), branches (each with its owner, head and merge state), resources (live leases, today's quotas), metrics, reserved sequence numbers with the ticket holding each, and release: the step settings.release names (from → into), with how far from is ahead, the merged tickets it ships, their migrations, the before-steps, open checks, the command the owner runs, its mode (command, or merge: the owner ships it from the screen) and merged once they did (null without settings.release). |
| `list_tasks` | Initiatives, tickets and ideas without scope, with version, claimed_by (live lease owner or null) and updated_at. |
| `get_task` | One initiative or ticket, by its key or any former key (aliases). |
| `get_memory` | Fixed memory: rules, design_docs (project docs, with markdown; view summary lists them without it), and the decision log, newest first (limit default 100, max 500). |
| `get_doc` | One doc by id (from get_task docs, get_memory design_docs, or a decision's adr_doc_id), with its markdown and version. |
| `get_next` | Next claimable ticket: Backlog or Ready, or In progress with an expired lease (stale_claim: true), with every blocker satisfied (tasks In review or Done, env conditions holding). |
| `list_events` | What changed, oldest first: every write is an event with its actor, server time, project and a one-line summary (in the owner's language). |
| `list_projects` | Every project in one line each: slug, title, key_prefix, headline, line (what is claimed, else the next step, else what is next to claim, else the last event, else empty), ticket counts (open, in_progress, in_review, needs_owner, blocked, done), open_questions, claims, last_event_id and last_event_at, and readiness (state, reasons, line; same object as get_resume), sorted by slug. |
| `get_running` | Every ticket with an owner, across projects, with a derived liveness: live (lease valid, activity in the last 20 min), quiet (lease valid, no heartbeat or event for longer), stale (lease ran out, not yet cleared). |
| `get_digest` | One call for an assistant that keeps the owner updated: what changed since a cursor, grouped by project with summaries in the owner's language and highlights (done, to_review, blocked, needs_owner, prs_opened, prs_merged, claims), what runs now (get_running) and what waits on the owner (get_inbox all), plus unchanged_projects and readiness (state, reasons, line) on each changed project. |
| `get_inbox` | Everything waiting on the owner, oldest first per kind, each item with its group: decisiones (open questions), pasos (human actions a task waits on, the project's release) and limpieza (what agents left on the machine). |
| `audit` | What the server can see is wrong, from data it has: REVIEW_PR_MERGED, REVIEW_NOBODYS_TURN, DONE_CHECKS_OPEN, MERGED_CHECKS_OPEN, INITIATIVE_CHILDREN_DONE, INITIATIVE_SCOPE_HAS_STATUS, DECISION_STALE_REF, DECISION_CONTRADICTS_DONE, ENV_DEPLOYED_AT_MISSING, ENV_DRIFT, BLOCKED_BUT_SATISFIED, CLAIMABLE_BUT_WAITING, CLAIM_EXPIRED_WITH_COMMITS, BRANCH_MERGED_NOT_DELETED, BRANCH_WITHOUT_TICKET, TASK_MISSING_PR_URL, WAITING_ON_OWNER_FREE_TEXT, OVERDUE, PR_WITHOUT_PLANIA_KEY, PR_MERGED_TICKET_OPEN, DELEGATED_ANSWER, WONT_DO_WITHOUT_EVIDENCE, and the footprint codes. |
| `get_context` | One call for a session opening a worktree: from workspace {branch, worktree_path, machine} (and your session_id) it returns the initiative on that branch, the tickets on it, your live claims (with any handoff note), the pinned decisions that apply, open questions on those tickets, the footprint they have on the machine (footprint) and what your session registered (my_footprint), the events since since_cursor that touch them, and requests (the owner's open asks from the screen, newest first, read them first). |
| `list_agents` | The company roster: every bot, coder and human, with role, title, adapter, heartbeat, who they report to, capabilities, kind, status, last check-in and note. |
| `list_goals` | Company goals and the project goals under them. |
| `list_routine_runs` | Routine runs, newest first. |
| `usage_summary` | Totals of reported tokens per agent, project and week (input, output, cache_read, cache_create). |
| `list_heartbeat_runs` | Recent heartbeat runs: agent, status, adapter, summary and task key, newest first. |
| `thread_read` | Read a thread's messages, oldest first (the last 200, or only those after `after`: an ISO time or a message id). |

| Write | |
|---|---|
| `start` | Open a ticket in one call: claim on key (In progress, your lease) plus get_context for the workspace. |
| `finish` | Close your part of a ticket in one transaction: add_result (result: kind, verdict, cite, commit, command, counts, check_ns...) then set_task status In review with branch and pr_url. |
| `create_task` | Create a ticket (default), an initiative, or an idea. |
| `set_task` | Update a ticket, an initiative or an idea. |
| `set_check` | Tick (or untick) one Done when item by its n, amend its text, or lift a waiver. |
| `add_result` | Record evidence on a task: kind, verdict pass\|warn\|fail, cite (what ran and what it showed), url (CI run, screenshot, recording), and the structured fields: commit, branch, env, command, exit_code, counts, duration_s, attachments, viewport, device, metrics. |
| `attach_doc` | Store a markdown doc in Plania so every machine can read it: a spec or plan on a task (key), or a project doc such as a design page (no key). |
| `attach_frames` | Artist: put the design's frames on an idea so the owner sees them on the screen (the idea's Diseño stop and its review table). |
| `claim` | Lease a ticket so no other session works on it. |
| `add_decision` | Append one decision to the log. |
| `reserve_sequence` | Reserve the next number of a per-project sequence (e.g. name 'migration' gives '0009') for a ticket, so two initiatives never take the same one. |
| `ask` | Ask the owner a question about a task, in Plania rather than only in your chat, so any session can see it and its answer. |
| `answer` | Record the owner's answer to a question that is not human_only (they answer those on the screen; otherwise they may tell you in chat and you record it here, quoting them). |
| `answer_delegated` | Record one answer the owner gave actor agent plania-bot in their own chat. |
| `set_project` | Edit the project's title, body (stack, repo, prod, constraints), rules (project-specific additions to the protocol) or headline. |
| `set_env` | Record what an environment runs, as data other sessions can check: commit and branch deployed, migrations (the tags applied, e.g. ['0009_x']; migrations_applied is derived), flags (configuration state, never secret values: {google_oauth: false, omdb_key: 'valid'}; null removes one). |
| `waive_check` | Mark one Done when item as not going to be done, with the reason (it then counts as closed for In review and Done). |
| `retire_decision` | Retire a decision that no longer holds and has no replacement (to replace one, add_decision with supersedes). |
| `handoff` | Hand your claim to another session (its session_id) or to anyone ('open'), with a note: what is done, what is next, the branch head (head_sha). |
| `set_metric` | Report a measured value (e.g. pickevent_nights 31) for metric_gte blockers; a result's metrics field does the same. |
| `lease_resource` | Hold a shared thing for a while so no other session uses it: a dev port (port:3001, scoped to your machine automatically), the production migrate step (neon-prod:migrate), anything by name. |
| `release_resource` | Give a leased resource back. |
| `register_footprint` | Declare something you started that outlives the command: a dev server, a database or a copy of one, a container, a service, a tunnel, a worktree. |
| `release_footprint` | Say a registered footprint is torn down; it leaves the Machine inventory. |
| `consume` | Count n (default 1) against a daily quota from settings.quotas (e.g. quota:omdb with daily 1000). |
| `batch` | Several writes in one call: ops of create_task, set_task, set_check, add_result, add_decision or note ({op: 'note', key, text}), each with the fields of its tool (project, actor and request_id come from the batch). |
| `set_agent` | Create or update one roster row by slug. |
| `check_in` | Say an agent is here. |
| `set_goal` | Create or update a goal. |
| `comment` | Add a comment on a task. |
| `assign` | Set a task's owner_agent to another roster agent and count the hop. |
| `record_routine_run` | Record one run of a roster agent's routine. |
| `report_tokens` | Record the tokens one agent reports for a task run. |
| `create_company_project` | Create a project from the company template: paused, plan approval on, its team (product owner, research, artist, taller) and a Playbook doc. |
| `wake_agent` | Wake one roster agent through its adapter when its heartbeat is due. |
| `thread_post` | Write a message in a thread the owner reads on Compañía: a reply, a delivered doc, PR or idea, or what you need from them. |
| `answer_consulta` | Answer a question the owner asked about a project with Pedir's Preguntar mode. |
| `propose_seat` | Propose one more seat for a project's team, with the reason, for the owner to accept or decline on the screen. |
| `deliver_marks` | Artist: answer a logo-marks request (a run whose reason says [marcas <id>]). |
| `propose` | Post a proposal as data in your project's thread; the owner decides it in Te toca. |
| `deliver_stage` | Deliver an idea's stage as data. |
<!-- mcp-tools:end -->

Rules every write follows:

- **Keys.** The server assigns them (omit `key`): `PREFIX-I<n>` for an initiative, `PREFIX-IDEA<n>` for an idea
  (`TND-IDEA3`), `PREFIX-<nn>` for a standalone ticket,
  `<initiative>-<n>` for a phase (`phase` stays a field). One counter per scope, bumped under the project lock, so
  concurrent creates never collide and a number is never reissued. An explicit key is accepted for imports: when it fits
  its scope's pattern it must be at or above the counter (`KEY_BELOW_COUNTER`); otherwise it only warns. Moving a ticket
  (`set_task parent_key`) gives it a key under its new parent and keeps the old one as an alias; every tool accepts
  aliases, answers with the canonical key (`aliases` lists the old ones) and logs the canonical key.
- **Replies.** Writes answer `{key, status, version, changed}` plus the id they made (`result`, `decision`, `question`,
  `claim`); `verbose: true` adds `task`, the full shape without the log. Reads: `get_task view summary` for the cheap
  read, `fields` to pick keys, `list_events {key, since}` for the log. Every task reference carries `kind` and `parent_key`.
- **Batch.** `batch {ops[], atomic}` runs several writes in one transaction; the first failure is `BATCH_FAILED
  {index, op, failed}` and nothing is written. `atomic: false` commits op by op, failures inline, and a retry with the
  same `request_id` replays the ops that went through. An op on a key an earlier op changed may omit `version`.
- **Branches.** An initiative's `integration_branch` (its `branch`) is registered to it; its phases claim on it by
  default. Another live initiative setting the same branch is `BRANCH_IN_USE` unless it passes `share_branch` with a
  `share_reason`; a ticket on a branch its initiative does not own or share is refused too. Names must match the
  project's `settings.branch_pattern` (`BRANCH_NAME_INVALID`). The GitHub poller fills heads, merges and deletions.
- **Blockers.** Besides tickets and env conditions, `blocked_by` takes `{human_action: {text}}` (the owner's inbox),
  `{env_flag: {env, flag, equals}}`, `{time_after: ISO}` and `{metric_gte: {name, value}}`. `get_next` never offers a
  ticket with an unsatisfied blocker (and only Ready ones when `settings.claim_from` is `ready`); when every blocker of
  a Blocked ticket holds, the server moves it to Ready (`blocker.satisfied`).
- **Evidence.** Results carry what ran, where and against which commit. A pass whose commit is no longer the branch
  head is `stale_for_head`; In review then needs a fresh pass (`EVIDENCE_STALE`).
- **Merged and Released.** The pollers move In review → Merged when the PR merges and Merged → Released when the
  `settings.release_target` environment runs a commit containing the merge; by hand they need a ci pass naming the
  merge commit. Agents close them: Done is theirs once the work is finished (see States).
- **Environments.** `deployed` takes the provider's record; `flags` hold configuration state and refuse anything
  that looks like a secret (`SECRET_LIKE_VALUE`); `migrations` is the list of tags applied.
- **Resources.** `lease_resource` holds a name (a port gets `@machine`); `RESOURCE_HELD` names the holder. Policies in
  `settings.quotas` give `consume` a daily budget (`QUOTA_EXCEEDED`).
- **Handoffs.** `handoff {to, note, head_sha}` ends your lease and holds the ticket for the receiver for ten minutes
  (`HANDOFF_HELD` for anyone else); the receiver's `claim` reply carries the note, and `get_task.workspace_history`
  lists every workspace the ticket has used.
- **State notes.** `scope` is the spec; `state_note` (initiatives) says where things stand and is flagged `stale` once
  a ticket moves after it. A status heading inside `scope` only warns.
- **Derived checks.** An initiative check with `derived_from: <ticket key>` ticks itself when that ticket is Done, and
  `set_check evidence_id` accepts any result of the project (the reply names its `source`).
- **Audit.** `audit` finds, from data: tickets in review whose PR merged, Done with open checks, initiatives closed with
  open tickets, stale state notes, decisions citing commits or PRs the release target has moved past, environments
  without a deploy time, drift, Blocked tickets whose blockers hold, scopes that say to wait without a typed blocker, expired
  claims with commits, merged branches still on origin, branches without a ticket, missing PRs.
- **Shipping.** `settings.release.mode` is `command` (default: the release row shows the command the owner runs) or `merge`:
  the row shows "Lanzar", and `POST /api/projects/:slug/release/ship` (the screen's cookie only; any Bearer is `403`)
  opens or reuses a PR `from → into` titled "Release: <keys>", merges it with `gh pr merge --merge --match-head-commit`
  and writes `release.merged`; the pollers do the rest. It is refused (`RELEASE_NOT_READY`) while a before-step or a
  check is open; a failing gh call is `RELEASE_MERGE_FAILED` and records nothing. Agents never merge `into`.
- **Releases.** When a ticket reaches Released, the deploy's record collects it (`get_project.releases`: env, commit,
  deployed_at and source, tickets, PRs, migrations new since the previous release).
- **Bugs and debt.** `work_type: bug` needs a `severity` (S1–S4) and may carry `found_in`, `introduced_by`,
  `regression`; `debt` carries `cost_note`. S1 and S2 bugs show in the status block.
- **Actor.** `actor: {agent?, session_id, machine?, model?}` lands in the event log; `session_id` owns leases.
  An agent token fills `agent` and `machine` and refuses values that disagree (`ACTOR_MISMATCH`); with a static token
  `agent` is required (`ACTOR_REQUIRED`). `owner` is reserved for the screen. Every event records `token_id`.
- **Tokens.** Issued on screen at `/tokens`, shown once, stored hashed: name, agent, machine and scopes `read`
  (read tools), `write` (every write but ops), `ops` (`set_env`, `reserve_sequence`). Revoking one stops its next call.
  The static `.env` tokens keep working, unbound.
- **Won't do and reopening.** The owner's. On screen, `set_task` with a `reason`. An agent sends `reason` and
  `delegated_by_owner` `{message_id, quote}`. Without that evidence the move is `HUMAN_ONLY`. Each move is logged
  (`task.delegated_move`) and an agent's quote is listed under delegated in the inbox. `waive_check` is the reason
  alone. `lease_resource` does not wait. `approval_id` is ignored for one release. Old rows stay as history.
  `WONT_DO_WITHOUT_EVIDENCE` flags a Won't do that has neither a screen actor, nor a quote, nor an archived granted row.
- **Start and finish.** `start` is `claim` plus `get_context` in one call (with any handoff note); `finish` is
  `add_result` plus In review with branch and pr_url in one transaction, so a failure writes neither.
- **PRs.** Done, Merged or Released on a code ticket without `pr_url` is `TASK_MISSING_PR_URL` unless the write passes
  `no_pr_reason` (logged as `task.no_pr`, and the audit stops flagging it). The pollers and the screen are exempt.
- **Checks.** Entering In review, Merged, Released or Done needs every check done or waived (`CHECKS_OPEN` lists the
  numbers and each open check's text), the owner included; an initiative needs every ticket closed (`INITIATIVE_CHILDREN_OPEN`).
- **Headline.** One line (≤ 280 chars) on where the project stands, written with `set_project` or on screen and
  versioned; the server marks it `stale` when an env changes, an initiative moves or a ticket reaches Done after it.
- **Events.** Every write records one or more events in the same transaction; `get_task.log` and
  `list_events` read them. Writes are serialized per project, so a `list_events` cursor never skips one.
- **Time.** Every timestamp is ISO-8601 UTC from the server. Agents never type dates.
- **Versions.** `set_task`, `set_project` and doc replaces carry the version read; a mismatch is `STALE_VERSION`.
  Appends (notes, results, checks, questions) need none.
- **Leases.** `claim` is the only way into In progress. While a session holds a live lease, other sessions
  may add notes and results but not change the task (`NOT_OWNER`). An expired lease is free; the next write in
  the project releases it (`claim.expired`, In progress → Ready).
- **States.** Tickets: Backlog ⇄ Ready → (claim) In progress → In review → Merged → Released; Blocked (with a note)
  from any open state; Needs owner through `ask` only. Initiatives: Planning ⇄ Active ⇄ Shipping, any ⇄ On hold.
  Done is the agents' once the work is finished: code, bug and debt tickets from Merged or Released; ops and research
  from In review on; decision-needed once answered (Backlog, Ready or In progress); an initiative from any open
  status once its tickets are closed. Elsewhere it is `INVALID_TRANSITION` with `allowed_from`. Won't do and reopening
  are the owner's: on screen with a reason, or by an agent with a reason and `delegated_by_owner`.
- **Evidence.** In review needs a result recorded during the current claim: code a passing
  unit|integration|test|live|ci; ops live|verify|ci; research any result or a doc; decision-needed never.
- **Template.** A ticket needs a scope; code and ops tickets need a check. Conventions only warn.
- **Idempotency.** A write with `request_id` that is retried returns the first response and writes nothing.
  Without it, `create_task` with an existing key is `KEY_EXISTS`. Request ids are kept 30 days.
- **Limits.** Title 200, summary 300, scope/body 50 000, note 4 000, decision 2 000, check 500 × 50,
  blocked_by 50, doc 200 000, ADR 100 000 characters (`src/mcp/limits.ts`); over it is `TOO_LARGE {field, max}`.

Contract errors come back as an MCP tool error (`isError: true`) whose text is
`{"error":"<CODE>","status":<400|403|404|409>, ...detail}`, e.g. `{"error":"STALE_VERSION","status":409,"current_version":4}`.
Input that does not match a tool's schema (a missing `actor`, a wrong type) is rejected by the MCP SDK
before Plania runs, as a plain-text tool error (`INVALID_INPUT`). The catalog is generated from
`src/mcp/errors.ts` with `pnpm error-catalog`:

<!-- errors:start -->
| Code | Status | When |
|---|---|---|
| `ACTOR_REQUIRED` | 400 | actor.agent is missing and no agent token identifies the caller |
| `BLOCKED_REQUIRES_NOTE` | 400 | status Blocked without a note (create_task cannot block: it takes no note) |
| `BLOCKER_NOT_FOUND` | 400 | a blocked_by key does not exist in this project, or names the task itself |
| `BODY_REMOVED` | 400 | body is gone in v2: use scope, checks, and note (the log) |
| `BRANCH_NAME_INVALID` | 400 | the branch name does not match the project's branch_pattern (detail: pattern) |
| `CAMINO_ACTIONLINT` | 400 | camino: actionlint found errors in a workflow Camino would propose; no PR was opened (detail: errors [{line, column, message, kind}]) |
| `CAMINO_CHANGE_INVALID` | 400 | camino: a change in the set does not fit (detail: field, reason): an unknown config key, an integration branch equal to the published one, a folder that is not a clone of the repo, deleting a role branch, a protected or malformed start branch |
| `CAMINO_KEY_INVALID` | 400 | camino: the pasted key has spaces, quotes or a label in it, or is shorter than 8 characters; nothing was saved |
| `CAMINO_KEY_REJECTED` | 400 | camino: the service refused the key on its read-only test; nothing was saved (detail: status, message: the service's own words) |
| `CAMINO_PROVIDER_UNKNOWN` | 400 | camino: no key can be saved for that service; it is Detected or Manual, or not a service Camino knows (detail: provider) |
| `DELEGATION_EVIDENCE` | 400 | a delegated answer or a Won't do / reopen move needs delegated_by_owner.message_id (8 to 200 characters) and a quote of 8 to 280 characters; empty or short evidence is refused |
| `DEPLOY_SOURCE_REQUIRED` | 400 | set_env deployed needs a source {provider, deployment_id, url}: the server stores where the time came from |
| `FETCH_ADDRESS_REFUSED` | 400 | safe fetch: the host is or resolves to a loopback, private, link-local, metadata or reserved address; nothing was sent (detail: address, reason) |
| `FETCH_FAILED` | 400 | safe fetch: the connection failed (detail: reason) |
| `FETCH_HTTP_STATUS` | 400 | safe fetch: the server answered with a status other than 2xx (detail: status) |
| `FETCH_NOT_RESOLVED` | 400 | safe fetch: the host name does not resolve to any address (detail: host) |
| `FETCH_REDIRECT_REFUSED` | 400 | safe fetch: the server answered with a redirect, which is never followed (detail: status, location) |
| `FETCH_SCHEME_REFUSED` | 400 | safe fetch: only http and https addresses are fetched (detail: scheme) |
| `FETCH_TIMEOUT` | 400 | safe fetch: resolving, connecting or reading took longer than the limit (detail: timeout_ms) |
| `FETCH_TOO_LARGE` | 400 | safe fetch: the body is larger than the limit (detail: max_bytes) |
| `FETCH_TYPE_REFUSED` | 400 | safe fetch: the content type is not one this use accepts (detail: content_type) |
| `FETCH_URL_INVALID` | 400 | safe fetch: not an absolute address, longer than 2048 characters, or it carries a user name or password |
| `FIELD_NOT_ALLOWED` | 400 | a field of the other kind: priority/parent_key/origin/work_type/phase on an initiative, base_branch/next_action/in_progress_note on a ticket |
| `FINDING_NOT_FIXABLE` | 400 | audit fix: the code has no one-click fix (copy findings: run the command; the rest: the tool the fix_hint names) |
| `FRAME_INVALID` | 400 | attach_frames: the task is not an idea, more than 40 frames, an id repeats, or a frame's path is outside the canvases folder, missing, not a PNG/JPEG/WebP, or over 5 MB (detail: frame, hint) |
| `INVALID_APPROVAL` | 400 | a waiver needs a non-empty reason. The old approval action list is no longer a tool |
| `INVALID_BATCH_OP` | 400 | batch: an op is not set_task, set_check, add_result, add_decision, create_task or note |
| `INVALID_BLOCKER` | 400 | a blocked_by entry is malformed (detail: type, hint): human_action {assignee, text}, env_flag {env, flag, equals}, time_after {at}, metric_gte {name, value} |
| `INVALID_ENV` | 400 | set_env: env is not lowercase [a-z][a-z0-9_-]*, a commit is not 7-40 hex, or migrations_applied is not a count |
| `INVALID_ENV_CONDITION` | 400 | an env blocker's condition or value is wrong (contains_commit <sha>, migration_gte <n>, deployed_after [ISO]) |
| `INVALID_FILTER` | 400 | a list filter is malformed (detail: field), e.g. updated_since is not an ISO-8601 time |
| `INVALID_FOOTPRINT` | 400 | register_footprint / release_footprint: unknown kind, a locator that does not fit its kind, an empty purpose or teardown, or no actor.machine (detail: field, hint) |
| `INVALID_GOAL` | 400 | a goal needs a title, status active|done|dropped, target_on as YYYY-MM-DD, a company goal cannot have a parent, and a parent must be a company goal |
| `INVALID_METRIC` | 400 | set_metric name is not lowercase [a-z][a-z0-9_-]*, or value is not an integer |
| `INVALID_PHASE` | 400 | phase is not an integer 0..999 |
| `INVALID_PRIORITY` | 400 | priority is not P0, P1, P2 or P3 |
| `INVALID_QUESTION` | 400 | ask with an empty question, or answer with an empty answer |
| `INVALID_RESOURCE` | 400 | lease_resource / consume: bad name, ttl, amount, or an unknown quota (detail: field) |
| `INVALID_RESULT` | 400 | add_result kind, verdict or cite is not valid, or check_ns with a verdict other than pass |
| `INVALID_SEQUENCE` | 400 | sequence name is not lowercase [a-z][a-z0-9_-]*, or a number is out of range |
| `INVALID_SEVERITY` | 400 | a bug needs severity S1, S2, S3 or S4; found_in, introduced_by, regression and cost_note belong to bugs and debt |
| `INVALID_STATUS` | 400 | status is not in the task kind's vocabulary, or not allowed at creation |
| `INVALID_TTL` | 400 | ttl_minutes outside 5..240 |
| `INVALID_WORK_TYPE` | 400 | work_type is not code, ops, research, decision-needed, bug or debt |
| `LESSON_NOT_ALLOWED` | 400 | a lesson would hold a secret or personal data, or relax a test, review or check (detail: reason secret | relaxes_checks) |
| `MANAGER_NOT_ON_TEAM` | 400 | a seat can report only to the owner or to a seat of the same project's team |
| `MARKS_INVALID` | 400 | deliver_marks: no mark was usable after cleaning and checking (detail: reasons) |
| `MUESTRA_INVALID` | 400 | finish: muestra does not fit its shape (detail: field, hint) |
| `MUESTRA_REQUIRED` | 400 | finish: the delivery changes the screen on a project Plania photographs; pass muestra {frase, vistas, pasos} (detail: ui_files, hint) |
| `MUESTRA_SELECTOR` | 400 | finish: a muestra follow, click or fill is not a selector the browser reads, e.g. Playwright's :has-text( or >> (detail: field, value, hint) |
| `PARENT_MUST_BE_INITIATIVE` | 400 | parent_key names a ticket |
| `PROMOTED_TO_INVALID` | 400 | promoted_to is not an initiative or a standalone ticket of this project |
| `PUESTO_INVALID` | 400 | a role of the owner's own needs a title (1-60 characters), a line (up to 200) and a base role from the catalog (detail: field) |
| `REFERENCE_FILE_EMPTY` | 400 | a reference upload with no bytes |
| `REFERENCE_FILE_TOO_LARGE` | 400 | a reference file over 5 MB (detail: max_bytes) |
| `REFERENCE_FILE_TYPE` | 400 | a reference file that is not PNG, JPEG, WebP or PDF by its first bytes (the name and declared type do not count) |
| `REFERENCE_INVALID` | 400 | a reference's fields do not fit (detail: field): note up to 600 characters, stance follow|avoid, applies always|on_topic, scope agent|project, state on|off, title 1..160 |
| `REPO_FOLDER_MISSING` | 400 | new project: the folder given as repo_path does not exist on this machine |
| `REPO_FOLDER_NOT_EMPTY` | 400 | prepare the code: the folder has files and is not this project's git repository; Plania never initialises or overwrites it |
| `REPO_GIT_FAILED` | 400 | prepare the code: a git step failed (detail: step) |
| `REPO_GITHUB_FAILED` | 400 | GitHub: gh failed (detail: step) |
| `REPO_GITHUB_NO_GH` | 400 | GitHub: gh is not installed on this machine |
| `REPO_GITHUB_NO_WRITE` | 400 | GitHub: this gh login cannot write to the repository |
| `REPO_GITHUB_NOT_FOUND` | 400 | GitHub: no repository with that owner/name for this gh login |
| `REPO_GITHUB_SIGNED_OUT` | 400 | GitHub: gh is not signed in on this machine |
| `REPO_NO_IDENTITY` | 400 | prepare the code: git has no name and email on this machine and the GitHub login could not give one |
| `REPO_NO_ORIGIN` | 400 | new project: the folder's git repository has no remote named origin |
| `REPO_NO_START_BRANCH` | 400 | new project: origin has no branch to start from (the project's start_branch, default sandbox; detail: branch) |
| `REPO_NOT_GIT` | 400 | new project: the folder given as repo_path is not a git repository |
| `REPO_ORIGIN_UNREACHABLE` | 400 | new project: origin could not be read (network, credentials or a wrong address) |
| `REPO_PUSH_FAILED` | 400 | prepare the code: pushing to origin was refused (access or network) |
| `RESERVED_ACTOR` | 400 | actor.agent is owner: only the screen writes as the owner |
| `SECRET_LIKE_VALUE` | 400 | an env flag looks like a secret (a key name, a token prefix, or 20+ random characters); flags record whether something is configured, never the value |
| `SKILL_IMPORT_FORMAT` | 400 | the link is not a skill Plania can bring: not a SKILL.md, a GitHub folder or a GitHub file or raw address; no SKILL.md with a name and a description; or more files or folders than a skill holds (detail: reason) |
| `SKILL_INVALID` | 400 | a skill does not fit the Agent Skills format: slug, name, description (1-1024, no angle brackets), body (1-500 lines) or a supporting file's path or size (detail: field, hint) |
| `SKILL_NOT_ALLOWED` | 400 | a skill carries something other than text: a script or executable file, hooks, an allowed-tools grant, or a command run at load time (detail: field, hint) |
| `SKILL_NOT_IMPORTED` | 400 | only a skill brought from a link looks at its link again (detail: skill) |
| `TASK_MISSING_PR_URL` | 400 | Done, Merged or Released on a code ticket without pr_url: pass pr_url, or no_pr_reason when the work had no PR |
| `TEMPLATE_INVALID` | 400 | create_task: a ticket without scope, or a code/ops ticket without checks (detail: missing) |
| `TEXT_HAS_DATE` | 400 | decision text starts with a date: the server stamps dates |
| `TOO_LARGE` | 400 | a text field exceeds its limit (detail: field, max) |
| `TRIAL_NO_DELIVERY` | 400 | a trial needs one finished delivery of this agent on a ticket whose work can still be read: the run is not one, or its branch is gone (detail: reason) |
| `VERSION_REQUIRED` | 400 | set_task changes fields without the version you read |
| `ACTOR_MISMATCH` | 403 | actor.agent or actor.machine disagrees with the agent token's (detail: expected) |
| `CONSULTA_FORBIDDEN` | 403 | answer_consulta by an agent that is not the PO the question woke (detail: consulta, agent) |
| `DELEGATION_OFF` | 403 | delegated answers and delegated moves are off: the kill switch on the screen is off |
| `HUMAN_ONLY` | 403 | Won't do or reopening a closed task: the owner's call, on screen with a reason, or by an agent with a reason and delegated_by_owner {message_id, quote}. Also a human_only question: only the screen can answer it, by a click; bots are refused. answer_delegated is a different tool and only actor agent plania-bot may call it |
| `LESSON_OWNER_ONLY` | 403 | only the owner's screen approves, edits, rejects or retires a lesson; the reflector and agents only propose (detail: lesson) |
| `MARKS_FORBIDDEN` | 403 | deliver_marks by an agent that is not the Artist the request woke (detail: id, agent) |
| `NOT_DELEGABLE` | 403 | answer_delegated only answers one human_only question that has named options. An approval_id on that call is ignored |
| `SEAT_PROPOSAL_NOT_PO` | 403 | propose_seat: only the project's product owner proposes a seat; runs never create, change or retire seats |
| `THREAD_FORBIDDEN` | 403 | thread_post or thread_read on a thread that is not yours: Asistente may use every thread, a team member only its own project's (detail: thread, agent) |
| `WAIVE_VISUAL_FORBIDDEN` | 403 | waive_check: a visual check (how the screen looks, a still, a viewport) is waived only by the QA lane or the owner (detail: n, text); prove it with a visual result or ask the owner |
| `AGENT_NOT_FOUND` | 404 | unknown roster slug (owner_agent or reports_to) |
| `CAMINO_KEY_MISSING` | 404 | camino: no key is saved for that service on this project |
| `CHECK_NOT_FOUND` | 404 | no check with that n on this task |
| `CONSULTA_NOT_FOUND` | 404 | answer_consulta on an id that is not a question of this project |
| `DECISION_NOT_FOUND` | 404 | supersedes names no decision of this project |
| `DOC_NOT_FOUND` | 404 | no doc with that id in the project, or replacing (version given) a title that does not exist |
| `FINDING_NOT_FOUND` | 404 | audit fix: a fresh audit no longer has that finding (code and id), so there is nothing to fix |
| `GOAL_NOT_FOUND` | 404 | no goal with that id, or the goal belongs to another project (detail: field goal_id or parent_id) |
| `INITIATIVE_NOT_FOUND` | 404 | get_next initiative_key is not an initiative of this project |
| `LESSON_NOT_FOUND` | 404 | no lesson with that id (detail: lesson) |
| `MARKS_NOT_FOUND` | 404 | deliver_marks on an id that is not an open marks request of this project (detail: id) |
| `PROJECT_NOT_FOUND` | 404 | unknown project slug |
| `PROPOSAL_NOT_FOUND` | 404 | no seat proposal with that id in this project |
| `PUESTO_NOT_FOUND` | 404 | no role of the owner's own with that slug (factory roles cannot be deleted) |
| `QUESTION_NOT_FOUND` | 404 | no question with that id in this project |
| `REFERENCE_NOT_FOUND` | 404 | no reference with that id on this seat |
| `RESULT_NOT_FOUND` | 404 | evidence_id is not a result of this project |
| `SKILL_NOT_FOUND` | 404 | no skill with that slug for this agent, no such version, or a deleted skill past its 30 days (detail: skill) |
| `TASK_NOT_FOUND` | 404 | unknown key in this project (also an unknown parent_key or task_key) |
| `TEAM_NOT_FOUND` | 404 | no team with that slug in the catalog; deleting also needs it to be one the owner saved or brought, not a factory team |
| `THREAD_NOT_FOUND` | 404 | thread is not "company", a project slug with a thread, or a thread id |
| `UNKNOWN_BRANCH` | 404 | get_context: no initiative or ticket is on that branch (detail: known) |
| `ALREADY_ANSWERED` | 409 | the question was answered already (detail: answer, answered_by) |
| `ALREADY_SUPERSEDED` | 409 | the decision named in supersedes was already reversed (detail: superseded_by) |
| `BATCH_FAILED` | 409 | an atomic batch rolled back because one op failed (detail: index, op, failed: {error, status, ...}) |
| `BLOCKER_NOT_WITHDRAWABLE` | 409 | set_task withdraw_blocker: not a pending blocker parsed from a note on this task, or another session's note (detail: reason) |
| `BRANCH_IN_USE` | 409 | the branch belongs to another live initiative (detail: owner_key); pass share_branch: true with a reason to share it |
| `CAMINO_GITHUB_REFUSED` | 409 | camino: GitHub refused a change; the ones before it stay applied and the rest did not run (detail: step, status, message) |
| `CAMINO_KEY_STORE` | 409 | camino: the keychain (or the 0600 file) did not take the key; nothing else changed |
| `CAMINO_NEEDS_APPROVAL` | 409 | Publicar: a migration the release carries destroys or reshapes data and the owner has not approved that exact file (detail: files [{path, sha256, statements}]) |
| `CAMINO_NO_GITHUB` | 409 | camino: the change needs GitHub and the project has no repository or no token (detail: repo, token) |
| `CAMINO_RULE_BLOCKS` | 409 | Aceptar or Publicar: the branch's rule in Camino requires checks that are not green on this PR, on a repo where GitHub cannot enforce it (detail: base, checks) |
| `CAMINO_SQL_REVIEW` | 409 | Publicar: squawk found errors in a migration the release carries, and the production environment asks for the SQL review (detail: files [{path, issues}]) |
| `CHECKS_OPEN` | 409 | In review, Merged, Released or Done while a check is neither done nor waived (detail: open, the check numbers) |
| `CLAIM_HELD` | 409 | another session holds a live lease (detail: owner, lease_until, workspace) |
| `DECISION_RETIRED` | 409 | the decision was retired: it cannot be superseded, pinned or retired again |
| `DELEGATION_LIMIT` | 409 | delegated answers and Won't do or reopen moves are limited to 10 per hour, and one answer per question |
| `DOC_EXISTS` | 409 | attach_doc without version for a title that exists (detail: doc_id, version): pass version to replace |
| `EVIDENCE_REQUIRED` | 409 | In review without evidence for the work_type from the current claim (detail: accepts, since) |
| `EVIDENCE_STALE` | 409 | In review needs a pass recorded against the branch's current head; the passes found are for older commits (detail: head, results) |
| `FOOTPRINT_HELD` | 409 | another live session declared this footprint, or releasing one you did not declare (detail: holder, purpose) |
| `HANDOFF_HELD` | 409 | the ticket was handed to another session; the hold lasts ten minutes (detail: to, until, note) |
| `HOP_CAP` | 409 | assign would pass 3 hops (detail: hops, cap). The owner stays and a limpieza inbox item is posted |
| `IDEA_CLOSED` | 409 | a Done or Won't do idea does not change stage or promoted_to (detail: status) |
| `IDEA_OWNER_NEWER` | 409 | set_task stage: the owner decided or wrote on the idea after this run started; it stays on its stage and its agent is woken again with his words (detail: since, words) |
| `IDEA_STAGE_NOT_YOURS` | 409 | Research moves an idea only out of research, Artist only out of design (detail: role, stage, owns) |
| `INITIATIVE_CHILDREN_OPEN` | 409 | an initiative cannot be Done or Won't do while a ticket of it is in another state (detail: open) |
| `INVALID_STAGE_MOVE` | 409 | set_task stage is not one step along idea → research → design → planning → ready, or a step back without a note (detail: from, to) |
| `INVALID_TRANSITION` | 409 | the status change is not allowed from the current status (detail: from, to, hint) |
| `KEY_BELOW_COUNTER` | 409 | an explicit key with a number already issued for that scope (detail: next); omit key to get the next one |
| `KEY_EXISTS` | 409 | create with a key that exists (or is an alias of one); creates are not idempotent without request_id |
| `LEASE_EXPIRED` | 409 | heartbeat after your lease ran out: claim again |
| `LEG_POSTPONED` | 409 | propose: a plan for a leg that is On hold, postponed on purpose; planning is not permission to start it (detail: key, status) |
| `LESSON_CONFLICT` | 409 | approving a lesson that clashes with an active one: say which stays with keep new | old (detail: lesson, text, other {id, text}) |
| `LESSON_STATE` | 409 | the lesson is not in a state that action takes: approve, one-off and reject take a proposal, retire an active lesson (detail: state, action) |
| `MANAGER_LOOP` | 409 | the new manager reports, directly or not, to the seat being moved (detail: chain) |
| `NOT_CLAIMABLE` | 409 | the ticket cannot be claimed (detail: status, or unsatisfied blocked_by) |
| `NOT_OWNER` | 409 | another session holds a live lease on this task (detail: owner, lease_until) |
| `PEDIDO_SIN_ORDEN` | 409 | an idea the owner asked for on screen (origin owner) gets promoted_to only after their «Constrúyelo» on the Pedido tab |
| `PING_PONG` | 409 | this owner pair already assigned the other way (detail: from, to). The owner stays |
| `PROPOSAL_DECIDED` | 409 | the seat proposal was already accepted or declined |
| `PUESTO_IN_USE` | 409 | a seat still has that role on some team; retire it first (detail: seats) |
| `QUOTA_EXCEEDED` | 409 | consume would pass the daily quota (detail: limit, used, remaining) |
| `REFERENCE_LIMIT` | 409 | the seat already has the most references it may keep (detail: max) |
| `RELEASE_MERGE_FAILED` | 409 | release/ship: a gh call failed (detail: step token | list | edit | create | merge | view, output); nothing was recorded |
| `RELEASE_NOT_READY` | 409 | release/ship: the step cannot ship now (detail: reason mode_command | no_repo | no_release | no_github_data | nothing_to_ship | before_steps | open_checks | merged | freeze: Camino's production environment is in its freeze window | prod_migration_unhandled: the release adds migrations and neither settings.release.prod_migrations nor Camino's production environment names who migrates) |
| `REQUEST_ID_REUSED` | 409 | request_id was already used by a different tool in this project |
| `RESOURCE_HELD` | 409 | another session holds the resource (detail: holder, lease_until, purpose) |
| `SEAT_REQUIRED` | 409 | the product owner cannot be retired: every project keeps one |
| `SEAT_TAKEN` | 409 | that role already has a seat on this team, or a role of the owner's own with that name exists |
| `SEQUENCE_TAKEN` | 409 | the requested sequence value is held by another live ticket |
| `SKILL_EXISTS` | 409 | a live skill already has that slug (detail: slug) |
| `SKILL_IMPORT_CHANGED` | 409 | the content at the link is no longer the one the owner saw and confirmed: look at it again (detail: source_hash) |
| `STAGE_REQUIREMENTS_MISSING` | 409 | moving an idea forward without that stage's doc or its headings (detail: doc, missing) |
| `STALE_VERSION` | 409 | the task (or doc) changed since you read it (detail: current_version) |
| `TEAM_FULL` | 409 | a project's team holds at most eight seats |
| `VERIFY_FAILED` | 409 | finish: one of the project's checks (settings.qa.verify) fails in the ticket's workspace (detail: failed {name, command, exit_code, tail}, hint): fix it there and call finish again |
<!-- errors:end -->

## Hooks

Inbound integrations, JSON with real HTTP status codes, `Authorization: Bearer <PLANIA_CI_TOKEN>`.
`request_id` is required; a redelivery is a no-op. Nothing posts to them yet: Plania listens on localhost.

- `POST /hooks/result` `{project, key, verdict, cite, url?, kind? (ci), pr_url?, branch?, request_id}`: a result as
  actor `ci`, plus the PR link and branch. Answers the write reply with `result` and the full `task`.
- `POST /hooks/env` `{project, env, commit?, branch?, migrations?, flags?, commits?, deployed?: {provider, deployment_id, url}, request_id}`: `set_env`.
- `POST /hooks/metric` `{project, name, value, request_id}`: `set_metric`.
- `GET /mcp/events?project=&since=<cursor>&key=&types=`: the change feed as server-sent events for agents (any read
  token): replays from the cursor, then streams; each message's id is the next cursor.

## Export

`GET /api/export/<slug>.json` downloads a whole project (tasks with checks, results and questions, docs, decisions,
env, reservations, every event). The owner's session, `MCP_BEARER_TOKEN` or `MCP_READ_TOKEN`; the project page links it.
`GET /api/export-all` gives every project in one file (`plania-export-all`, one `plania-export` entry per project),
with the same access.

## Getting help

The help report is a text file the owner makes and chooses to send; Plania never sends it. Two ways to make it:

- Plomería (`/machine`), «Bajar informe para pedir ayuda» (`GET /api/help-report`, behind the session).
- `pnpm help:report` in Plania's folder, for when the screen does not start. It writes `plania-ayuda-<date>.txt`
  (`--out <file>`, or `--out -` to print). It works with the database down: the file then says so and carries the rest.

It holds Plania's version and commit, the system and Node, the machine check, whether the database answered, readiness
per project, the last 10 failed runs with their one-line reason, the names of the environment variables that are set,
and the last 40 lines of the server log (`PLANIA_LOG_FILE`, else `~/Library/Logs/plania/server.log` on macOS and
`~/.local/state/plania/server.log` on Linux). It is built from those fields only (`src/help-report/`), and every
free-text line goes through a redactor that hides every environment and `.env` value, every text in the projects'
settings, and what the diff scanner recognises (tokens, keys, URLs with passwords, hashes, emails). It never holds an
environment value, a token, a password hash, repo content, a prompt, a ticket's scope or thread text. Making it calls no
network: `gh auth status`, the short `claude -p` and `git ls-remote` are skipped and shown as not checked.

## Leaving

1. Plomería, «Llevarte tus datos»: every project in one JSON file.
2. `pnpm uninstall:plania` stops and removes the service (the launchd agent `com.plania.server` on macOS, the systemd
   user unit `plania.service` on Linux) and stops Plania's server and runs started from this folder. The database and
   every folder stay.
3. `pnpm uninstall:plania --delete-data` also drops the database and removes `~/.config/plania`, the captures folder
   and the log folder, only after you type the database's name. The backups folder (`~/plania-backups`) is never
   removed. Then delete Plania's own folder.

## Clients

`PLANIA_MCP_TOKEN` is the same value as `MCP_BEARER_TOKEN` in Plania's `.env`. Local URL: `http://localhost:3737/mcp`.

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

An app started from the Dock, the Start menu or a desktop launcher does not see your shell's variables: put the token in its config file itself.

### In a product repo

Nothing. Do not add a `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.claude/`, hooks or CI for Plania to a product repo.
The plan and the rules live in Plania: the server's `instructions` carry the protocol, and `get_project` /
`get_memory` carry the project's rules. Client-side rules belong in the owner's user-level config, not in the repo.

## Screen

The screen speaks the install's language, Spanish or English, chosen at first start and changed in Plomería; the morning brief follows it. Where words live and how to add one: [docs/screen-words.md](docs/screen-words.md).

`http://localhost:3737`, password login. React 19, Tailwind 4 and shadcn/ui. Dark ("Noche") by default, with light and
system themes. Times arrive as UTC and show in the browser's local time.

- **Lanes, not steps.** Each open initiative is a lane, plus "Sueltos" for tickets without one. Every lane has the
  same five columns: Hecho (Done), En revisión (In review, Merged, Released: one PR per initiative, so phases wait
  on its branch), En curso (In progress, Needs owner, and Blocked by anything but tickets), Siguiente (Ready, then
  Blocked tickets that only wait on other tickets, shown as "espera F1 · F3"; or else the top Backlog ticket) and
  Después (the rest of the Backlog). A column empty in every lane narrows to a strip. Only lanes with work in motion
  pulse. Task rows carry `waits_on` (unsettled ticket blockers) and `held` (any other open blocker) for this. The
  rules live in `ui/src/lib/lanes.ts` and are tested in `test/lanes.test.ts`.
- `/` shows one track per project: progress, then an Ahora → Siguiente row per lane, and how many questions wait
  for the owner. Past four initiatives, lanes still for a week fold behind "Ver todas". Projects without initiatives
  show their generated line. A "Te toca a ti" strip lists Needs owner tickets across projects.
- `/inbox` lists everything waiting on the owner: open questions, human actions, a release and footprint.
  The header shows the count. `/tokens` issues and revokes agent tokens.
- `/p/<slug>` shows the generated headline first, with the note under it (editable, "desactualizada" when the server marked it stale), then, in order: questions agents asked (answer with one click or free text, with an optional line for
  the decision log); the lane grid; each initiative's line of stations; a branch graph built from initiatives' `branch`
  and `base_branch`; the pinned decisions; and Orden, the audit collapsed with its count, grouped "Lo tuyo" (one-click
  fixes and commands to copy) and "De los agentes" (what get_next hands out as chores). "Ver la ficha completa" opens the generated resume per initiative
  (claims, next, pinned decisions) and the decision log, reversed ones
  struck through. A link downloads the project as JSON.
- `?view=lista` switches to the list grouped by initiative, with status and priority filters and a toggle for
  closed items. Rows show codes only for initiatives; the side panel header still shows a ticket's key.
- Status and priority change from menus on each row, as the owner: any move is allowed, Done included, and leases do
  not stop him. Each change carries the version on screen; if an agent changed the task meanwhile, nothing is
  overwritten and a toast says so. Blocked asks for its note. Every change offers Undo for 8 seconds.
- A ticket with a live lease shows who holds it and until when; Liberar frees it.
- Clicking any ticket opens a side panel: scope (Markdown), Done when checks, evidence, docs, questions,
  blockers (tasks and env conditions, each satisfied or not), branch, worktree, PR and its history. The open task is in
  the URL (`?task=MIC-01-F2`), so it can be linked; Back and Escape close it.
- **Ajustes** (NEWPROJ-6): a project's settings, a door beside Equipo and Máquinas in Compañía
  (`/ceo?proyecto=<slug>&t=ajustes`), also linked from the readiness list and from `/p/<slug>`. It sets where the code
  is (a folder on this machine, checked with git before it is saved; a GitHub repo; or no code yet), the release step
  (`settings.release`), QA's verify list (one command per line), the preview address and plan approval, and creates
  and edits the three context docs (`Context: Glossary`, `Commands`, `Map`) from `kit/context/`. PLA-135: those three
  and the project's other docs (its library, `PUT …/settings/docs`) sit in «Docs del proyecto», drawn as who reads
  what; a doc opens across the page to read and edit. Archivo, the door that listed docs, is gone. Writes go through
  `set_project` and `attach_doc` with the version on screen (`GET` / `PUT /api/company/projects/:slug/settings…`), so a
  concurrent change is refused, not overwritten. PLA-I2-6: it also edits how the app starts (`settings.capture`:
  command, port, pages) and, in a closed «Avanzado» section, every advanced setting below. A project with code made
  on the screen starts with a release step that ships from the screen (mode `merge`); `pnpm project:add` and
  `create_company_project` add none. No field takes a secret: a token is named by
  its variable (`github.token_env`, `vercel.token_env`), and a value shaped like a token is refused (`SECRET_VALUE`).
  Each missing item on the readiness list links to its section. Plomería's «Cada corrida» sets the company's
  `max_turns`, `timeout_minutes` and `cooldown_minutes`.

#### Project settings

One list, `src/mcp/settings-registry.ts`, holds every key of `projects.settings`: its default, whether it is basic or
advanced, its control on screen and its plain sentence. `set_project` accepts exactly those keys, and the screen writes
no other (`test/settings-registry.test.ts`). A few are owner-only: an agent setting them would weaken a control the owner
keeps, so `set_project` from an agent refuses them and only the owner's screen writes them. These tables are generated
from the list (`pnpm exec tsx scripts/settings-table.ts`):

<!-- settings-advanced:start -->
Only the owner's screen sets these; `set_project` from an agent refuses them (INVALID_FILTER):

| Setting | Why an agent may not |
|---|---|
| `preview_url` | an agent could point the owner's preview link anywhere |
| `plan_approval` | off, a PO's plan makes tickets without the owner's «Sí, empiecen» |
| `auto_accept` | on, deliveries enter the test copy without the owner |
| `auto_accept_invisible` | on, deliveries enter the test copy without the owner |
| `runner` | it raises how many runs go at once and which server variables runs get |
| `next_first` | it overrides the step the owner picked to go first |
| `velocidad` | It decides when work is accepted without the owner and how much runs at once. |

Advanced settings, which can be left alone:

| Setting | Default | Why it can be left alone |
|---|---|---|
| `start_branch` | sandbox | The default works once the repository has that branch; «Crear la rama de trabajo» makes it. |
| `release_target` | prod | Only matters with more than one deploy target; prod fits a project with one. |
| `release_on` | env with Vercel or a recorded commit, else branch | Plania picks it from what the project has; set it only when the guess is wrong. |
| `auto_done` | on | On is what a new owner wants; off keeps every closing by hand. |
| `velocidad` | apilar on, revision por_modulo, carriles 2, esqueleto_temprano on, verificar on | PLA-I73: measured on guided test 3, most of a module's time was waiting between steps. |
| `branch_pattern` | none: any branch name | The runner already names its branches; a pattern only binds outside clients. |
| `claim_from` | backlog | The PO decides what is Ready; the default suits a team the PO leads. |
| `resources` | none: leases with the server's limits | Leases work without it; it only caps how long one may be held. |
| `quotas` | none | Only for a project that calls an outside service with a daily cap. |
| `vercel` | none: host statuses on GitHub, and Camino's Vercel project with the saved key | Only to read a Vercel project or key other than the one Camino names. |
| `maquinas` | found in the repo: the env file, the migrate and seed scripts, the migrations folder | Plania finds them in package.json and the repo; set them only when it cannot. |
| `identity` | by slug, alphabetically | Alphabetical order works until there are enough projects to care. |
| `team` | idle after 120 minutes | Two hours suits runs of any length the runner starts. |
<!-- settings-advanced:end -->
- **Live:** writes from agents, CI or the screen appear within a second. A ticket that changed column glides to
  its new place and glows briefly. The header shows "En vivo" while the event stream is connected. Animations
  stop under the system's reduced-motion setting.

### On the phone

The screen works at phone width (from 320 px) and installs as a home-screen app. Below `sm` the header keeps the
mark, Bandeja and the live dot, and folds Tokens, Tema and Salir into a "⋯" menu. Wide tables become stacked rows, and
buttons grow to touch size on coarse pointers only, so the desktop layout does not change. The page pads for the notch
and the home indicator (`viewport-fit=cover` and `env(safe-area-inset-*)`, with the `gutter` utility for side padding).

- **Icons and manifest** live in `ui/public/`. Vite copies them to `dist/ui`, and `scripts/dev.ts` serves them before the
  SPA fallback. `manifest.webmanifest` and `sw.js` are sent with `no-cache` and the icons for a day. The
  `theme-color` follows the theme toggle, so the status bar matches Claro or Oscuro.
- **Offline:** the build writes `dist/ui/sw.js` from `ui/sw.js` with the list of hashed files (the plugin is in
  `vite.config.ts`). It precaches the app shell, so the app still opens without a network and shows "Sin conexión".
  It retries when the network returns. Pages load network-first, so an online open always gets the latest build.
  `/api`, `/mcp`, `/hooks` and `/health` never go through it, so data and the live stream are never cached. The live
  stream reopens when the app returns to the foreground.
- **Install:** iOS Safari → Compartir → Agregar a inicio. Android Chrome → menu → Instalar app.
- **Reaching it from the phone** (2.12): the server listens on 127.0.0.1 only and `tailscale serve --bg --https=443
  http://127.0.0.1:3737` puts it on the tailnet with a real certificate. The session cookie is `Secure` when the request
  is HTTPS, arrives with `X-Forwarded-Proto: https` (what `tailscale serve` sends; trusted because only this machine can
  reach the port), or comes to a loopback host. A home-screen app on iOS keeps its own cookies, so you sign in once
  inside it. Steps in [docs/phone-access.md](docs/phone-access.md).
- **Push** (2.12): "Avisarme cuando me toque" in the "⋯" menu subscribes the device (`ui/src/lib/push.ts`); `ui/sw.js`
  shows the message and a tap opens the Bandeja on its tab. The `push` job (`src/jobs/push.ts`) looks at the inbox
  once a minute and sends one message per device for whatever is new in Decisiones or Pasos (questions,
  human actions typed or parsed, a release ready). A 404/410 from the push service deletes the subscription.

How live updates flow: every write runs in `writeTx` (`src/mcp/tx.ts`), which after commit publishes one change per
task it touched on the in-process bus in `src/events.ts`. `GET /api/events` streams those as server-sent events, and
the UI refetches what changed.

### JSON API (cookie only)

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/session` | Session |
| `GET /api/projects` | Projects with their generated line (the headline), the next step (`next_line`), read-only `readiness` (`state`, `reasons`, `line`; same object as `get_resume`), Orden's count, open question count, and all tasks without scope |
| `GET /api/projects/:slug` | Generated resume, decisions, and all tasks without scope (with version, lease, `branch`, `base_branch`, `waits_on`, `held` and `created_at` on each task) |
| `GET /api/projects/:slug/tasks/:key` | One task, in the `get_task` shape; each result with `stale_for_head` and `ticked_checks` (the sheet's evidence timeline) |
| `PATCH /api/projects/:slug` | `{ headline, version }`: the note beside the generated headline |
| `GET /api/projects/:slug/audit` | Orden: the last audit run, each finding with `can_fix` (`retire_decision`, `copy`, `mark_deployed`, `open`) and `owner` (`owner` or `agents`) |
| `POST /api/projects/:slug/audit/fix` | `{ code, key?, id }`: the one-click fixes as the owner (retire the decision, mark the env deployed); answers with the new run |
| `PATCH /api/projects/:slug/tasks/:key` | `{ status?, priority?, note?, version }`, as the owner through `set_task` |
| `POST /api/projects/:slug/tasks/:key/checks/:n/waive` | `{ reason }` |
| `GET /api/machine` | What runs and is stored on this machine for agent work: `{ machine, totals, items }`, every unreleased footprint with its project, initiative, ticket, session and any port lease; read-only |
| `GET /api/inbox?project=` | Everything waiting on the owner: questions, human actions, a release, footprint |
| `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id` | Agent tokens (the secret is in the create response only) |
| `POST /api/projects/:slug/tasks/:key/release` | Free a lease |
| `POST /api/projects/:slug/release/ship` | 2.13 Lanzar (merge mode): PR `from → into`, `gh pr merge --merge`, `release.merged`. Any `Authorization: Bearer` is refused with 403 |
| `POST /api/projects/:slug/tasks` | 2.12 Pedir: `{ title, summary?, priority?, parent_key? }`, a Backlog ticket as the owner with `origin: "owner"` |
| `GET /api/digest?since=`, `POST /api/digest/seen` | 2.12 Hoy: `get_digest` as the reader `screen` (reading never moves its bookmark); `{ cursor }` on "Visto" does |
| `GET /api/push/public-key`, `POST` / `DELETE /api/push/subscribe` | 2.12 push: the VAPID key (`PUSH_NOT_CONFIGURED` without it) and this device's subscription |
| `POST /api/projects/:slug/questions/:id/answer` | `{ answer, decision_text? }`. Cookie only. Any `Authorization: Bearer`, or an actor in the body or a header, is refused. The stored actor is the screen actor |
| `GET /api/export/:slug.json` | The whole project (also with an MCP token, rw or ro) |
| `GET /api/events` | Server-sent change events |

## Edge cases

- Blockers must be in the same project; a task naming itself is `BLOCKER_NOT_FOUND`. `blocked_by` replaces task and env blockers together.
- `create_task` cannot create a Blocked ticket (it takes no note): `BLOCKED_REQUIRES_NOTE`.
- `set_task` with `parent_key: null` turns a ticket into a standalone spec. Moving a ticket keeps its origin.
- Leaving Blocked clears `blocked_note`. Leaving Done clears `resolved_at`; re-marking Done keeps the first one.
- Any move out of In progress releases the lease, except to Needs owner. An answered question returns the ticket
  to its previous status; In progress whose lease ran out meanwhile returns to Ready.
- An expired lease stays on the row until the next write in that project; reads already treat it as free.
- Evidence counts from the current claim: rework after In review needs new results.
- `reserve_sequence` gives one above the highest number reserved, so an explicit `value` can leave a gap.
- Env `contains_commit` matches a sha prefix among the commits reported with `set_env` (Plania does not read git).
  `deployed_after` without a value means the next deploy after the blocker was set.

## Deviations from the handoff

- The handoff says "SDK MCP v2". No 2.x of `@modelcontextprotocol/sdk` is published.
  Plania uses the latest 1.x with `@hono/mcp`, approved by the owner on 2026-10-06.
- Contract errors listed as HTTP codes are returned inside the MCP tool result,
  because JSON-RPC calls share one HTTP 200 response. Only a missing Bearer is a real HTTP 401.
- **v2 (approved by the owner on 2026-10-06)** replaces the handoff's single-operator rules: the 12-tool ceiling,
  claims as notes with last write winning, the hand-written resume card, one markdown body per task, text-only
  criteria, and ADRs only in the product repo. `update_resume`, `create_initiative` and `set_initiative` are gone
  (`create_task` and `set_task` cover initiatives; the resume is generated).

- **UI v2, decided by the owner on 2026-10-07:** the screen is a React SPA with shadcn/ui instead of server-rendered HTML,
  and it changes status and priority inline. That adds a cookie-only JSON API under `/api` and a server-sent event
  stream, which the handoff did not have. Counts are still not on screen.

## Open

- GitHub and Vercel cannot reach a localhost server, so Plania polls them (`src/jobs/github.ts`, `src/jobs/vercel.ts`,
  every minute, with ETags): pull requests linked by `pr_url`, a `Plania: KEY` line in the body or a `Plania-Task: KEY`
  trailer; check runs as `ci` results (a red one sends an In review ticket back to Ready); merges → Merged; branch heads
  and deletions; READY deployments → `set_env` with Vercel's time and id → Released. `/hooks/*` stays for a CI that can
  reach the server.
- Background jobs run inside `pnpm start` (`src/jobs/`): the two pollers, lease warnings (`claim.expiring`, five minutes
  before a lease ends), `time_after` blockers, the audit (every ten minutes), the machine footprint and the nightly backup.
  `PLANIA_JOBS=0` turns them off (tests, `pnpm dev:api`).
- On start, the service (jobs on) writes the repo's `kit/roles/*.md` into the live `Prompt: <role>` docs, as
  `pnpm kit:sync` does: a doc edited in Plania since the last sync is left alone and named in the log (PLA-152).
  `PLANIA_KIT_SYNC=0` turns it off.
- Not built from one project's early requests: test plans and QA runs as tables (R-18: use a "Test plan" doc and `qa_run`-style
  results), runbooks with approval steps (R-23), rule proposals (R-26), and shared rules across projects (R-27).
  The v1 data cleanup (R-32) shipped in 2.9.
