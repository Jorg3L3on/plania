# 0007. Teams are data, and a company travels as text in the open agent-companies layout

Status: Accepted
Recorded: 2026-11-21 (PLA-I71-6)

## Context

The team a project gets was code: four core roles made by `ensureTeam`, specialists added one by one. The owner asked
for ready-made teams, for saving a team that works and reusing it in another project, and for taking the whole company
to another machine or another install. Other tools (Paperclip) already describe companies of agents as a folder of
markdown files with frontmatter; a team written there should be readable here, and ours there.

## Decision

- A team is data: seats (a role from the catalog, or a role of the owner's own with its title, line and base role),
  who reports to whom by role, the skills each seat carries by slug, a suggested motor and the owner's manner. Lessons
  and references travel only when the owner ticks them. Factory teams are files in `kit/teams/` (reviewed in git, as
  the rest of the kit, ADR 0005); saved and brought teams live in `team_templates` (0077).
- Adopting is a copy. The plan is computed without writing and shown first; new seats arrive paused; the template
  never follows the project afterwards. Each adoption records the template's hash in `team_adoptions`.
- The whole company travels as plain text in the open layout: `COMPANY.md`, `teams/<project>/TEAM.md`,
  `agents/<agent>/AGENTS.md` (name, title, team, role, reportsTo, skills; the body is the manner), `skills/<slug>/SKILL.md`
  for the owner's and brought skills, and one sidecar, `plania.yaml`, for what the layout has no field for (motors,
  roles of the owner's own, ticked lessons and references, secrets by name). It is one plain tar so any tool opens it.
- Never in the package: a secret or its value, code, tasks, usage, or a path of this machine; free text passes through
  the same scrub the screen uses. A test scans the package for each.
- Import shows create, rename or skip per item (rename by default when a name is taken), writes only after that,
  brings everyone paused and every skill off with the same review a brought skill gets (ADR 0006, PLA-I71-5), and lists
  fields it does not know instead of refusing them.

## Consequences

- A team can be compared, reviewed and shared as text, and a team from another tool can be read without a converter.
- Factory teams change with a commit; the owner's teams change on the screen; neither changes a project that adopted
  them.
- The sidecar is Plania's own and other tools ignore it, so motors and owner roles do not survive a round trip through
  them; the seats, managers and skills do.

## Where it shows

- `src/runner/teams.ts` (catalog, save, adopt), `src/runner/company-package.ts` (export, tar, import),
  `kit/teams/*.json`, `drizzle/migrations/0077_team_catalog.sql`.
- The screen: Equipo's «Equipos» place, its adopt preview, and «Compañía completa»
  (`ui/src/components/corriente/equipos.tsx`).
