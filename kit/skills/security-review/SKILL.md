---
name: security-review
description: Reviews the security of one change, limited to its diff, and reports findings by file and line with a severity. Use when Seguridad is woken on a delivery, a pull request or a ticket that touches sign-in, permissions, payments, personal data, file uploads, outbound requests, secrets or dependencies, or when asked whether a change is safe to merge.
---

# Security review

You review what this change adds or alters, not the whole app. A finding is a way for someone to cause
harm through the changed lines, stated so a builder can fix it: where, how, how bad.

## Plania tools

- `get_task`: the ticket, its scope, its branch and pull request.
- `add_result`: kind `security`, with `verdict`, `cite`, `commit` (the head you read) and `branch`.
- `attach_doc`: the findings, on the ticket, titled `Security review`.
- `create_task` (work type `bug`, with `severity`): a serious problem that was already there, outside
  this diff.
- `thread_post`: the closing line, in plain words in the owner's language, with a link to the doc.

You do not fix and you do not edit the delivery. If you were given your own ticket for the review,
`start` it and `finish` it with the `security` result.

## Scope

- **In**: the lines in `git diff origin/sandbox...HEAD`, and as much of the code they call, or are
  called by, as you need to judge them.
- **Out**: problems that existed before the change. They are not findings of this review. One that is
  serious becomes its own bug ticket, and you mention it in one line.

## Steps

1. Record the commit: `git rev-parse HEAD`.
2. Read the whole diff once to learn what the change does and what data passes through it.
3. Go through the categories in [checklist.md](checklist.md). Skip, in one line, those the diff cannot
   touch.
4. For each suspicion, trace the path: where the input comes from, what it passes through, where it
   does harm. No path, no finding.
5. Write the findings, most severe first.

## The form of a finding

```
archivo:línea · severidad · visto | posible
Qué puede pasar: quién, con qué entrada, qué consigue.
Arreglo: una frase.
```

| Severity | Meaning |
|---|---|
| crítica | Anyone can exploit it now: data leaked or destroyed, sign-in bypassed, a secret committed |
| alta | Needs an account or a particular condition, and then gives access or data that are not the person's |
| media | A weakness that needs another flaw to do harm |
| baja | Hardening: worth doing, harmless today |

- `visto`: you traced the path in the code. `posible`: you could not confirm it; list these apart.
- Do not raise the severity to be safe or lower it to be kind. If you cannot say who gains what, it is
  not `alta`.
- **A secret in the diff** (a key, a token, a password, a URL with credentials): give the file, the
  line and the kind of secret, never its value, anywhere. It is `crítica`, and the fix includes
  replacing the secret, which only the owner can do: say so.

Write the findings in the owner's language. Paths, identifiers and commands stay as they are in the code.

## Verdict

| Findings marked `visto` | `verdict` |
|---|---|
| Any `crítica` or `alta` | `fail` |
| Only `media` | `warn` |
| Only `baja`, or none | `pass` |

`cite` gives the count by severity and the worst finding in one line:
«Seguridad: 1 alta, 2 bajas. src/listas/borrar.ts:27 borra sin comprobar el dueño.»

A `pass` says what you covered: «Sin hallazgos en 6 archivos; categorías revisadas: entradas,
permisos, secretos, dependencias».

## Done when

- Every file in the diff was read.
- Every finding has a file and line, a severity, a concrete harm and a fix.
- No finding is about code the change did not touch.
- No secret value appears in the doc, the result or the thread.
- The `security` result names the head commit, and the doc is attached.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a security pass that audits the whole repo and returns general advice with no file, line or severity, which nobody can act on before the merge.
