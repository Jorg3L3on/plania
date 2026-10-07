# Projects view redesign: implementation plan (direction A, "Noche")

Design: https://claude.ai/artifact/PkDTA81k3sgjTjq2H2rDUF, artboards "A · Proyectos" and "A · Proyecto (Filmia)".
Branch: `jl/projects-view-redesign-464059`. Scope is the screen only: `ui/` plus two small additions to `src/api/routes.ts`.

## Principles carried over from the design

- An initiative is a **lane**, never a step. Several lanes move at once.
- Three glyphs instead of status words: filled check = done, pulsing dot = now, hollow circle = pending.
- Only lanes with someone working on them move. Everything else is still.
- Color means state. Roughly 95% of the screen stays neutral.
- Every card opens the existing task side panel (`?task=KEY`). Status and priority are still changed there.

## Data: what exists and what is derived

Everything A shows can be derived from data the app already has, with two exceptions noted below.

### Lane derivation (pure function, `ui/src/lib/lanes.ts`)

One lane per initiative that is not Done or Won't do, plus a "Sueltos" lane for tickets without a shown initiative.
Each lane's tickets fall into four columns:

| Column | Tickets |
|---|---|
| Hecho | `Done`. Show the most recent one and a count. |
| Ahora | `In progress`, `In review`, `Blocked` |
| Siguiente | `Ready`, ordered by priority. If none, the highest-priority `Backlog` ticket. |
| Después | Remaining `Backlog`, as chips |

`Won't do` tickets are hidden. Each lane also gets a state:

- **moving**: at least one `In progress` or `In review`. Only this state pulses.
- **blocked**: at least one `Blocked` and nothing moving.
- **waiting**: nothing in Ahora. The Ahora cell reads "Nadie trabaja aquí".

Lane order: `Active` and `Shipping` first, then `Planning`, then `On hold`; ties by best child priority, then most recent update. Sueltos is always last.

The subway line under each initiative uses the same order: done stations, then now, then next, then later.

The function has no imports, so `test/lanes.test.ts` can test it directly with `node:test`.

### Gap 1: "Te toca a ti"

There is no field that says a ticket waits on Jorge. Recommendation: **no schema change**. Use the existing `Blocked` status with a `blocked_note`, and add one sentence to the `set_task` tool description telling agents to mark work that waits on Jorge as Blocked with a note that starts with "Jorge:". The strip then lists Blocked tickets across lanes, showing their notes. The resume's `next_action` stays in the Ficha panel.

The alternative is a new `waiting_on` column, which means a migration, an MCP contract change and seed updates. Not worth it until the convention fails.

### Gap 2: "Rama y prod" and migrations

The git graph in the design comes from free text. In the build:

- Add `branch` and `base_branch` to `screenTasks()` in `src/api/routes.ts`. Initiatives already store them.
- Draw the graph from initiatives' `branch → base_branch` edges, so it stays correct for every project.
- Show `resume.branch_or_prod` under the graph as plain text.
- **Drop the migration chips.** They were Filmia-specific and have no structured source.

### API additions

1. `GET /api/projects` also returns each project's tasks without bodies, the same shape as `screenTasks()`. The index needs lanes per project. Payloads are small, so no separate summary endpoint.
2. `screenTasks()` gains `branch` and `base_branch`.

Both get tests in `test/api.test.ts`. No MCP changes besides the one-sentence description edit for Gap 1.

## Phases

Each phase ends with `pnpm build` and `pnpm test` passing and is one commit.

### Phase 1: foundation

- Fonts: add `@fontsource-variable/bricolage-grotesque` and `@fontsource/geist-mono`. Keep Geist for body.
- Tokens in `ui/src/index.css`: ground `#0f1118`, surface `#161926`, text `#eef0f6`, muted `#a3a9bd`, and status hues as CSS variables: done `#3ddc97`, now `#ffc145`, review `#b094ff`, ready `#5ec8ff`, blocked `#ff6b8a`, pending `#4a5068`.
- Light theme gets the same hues at lower lightness, as in direction B, so the theme toggle keeps working. Dark is the default.
- Rewrite `ui/src/lib/status.ts` to map statuses to those variables instead of Tailwind color classes.
- Keyframes in CSS: `rise` (staggered entrance), `now-pulse`, `station-pulse`, `dash-flow` for arrows, `ring-fill`, `orb-drift`. All disabled under `prefers-reduced-motion`.
- App shell: widen to `max-w-6xl`, use the Bricolage wordmark, keep the live indicator and theme toggle.

### Phase 2: data layer

- `lanes.ts` with `buildLanes(tasks)` and `projectProgress(tasks)` returning done and total.
- `test/lanes.test.ts` covering the four columns, the three lane states, the Backlog fallback for Siguiente, lane ordering and the Sueltos lane.
- The two API additions with tests.

### Phase 3: project page

New components in `ui/src/components/project/`:

- `ProjectHeader`: kicker, big title, one-line body summary, progress ring, and count legend.
- `YourTurnStrip`: Blocked tickets from Gap 1. Hidden when empty.
- `LaneGrid`: column headers, then one row per lane with animated arrow connectors. Arrows are dashed and moving after a moving cell, dotted and still after a waiting one.
- `InitiativeLine`: subway line per initiative with an "Aquí" label on the current station.
- `BranchGraph`: the graph from Gap 2.
- `FixedDecisions`: the first lines of `must_keep_decision`, plus a "Ver la ficha completa" button that opens a sheet with all four resume fields.
- A "Lanes / Lista" toggle at the top. Lista is today's grouped list with filters and closed tickets, kept as is for search and bulk review.

### Phase 4: projects index

- `ProjectTrack`: color stripe, name, slug, progress bar, then one Ahora → Siguiente row per lane, and a mini subway per lane on the right.
- Projects with no initiatives show the resume's `in_progress` and `next_action` lines instead.
- Projects with nothing open render dimmed and dashed, like Zigzag.
- A cross-project "Te toca a ti" strip at the bottom.
- Each project gets a stable accent color from a fixed list, hashed from its slug.

### Phase 5: motion and live updates

- Add `motion` (Framer Motion) for layout animation. When an agent moves a ticket from Siguiente to Ahora over MCP, the card slides between columns instead of jumping.
- Replace the amber row highlight from `useLive().isFresh` with a short glow on the card that changed.
- Entrance stagger on first load only, not on every live refetch.

### Phase 6: responsive, accessibility, verification

- Below 768px the lane grid becomes one card per lane: Ahora, an arrow pointing down, then Siguiente. Después collapses to a count.
- Every card is a real `<button>` or link with a visible focus ring. Arrows and glyphs are `aria-hidden`; each lane has a text label for its state.
- Check contrast of muted text and status hues against both grounds.
- Verify in the browser against a preview database, never the real `plania` one, with Filmia's seed data and a fake lane with four or more initiatives.

## Decisions (Jorge, 2026-10-07)

1. **"Te toca a ti"** uses the convention: Blocked with a note that starts with "Jorge:". No new field.
2. **Many lanes.** Past four active initiatives, the index folds lanes that have not moved in a week, behind a "ver todas" toggle.
3. **Lista view** stays as a toggle next to the lanes.
