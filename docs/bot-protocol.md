# Bot loop

Plania wakes an agent on its heartbeat, or when someone calls `wake_agent`. The agent then:

1. `check_in` with the roster slug.
2. Claim Ready work (`claim` or `start`) that it owns or that matches its role.
3. Do the work.
4. `report_tokens` for that run.
5. `check_in` again when it is idle.

`adapter_config` stores environment variable names only. Do not put secrets, URLs, or token values in it.

A second `wake_agent` inside `heartbeat_minutes` does nothing. `dry_run` does not open a socket or a process and does not record a run.

## Proposals (protocol 2.19)

A product owner offers options or answers one of the owner's orders with `propose`, never with prose only. The owner (or anyone at the Mac) decides it in Te toca.

- `kind: "choice"`: a title and 2 to 6 options. Each option has a `label`, an `effect` (what changes) and a `cost` (`tickets`, `days`, `tokens`, `delays`). One option may be `recommended`, with `recommended_reason`. `combinable` lists the options that may be chosen together, for example `[[1, 2]]`; leave it out when they exclude each other, and Te toca will not offer "1 + 2". The proposal stays in Te toca until it is answered, even if the PO writes again.
- `kind: "plan"`: the answer to an order (`order` is the order ticket's key). It says what the PO `understood` in one plain line, the `steps` (each with `done_when` and `work_type`) and the `cost`. When the project approves plans (on by default for a new project), the PO creates no ticket for the order: Plania creates one Ready ticket per step when someone presses "Sí, empiecen". "Cambiar algo" sends the order back to the box and "Cancelar" closes it. Without approval the tickets are created at once and the plan shows as information.

Titles, labels and `understood` use plain words: no ticket keys, branch names or the word sandbox. Anyone at the Mac reads them.

## Idea stages as data (protocol 2.23)

An idea moves idea → research → design → planning → ready. The owner of a stage delivers it with `deliver_stage` (`project`, `key`, `stage`, `data`), then moves the idea with `set_task` stage. Plania checks the data, writes the stage doc (same title and headings as before) and keeps the data in a `stage.delivered` event (`stage`, `data`, `doc_version`). The owner's screen reads that data.

| `stage` | `data` |
| --- | --- |
| `idea` | `problem`, `who`, `why_now`, `decisions` (0 to 6) |
| `research` | `learned` (list), `options` (2 to 4, each `title` and `text`), `recommendation` (`option`, `why`), `unknowns` (list, may be empty) |
| `design` | `approach`, `scope` (list), `out_of_scope` (list, at least one thing) |
| `planning` | `steps` (1 to 6, each `title`, `done_when`, `try_it` and an optional `work_type`), `risks` (list), `size` (optional, one line) |

Every index is 0-based: `decisions[].recommended` and `recommendation.option`.

The server checks what the data says, not only its shape:

- No empty or filler text: `TBD`, `n/a`, `none`, `pendiente`, a single dash.
- `done_when` states something a person can see or check, for example "the list shows the three filters". "It works", "done" or the step's title again are refused.
- Every planning step has a `try_it`: what someone can try once that step lands.
- `out_of_scope` names at least one thing the idea will not do.

A refusal stores nothing. `STAGE_REQUIREMENTS_MISSING` lists every field to fix in `missing` (for example `steps[1].try_it`), says how in `fix`, and its `hint` says to send the whole data again. `INVALID_FILTER` names one malformed field: a wrong type, too many items, an index outside its options, a field the stage does not have.

A new delivery replaces the stage doc; no `version` is needed. `attach_doc` with the stage headings still works and still lets the idea move, but that doc carries no data: the screen then reads its Markdown, as it did before, and shows no decisions.

### Decisions

A product owner's open questions about an idea go in the `idea` delivery as `decisions`, not as `ask`. Each one is a closed question: `question`, `options` (2 to 4 short labels), `recommended` (the index of the option the PO would take) and `why`.

- Nothing waits. The recommended option is assumed and the idea keeps moving. The Idea doc lists each decision under `## Assumptions`.
- The owner sees each decision on the idea's screen with the recommended option already chosen. He can confirm it or pick another one, with a few words of his own.
- Confirming records the decision and moves nothing.
- Picking another option records it, rewrites that line of the doc as decided, leaves a note in his words, sends the idea back to the idea stage and wakes the PO. The PO redoes the stage with `deliver_stage`; the later stages are redone when the idea reaches them again.
- What the owner decided stays decided in later deliveries, as long as the question and that option are still there.

Use `ask` on an idea only when no option can be recommended.
