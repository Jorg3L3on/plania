---
name: app-walkthrough
description: Starts the delivery's test copy, walks through the change in a browser at desktop and phone width as a person would, and stops the copy. Use when QA reviews a delivery that changes what a person sees or does, when the run has browser tools and the project allows the walk-through, or when a Done when item can only be confirmed by using the app.
---

# App walk-through

Reading a diff tells you what the code says. Using the app tells you what happens. For a change a
person can see or do, the review is not complete until someone has done it.

## Before you start

Walk through only when all three hold. Otherwise report `walked: false` with the reason, and do not
improvise.

1. The run prompt says the walk-through is on for this delivery (the project's `settings.qa.browser`).
2. The run has browser tools.
3. The change shows or behaves: the diff touches the screen, or a Done when item describes something a
   person does.

## Plania tools

- `get_task` with `fields: ["title", "scope", "checks"]`: what to walk through.
- `get_project`: `settings.capture` holds how the app starts (`start_command`, with `{port}` where the
  port goes, `install_command`, `port`), when the run prompt does not give the command.
- `register_footprint` (kind `server`, locator `port:<n>`, with `purpose` and `teardown`) and
  `release_footprint`: the copy is something you started that outlives a command.
- `lease_resource` (`port:<n>`): when the project shares ports between sessions.

You stay read-only. You do not edit files, and you never fix what you find.

## Steps

1. **Plan the walk.** From the Done when and the check list, write the steps a person would take, in
   order, and what they should see at each. Add one way of doing it wrong (an empty field, a second
   tap, going back).
2. **Start the test copy** in your workspace, with the command the run prompt gives. Use a free port,
   never one of Plania's own and never a port already answering. It runs the delivery's commit, with
   test data only: never production, never a live database.
3. **Register it**: `register_footprint` with the port and the command that stops it.
4. **Wait until it answers**, then open the page. If it does not start, that is a finding: quote the
   last lines it printed, and go to step 8.
5. **Walk at desktop width, 1440.** Do each step as a person would: click, type, submit. Do not jump
   to a URL a person would not know. At each step note what you saw.
6. **Walk again at phone width, 390.** The same steps. Look for text cut off, sideways scrolling,
   buttons too small or hidden, things on top of each other.
7. **Look past the happy path**:
   - the browser console and failed requests during the walk;
   - the wrong-way step from your plan;
   - reload in the middle: is what you did still there?
   - the screen next to the change, which should look as it did.
8. **Stop the copy**, always, even when the review fails or something went wrong. Run the teardown,
   check the port no longer answers, then `release_footprint`.

## What counts as a finding

Something a person would hit: a step from the Done when that cannot be completed, a wrong result, an
error shown or logged, a layout that breaks at one of the two widths, text in the wrong language, what
was saved not being there after a reload.

Not a finding: taste, or anything outside what the ticket changed (mention it in one line as
«Fuera de esta entrega:» at most).

Each finding says the width, the step, what you expected and what happened: «A 390, paso 3: al tocar
"Compartir" el botón queda tapado por el teclado y no se puede enviar».

A walk-through finding fails the **spec** axis of the review (see `two-axis-review`). It is evidence
for a Done when or check-list item; mark that item.

## The report

The walk-through goes into the same report block as the review, in the format the run prompt gives.
Set `walked` to true only if you completed the walk at both widths. Notes are in the owner's language.

## Done when

- Every step of the plan was done at 1440 and at 390, or the report says which step could not be done
  and why.
- The console and failed requests were checked.
- Each finding names the width, the step, what was expected and what happened.
- The copy is stopped, the port is free, and the footprint is released.
- `walked` in the report says the truth.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4, AUDIT-6); no run on record yet. It prevents a review that passes a change from its diff and its stills while the flow cannot be completed in the running app, and a test copy left running on the machine after the review ends.
