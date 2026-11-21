# 0006. What the owner writes for an agent lives in versioned data, and runs are stamped with it

Status: Accepted
Recorded: 2026-11-19 (PLA-I67, El oficio); written down 2026-11-21 (PLA-I71-3), which adds the role catalog

## Context

ADR 0005 put Plania's own kit (role prompts, factory skills, default kits) in git. But the owner of an install
also teaches agents things: a skill of their own, a copy of a factory skill with their changes, a lesson, "your
manner" for one seat, a reference, a role of their own. That text belongs to that install, not to Plania's repo:
it differs per company, it is edited on the screen by someone who does not use git, and it must never ship to
other installs. It still needs what 0005 gives the kit: a history, a way back, and runs that say which text they
ran with.

## Decision

What the owner writes for an agent is data in their Plania database, versioned in place:

- Owner skills and copies of factory skills: `skills` and `skill_versions` (0068). Every save is a new version
  with its hash; rollback makes a new version from an old one; a deleted skill is archived for 30 days.
- Lessons (0069, 0072): proposed by Plania or taught by the owner, active only after the owner's yes; each edit
  is a new version; retired, not deleted.
- "Your manner" per seat (`agents.manner`, 0068) and references (0070) carry their own version or hash.
- PLA-I71-3: the role catalog is data too (`puestos`, 0075). The factory roles are seeded from the code's list
  (src/runner/team.ts) and keep their prompt in `kit/roles/`; a role of the owner's own is a title and one line on
  a factory role's prompt (`prompt_ref`), and its line travels with every run of the seat as its manner.

Every run is stamped with what it carried: the role prompt's version, each skill's version hash, the lessons and
the manner's version, as 0005 stamps the kit. The screen shows the history and the way back. Runs never edit any
of it: an agent may only propose (a lesson from a correction, a seat with its reason) and the owner decides.

## Consequences

- An owner's knowledge never leaves their install unless they export it (PLA-I71-6), and never reaches Plania's
  repo; the repo carries only the factory kit and the code that reads both.
- The owner can see, compare and undo every change without git, and results can be compared by version as with
  the kit.
- Two sources must be merged at run time (kit files, then owner data on top); the order is fixed in
  src/runner/skills.ts and the run's stamp names both.
- New roles do not need a deploy, but every role still runs on a prompt that came from the kit, so what a role
  is allowed to do stays reviewed in git.

## Where it shows

- `src/runner/skills.ts` (owner skills, versions, the merge with the kit, the puesto read), `src/runner/lessons.ts`,
  `src/runner/lesson-watch.ts`, `src/runner/references.ts`.
- `src/runner/puestos.ts` and `drizzle/migrations/0075_equipo_puestos.sql` (the role catalog, a PO's seat proposal).
- The screen: a seat's panel beside Equipo's org chart (`ui/src/components/corriente/agente.tsx`).
