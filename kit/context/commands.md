# Commands — <project>

<!--
Template. Copy it for the project and fill it in.

Budget: this file, glossary.md and map.md together stay under 200 lines.
Write only what an agent cannot find by reading the repo. A script that is obvious from the manifest
needs no line here; a command that fails unless something else is done first does. Delete these
comments when you are done.
-->

Every command runs from the repo root unless it says otherwise. Each line is the exact command, then
what "it worked" looks like.

| To | Run | It worked when | Takes about |
|---|---|---|---|
| Install | <!-- pnpm install --frozen-lockfile --> | <!-- exits 0 --> |  |
| Run the app | <!-- pnpm dev --port {port} --> | <!-- answers on http://localhost:{port} --> |  |
| Test | <!-- pnpm test --> | <!-- "N passed, 0 failed" --> |  |
| Test one file | <!-- pnpm test path/to/file --> |  |  |
| Lint | <!-- pnpm lint --> |  |  |
| Type-check | <!-- pnpm exec tsc --noEmit --> |  |  |
| Build | <!-- pnpm build --> |  |  |

The checks Plania runs on every delivery are the project's verify list in Plania. Keep the two in
step: a check listed here and not there is not enforced.

## Before the first command

What must exist or be running first, and how to get it: a local database, an env file made from an
example, a code generator.

- <!-- e.g. cp .env.example .env.local; the values in the example are enough for tests -->

## What fails, and why

Commands that look right and are not, and failures that mean something other than what they say.

- <!-- e.g. "pnpm test" hangs if the dev server is running on the same port -->

## Never run

Commands in this repo that touch real data, cost money or cannot be undone.

- <!-- e.g. pnpm db:push (writes to the shared database) -->
