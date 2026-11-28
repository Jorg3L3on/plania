# The agents' kit

What a runner agent knows is kept in this repo under `kit/` and every run is stamped with the version it got ([kit/README.md](../kit/README.md), [docs/adr/0005](adr/0005-the-kit-lives-in-git-and-runs-are-stamped.md)).

| Piece | Where | How a run gets it |
|---|---|---|
| Role prompt | `kit/roles/<role>.md`, live copy in the Plania doc `Prompt: <role>` | Appended as system prompt on a session's first run. With no doc the repo file is used. |
| Skills | `kit/skills/<slug>/SKILL.md` (Claude's skill format); a `Pack: <name>` doc still counts when the repo has no folder with that slug | Written as a plugin in the run's temp folder and passed with `--plugin-dir`. Nothing is written into the app's worktree. |
| Default skills per role | `kit/kits.json` | A seat that lists no packs carries its role's list. |
| Project context | Project docs `Context: Glossary`, `Context: Commands`, `Context: Map` (templates in `kit/context/`) | Appended to the role prompt, cut at 200 lines. |

`pnpm kit:status` compares the role prompts in the repo with the live docs; `pnpm kit:export` writes Plania's into the repo; `pnpm kit:sync` writes the repo's into Plania and leaves a doc alone when it was edited there since the last sync (`--force` overwrites).

Each `agent_runs` row records `prompt_version` (`<doc version>:<sha>`), `skills` (`<slug>@<sha>`), `skills_used` (what the stream showed) and `context_tokens`. The Calidad page (`/calidad`, `GET /api/scoreboard`) reads them: first-pass QA rate, deliveries sent back after QA passed, runs and tokens per landed ticket, failures by reason, resumed against fresh runs, by role, model, prompt version or skills.

Checks inside the run (`settings.qa`, set with `set_project`):

| Key | What it does |
|---|---|
| `verify` | The list QA runs. The builder's prompt names it, and `finish` runs it in the ticket's workspace and refuses a failing delivery with `VERIFY_FAILED` and the last lines. |
| `verify_on_finish: false` | Turns the run at `finish` off; the QA lane still runs the list. |
| `after_edit: {command, timeout_seconds}` | Runs after every file edit of a builder's run, as a hook in the run's own settings file. |
| `browser: true` | The QA run starts the test copy and walks through the change with browser tools (needs `settings.capture`). |
| `retro: true` | A delivery QA or the owner sent back queues one Asistente run that proposes one fix. |

The QA review returns two verdicts that are stored apart: whether the change does what was asked, and whether the code is sound.

Runner switches (environment):

| Var | Value |
|---|---|
| `PLANIA_RUN_ISOLATION` | `project`: a run loads no user-level settings, skills or CLAUDE.md of the account the server runs as. `bare`: no auto-discovery at all. Unset (or `off`): the CLI's defaults. The install command writes `project` into a new `.env`; an existing `.env` is left as it is. It limits what a run loads, not what it can read: the screen page `/machine/limites` says what the rules do and do not stop. |
| `PLANIA_KIT_MODE` | `worktree` keeps the older delivery of packs into `.plania-packs/` in the working folder. |
| `PLANIA_DEFAULT_KITS` | `0`: seats without packs carry none. |
| `PLANIA_RETRY_FRESH` | `1` (default) fresh session after a failure, a QA return or a long session; `0` always resume; `ab` alternates, so the scoreboard can compare both. |
| `PLANIA_RESUME_MAX_CONTEXT` | Context tokens above which a session is not resumed. Default 120000. |
| `PLANIA_BROWSER_MCP` | The command for the QA browser tools. Default `npx -y @playwright/mcp@0.0.86 --headless --isolated` (pinned with the Conexiones catalog, `src/runner/conexiones.ts`). |
| `PLANIA_KIT_DIR` | Another folder for the kit (tests). |

The replay set (`replay/`, [replay/README.md](../replay/README.md)) reruns saved tickets against a prompt, skill or model change: `pnpm replay:capture <project> <key>`, `pnpm replay --trials 3`, `pnpm replay --compare a.json b.json`.
