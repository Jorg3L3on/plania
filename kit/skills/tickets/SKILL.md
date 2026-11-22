---
name: tickets
description: Breaks a spec, an order or a leg of the route into steps that are each a thin vertical slice someone can try end to end. Use when a product owner writes a Plan doc, answers one of the owner's orders with a plan, plans a leg, or creates tickets, and when an existing step is too big for one session, has no testable Done when, or covers a single layer such as only the database or only the screen.
---

# Tickets

Every step you write will be built by a fresh session that has read only that ticket. It must be able
to finish in one run, and when it finishes, a person must be able to try something new.

## What a slice is

A slice goes through every layer it needs (data, logic, screen) so that one new thing works in the
running app. A layer ("crear las tablas", "hacer la pantalla") gives nobody anything to try.

Ask of every step: **¿qué puede probar alguien cuando este paso termine?** If the answer is "nada
todavía", it is a layer. Merge it into the first step that needs it.

The first step is the thinnest path that works end to end, even if it is ugly and handles one case.
Later steps widen it: another case, another role, the error states, the polish.

Splitting patterns and worked examples: [slices.md](slices.md).

## Small enough for one session

A step is too big when any of these holds. Split it.

- More than three Done when items.
- "y" in the title.
- It covers more than one flow a person goes through.
- It needs a decision halfway. Settle it first with the `grilling` skill.
- You cannot say what the builder will run to know it works.

## What each step carries

- **Title**: the outcome, verb first, plain words in the owner's language, up to 200 characters.
- **Done when**: one sentence a person can check by trying it or by running one command. It names
  concrete values. "Funciona el filtro" is not testable; "Al escribir «le» en el buscador solo quedan
  los productos cuyo nombre contiene «le»" is.
- **Work type**: `code`, `ops`, `research`, `bug` or `debt`. When a fact is missing, the first step is a
  `research` step that finds it.
- **Blockers**: which steps must land before this one. No step may depend on a later one.
- **Needs the owner**: yes or no, and for what (a credential, a payment, an account in a store, a
  decision). A step that needs him says so up front, so it is not discovered mid-build.

## Where it goes

| Work | Tool | Notes |
|---|---|---|
| An idea at stage `planning` | `attach_doc`, `title: "Plan"`, headings `Steps`, `Done when`, `Risks`; then `set_task` with `stage: "ready"` | The doc carries every field above per step |
| One of the owner's orders | `propose` kind `plan`: `order` (its key), `understood`, `steps [{title, done_when, work_type}]`, `cost` | 1 to 10 steps. When the project approves plans, create no tickets: Plania makes one Ready ticket per step when someone presses «Sí, empiecen» |
| A leg of the route (the order says «Planea «…»») | the same `propose` with `leg`, at most 4 steps, `questions` (up to 3, see `grilling`) and `checklist` (exactly 3) | Always waits for «Aprobar el plan». A postponed leg is refused (`LEG_POSTPONED`): never plan it to start it |
| Tickets you create yourself | `create_task` with `scope`, `checks` (the Done when list), `parent_key` and `phase`, `blocked_by`, `priority` | `code` and `ops` tickets need at least one check (`TEMPLATE_INVALID`) |

Never both for the same order: either the plan is proposed, or the tickets are created.

`understood` is one plain line saying what you understood of the order. No ticket keys, branch names or
the word sandbox in `title`, step titles or `understood`: anyone at the machine reads them.

`cost` is honest: `tickets`, `days`, `tokens`, and `delays` when this pushes other work back.

The `checklist` of a leg is three things QA verifies on every step, so they are cross-cutting ("se ve
bien en el teléfono", "lo que ya estaba guardado sigue ahí"), not a repeat of one step's Done when.

A step that needs the owner: on a ticket, `blocked_by: [{human_action: {text: "<what he has to do>"}}]`,
which reaches his inbox. In a proposed plan, the steps carry only three fields, so name it in the Plan
doc and add the blocker with `set_task` once the tickets exist.

Leg steps run in order: Plania blocks each one on the step before it. For tickets you create, write the
blockers yourself as keys in `blocked_by`, except for the steps of an idea's plan that has `depends_on` or
`files`: there Plania fills `blocked_by` and `areas` from the plan when you leave them out.

## Done when

- Every step answers "what can someone try when this is done".
- Every step has a Done when a person could check without reading code.
- No step has more than three Done when items or depends on a later step.
- Blockers and the owner's part are named on the steps that have them.
- The plan was sent with `propose`, or the tickets exist. Not both.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents plans cut by layer, where the first steps deliver nothing to try and one step is too large for a single run to finish.
