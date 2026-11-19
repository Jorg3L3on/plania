---
name: grilling
description: Turns the open decisions in an idea, an order or a leg plan into closed questions the owner can answer with one tap, each with a recommended answer. Use when a product owner is about to write an Idea doc, a spec or a plan and something in it is still undecided, when a request is vague or can be read two ways, or when the owner's words leave audience, scope, priority or cost open.
---

# Grilling

Before you plan, find everything that is still undecided. You look up the facts. The owner makes the
decisions, and only the decisions, as closed questions with your recommended answer. Nothing waits for
him: if he does not answer, your recommendation stands and is recorded as an assumption he can reverse.

## Fact or decision

- A **fact** has an answer somewhere. Find it yourself and never ask for it: the repo, `get_task`,
  `get_project` (stack, settings, env), `get_resume`, `get_memory` (rules, docs, decisions),
  `thread_read` for what the owner already said.
- A **decision** is a choice between outcomes that are all acceptable, where only the owner's taste,
  money or appetite for risk can pick. Test: could two competent people with every fact still disagree?
  Then it is a decision.
- A pinned decision in `get_memory` that already settles it is a fact. Cite it; do not ask again.

## Steps

1. Read the request and everything attached to it (the order's text and pictures, the idea and its docs).
2. List every unknown. Mark each one fact or decision. Resolve every fact now and note where you found it.
3. Drop any decision whose every answer leads to the same next step. Decide it yourself.
4. Write each remaining decision as a closed question (rules below). Put the ones that change the plan
   most first.
5. Send them:
   - **Plan for a leg** (the order says «Planea «…»»): in the same `propose` (kind `plan`, with `leg`) as
     `questions`: at most 3, each `{text, options (2 to 4), suggested}` where `suggested` is the 0-based
     index of your recommendation. With more than three, keep the three that change the plan most and
     treat the rest as assumptions.
   - **Anywhere else**: one `propose` (kind `choice`) per decision. `title` is the question; each option
     has `label`, `effect` (what changes) and `cost`; exactly one has `recommended: true`, with
     `recommended_reason`. It stays in Te toca until he answers.
6. Do not wait. Continue with your recommendations and record each one with `add_decision`:
   `task_key` the idea, order or initiative, `tags: ["assumption"]`, text
   `Supuesto: <pregunta> → <respuesta recomendada>. Vale hasta que el dueño diga otra cosa.`
   Type no date in the text: the server stamps it (`TEXT_HAS_DATE`).
7. List the same assumptions under an `Assumptions` heading in the doc you are writing (`attach_doc`).
8. When the owner answers differently, `add_decision` with `supersedes: [<the assumption's id>]` and
   update the doc or the plan.

Use `ask` instead of an assumption only when no sensible default exists and a wrong guess cannot be
undone (money spent, data deleted, a message sent to real people). `ask` parks a ticket in Needs owner;
an idea never waits.

## Writing a closed question

The owner reads these in Te toca, away from the code. Write them in plain words in the owner's language.

- One sentence, one decision. Never "¿Qué prefieres?" and never two questions joined by "y".
- Two to four options that exclude each other. Do not pad to four, and offer nothing you would not build.
- Each option is something he can picture: "Solo quien creó la lista puede borrarla", not a technical
  noun. Say what changes for the people who use the app, and what it costs when the options differ.
- Exactly one recommended option, with the reason in one sentence. The reason names a fact you found.
- No ticket keys, no branch names, not the word sandbox. Title and label up to 200 characters, effect
  and reason up to 300.
- A yes/no question still describes both outcomes.

Worked examples, good and bad: [examples.md](examples.md).

## Done when

- Every unknown is either a fact with its source or a closed question.
- Every question has two to four options and exactly one recommendation with a reason.
- Every question the owner has not answered has an assumption in the decision log and in the doc.
- Nothing in the spec or plan depends on a decision that is not in that list.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4, AUDIT-8); no run on record yet. It prevents a product owner that plans on a silent guess, or that stops the work with an open-ended question about something it could have looked up.
