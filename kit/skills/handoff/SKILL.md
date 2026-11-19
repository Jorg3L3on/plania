---
name: handoff
description: Writes the short note that lets a fresh session continue a piece of work, pointing to artifacts instead of copying them. Use when a run stops before its work is done, hands a claim to another session, routes work to another agent, runs low on turns or context, or leaves anything a later run must know.
---

# Handoff

The session that continues has none of your context. It has Plania, the repo and your note. A good
note is short because everything it mentions already exists somewhere the reader can open.

## Plania tools

- `handoff` (`key`, `to`, `note`, `head_sha`): hands your claim to another session (`to` is its
  session id) or to anyone (`"open"`). Your lease ends and the ticket returns to Ready. Whoever claims
  it next gets the note back from `start`.
- `set_task`: the initiative's `next_action`, for what comes next at that level (`finish` takes it as
  `note`).
- `assign` (`to_agent`, `note`): routes a task to another agent. The note is also a comment.
- `add_decision` and `attach_doc`: where decisions and longer findings live. The note links to them.
- `release_footprint`: for what you started and the next session does not need.
- `thread_post`: the line the owner reads.

## Before you write

1. **Commit and push.** Nothing the next session needs may live only in your working folder.
   `git rev-parse HEAD` is the `head_sha`.
2. **Put things where they belong**: a decision in `add_decision`, a finding longer than three lines
   in `attach_doc`, evidence in `add_result`. Then the note only has to point.
3. **Clean up.** Stop what you started and release its footprint, unless the next session needs it;
   then say so in the note.

## The note

Twelve lines at most, in this order. Leave out a part that is empty.

```
Estado: <qué está hecho, como punteros: commit, rama, PR, doc, resultado, pruebas>
Sigue: <la siguiente acción, tan concreta que se pueda empezar sin pensar>
No repetir: <caminos ya probados que no sirvieron, una línea cada uno, con el porqué>
Abierto: <preguntas abiertas y supuestos, por su id>
Cuidado: <lo que quedó encendido, lo que no se verificó>
```

A good `Sigue`: «Correr `pnpm test test/compartir.test.ts`; falla en la línea 44 porque el enlace no
caduca; falta la comprobación en src/listas/compartir.ts:61». A bad one: «Terminar la función de
compartir».

## Point, do not copy

- **A pointer is something the reader can open**: `archivo:línea`, a commit hash, a pull request URL,
  a ticket key, a doc title or id, a question id, a test's name.
- **Never paste** a diff, a log, a file's contents, the ticket's scope or a conversation. They go
  stale, and they bury the two lines that matter.
- **No story.** How you got here does not help. What is true now, and what is next, does.
- **Only what you checked in this run.** Mark anything else «sin verificar». A note that says the
  tests pass, when you last ran them three changes ago, sends the next session the wrong way.
- **Dead ends are worth a line each.** They are the one thing the reader cannot find anywhere else.

## Who reads it

The note is for an agent: write it in the language of the ticket, with exact identifiers. The line
for the owner (`thread_post`) is plain words in the owner's language, says what was done and what is needed from him, and
carries links instead of keys in the sentence.

## Done when

- Everything is committed and pushed, and `head_sha` is the head.
- A session with only the note and Plania could name the next command to run.
- Every statement in the note has a pointer, or is marked «sin verificar».
- The note is twelve lines or fewer and contains no pasted content.
- Nothing you started is left running without being named in the note.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4, AUDIT-7); no run on record yet. It prevents a retry in a fresh session that repeats the dead ends of the first one, and handoff notes so long with pasted logs that the next session reads none of it.
