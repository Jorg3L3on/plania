# 0008. One Pedir bar inside a project, one Pedir palette for the app

Status: Accepted
Recorded: 2026-11-21 (Inicio redesign)

## Context

«Un solo Pedir» (PLA-I3-6) made La corriente's bar the only place to ask a project for something. Inicio still had
its own field (2.12, PLA-87). The owner could ask from those two places only. Every other screen (the Bandeja, the
machine, Progreso) needed a trip back first. Inicio's field also took a full row of the page every day, even though it
was used now and then.

## Decision

There are two ways to ask, each for its own place:

- **Inside a project**, La corriente's Pedir bar stays what PLA-I3-6 made it: the project's Pedir, with `/` to focus
  it.
- **Anywhere in the app**, the Pedir palette opens with ⌘K on a Mac or Ctrl+K elsewhere, or from the header's button
  on a phone.
  - It starts on the project of the screen it was opened from (`/p/<slug>`, or La corriente's floor). Otherwise it
    starts on the project asked last on this device, or the first.
  - `@` changes the project.
  - Typing a project's or a screen's name goes there instead of asking.

Both send through the same route and modes (`POST /api/company/projects/:slug/ask`, Darle forma / Hacerlo ya /
Preguntar), with the same 2000-character limit. A request made from either enters the idea flow the same way. Inicio
no longer has a field of its own.

## Consequences

- The owner can ask from every screen without leaving it. Inicio gets its row back.
- Inside a project there are two ways in, the bar and the palette. They land on the same project and the same route,
  so the request is the same whichever is used.
- The palette's keys must not take a key the screen uses: it takes only ⌘K / Ctrl+K, never with Alt or Shift, and
  never opens over another dialog.
- On a computer the palette opens and closes with no animation. It is opened many times a day, and motion there would
  make the key feel slow.

## Where it shows

- `ui/src/lib/paleta.ts`: the key, the starting project, the rows and the words. Tested in `test/paleta.test.ts`.
- `ui/src/components/paleta/paleta.tsx`, mounted once in `ui/src/components/app-shell.tsx`.
- `ui/src/components/corriente/pedir-bar.tsx`: the project's bar, unchanged.
- `test/pla87-pedir-home.test.ts`: the route, the modes and the limit, now read from the palette.
