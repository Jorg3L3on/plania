# Contributing to Plania

Thanks for wanting to help. This page says what a pull request needs before it can be merged. How the code is laid
out, how to run it and the rules with no exceptions are in [CLAUDE.md](CLAUDE.md), [README.md](README.md) and
[docs/developers.md](docs/developers.md); read those first, this page does not repeat them.

## Before you start: get a ticket

Plania plans its own work in Plania, and every change belongs to a ticket there. The plan server runs on the
owner's machine, so you cannot create one yourself:

1. Open an issue (or write to the owner) with what you want to change.
2. The owner creates the ticket and gives you its key, for example `PLA-172`.
3. Use that key in your commits, in comments next to the code it explains, and in the pull request body as
   `Plania: PLA-172`.

Do not reuse a key you found in the history or the code: those belong to work that already shipped.

## One ticket, one pull request

- Keep a pull request to one ticket. Two features means two tickets and two pull requests.
- Branch from the latest `main`. Before you ask for review, and whenever `main` moves, rebase on it (or merge it in)
  and run the checks again. `main` only accepts a branch that is up to date and green, and a branch that merges
  without conflicts can still break on a newer `main`.
- Do not edit the workflows in `.github/workflows/` in a feature pull request.

## The checks

Run all of these on your branch, after updating it from `main`:

```bash
pnpm exec tsc --noEmit
```

```bash
pnpm exec tsc -p ui
```

```bash
pnpm test
```

The tests make their own `plania_test_*` database and never touch one named `plania`. Never run `pnpm seed`.

CI runs the same checks on Linux and macOS. On your first pull request, CI waits until the owner approves it to run.

## Rules that catch most first pull requests

- **Words on the screen are plain Spanish**: no ticket keys, branch names, error codes in capitals or English. Code,
  comments, commits and docs are English. See [docs/screen-words.md](docs/screen-words.md).
- **A new failure gets a code** in `src/mcp/errors.ts`, not a free-text message.
- **When an MCP tool or an error changes**, regenerate the README tables with `pnpm mcp-table` and
  `pnpm error-catalog` (`test/readme.test.ts` fails otherwise).
- **When the protocol text changes meaning**, bump `PROTOCOL_VERSION` in `src/mcp/protocol.ts`.
- **Migrations**: add the next numbered file in `drizzle/migrations/`, safe to run twice. Never apply one to a real
  database; the owner does that. Say in the pull request that it has one.
- **Every outside call is injected in tests** (git, `gh`, the Claude process, the clock). A test that needs the
  network or a real `claude` is wrong.
- **No secrets in git.** `.env` stays local.
- **Keep `.gitignore` for Plania's own files.** Folders from your editor or AI tools (`.idea/`, `.agents/`,
  `.cursor/`…) go in your global ignore file (`git config --global core.excludesFile`).
- **No AI-agent files in the repository** (`AGENTS.md`, `.cursor/`, `.claude/`, skills, hooks). Plania gives agents
  what they need through its own server.
- **Plania is a product.** Never name a real customer project, or its ticket keys, in code, tests, commits or pull
  requests. Use made-up examples.

## Changes to the screen

Type-checks and tests do not show whether a screen works. For any change under `ui/`:

- Run it in a browser against a throwaway database (README "Setup by hand"), never your real one.
- Try every state you touched: empty, loading, error, a long list, a phone width (375 px) and reduced motion.
- Attach screenshots or a short recording to the pull request.

## Review

The owner reviews and merges. A review may ask for changes; push them to the same branch. Large or new screens
usually go through a design step in Plania first, so ask before building one.

## Licence

The licence is not written yet ([LICENSE](LICENSE)). Until it is, the owner may hold a pull request before
merging it.
