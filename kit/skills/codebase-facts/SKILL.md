---
name: codebase-facts
description: Reports what a codebase does today as verifiable facts, each with its file and line, and nothing else, with no opinions, proposals or judgement of quality. Use when Research is asked how something works in a repo, where something lives, what a change would touch, or to map the code before a design or a plan is written.
---

# Codebase facts

The reader will design or plan on top of what you write. An opinion mixed into the facts steers that
work without anyone having decided it. So you report what is there, where it is, and stop.

## Plania tools

- `get_task` and `get_doc`: the question you were asked.
- `attach_doc`: the result, on the idea or ticket. Either a doc titled `Codebase facts`, or inside the
  Research doc under `What we learned`.
- `add_result` (kind `grep`) on a research ticket, citing the doc; `finish` to deliver it.
- `thread_post`: the closing line, with a link of kind `doc`.

You change nothing in the repo.

## The form of a fact

```
ruta/desde/la/raiz.ts:123 — lo que hace el código en esa línea, en presente.
```

Someone who opens that line must see what you said. The path is relative to the repo root; the line is
the line at the commit you read.

Allowed:

- What exists and where it is.
- What calls what, and in which order.
- The shape of the data: fields, types, which are required.
- Which tests cover a behaviour, with their file and line.
- That something is absent, **with the search that showed it**: «No hay prueba que cubra el borrado
  (búsqueda: `rg "delete" test/`, sin resultados)».

Not allowed, anywhere in the doc:

- should, better, cleaner, messy, legacy, fragile, risky, over-engineered, or any other word that
  judges quality;
- recommendations, alternatives, "could be simplified by";
- guesses about why someone wrote it that way.

If the request also wants options or a recommendation, that is a second deliverable: the `Options` and
`Recommendation` sections of the Research doc, kept apart from the facts.

## Steps

1. Record what you read: repo, branch, and commit (`git rev-parse HEAD`). It goes at the top of the doc.
2. Turn the request into questions. Group the findings by question, not by file.
3. Read the code itself. A name, a comment or a README is a lead, not a fact: follow the call to its
   definition before you write it down.
4. Mark each line `visto` (you read the code that does it) or `inferido` (you conclude it from other
   lines; name them). Keep `inferido` rare.
5. Run nothing that writes. Existing read-only commands (a test, a type check) are fine when a
   behaviour cannot be settled by reading.
6. Before attaching, read the doc once looking only for judging words, and delete each one.

Sentences are plain words in the owner's language. Identifiers, paths and commands stay exactly as they are in the code.

## Done when

- Every finding has a file and a line.
- The commit you read is named.
- Every "it is not there" carries the search that showed it.
- No sentence judges or proposes.
- Another person could open each reference and see exactly what the line claims.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a codebase summary where facts, guesses taken from names and comments, and the researcher's preferences are mixed, so the plan built on it inherits choices nobody made.
