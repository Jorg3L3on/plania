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

A product owner offers options or answers one of Jorge's orders with `propose`, never with prose only. Jorge (or anyone at the Mac) decides it in Te toca.

- `kind: "choice"`: a title and 2 to 6 options. Each option has a `label`, an `effect` (what changes) and a `cost` (`tickets`, `days`, `tokens`, `delays`). One option may be `recommended`, with `recommended_reason`. `combinable` lists the options that may be chosen together, for example `[[1, 2]]`; leave it out when they exclude each other, and Te toca will not offer "1 + 2". The proposal stays in Te toca until it is answered, even if the PO writes again.
- `kind: "plan"`: the answer to an order (`order` is the order ticket's key). It says what the PO `understood` in one plain line, the `steps` (each with `done_when` and `work_type`) and the `cost`. When the project approves plans (on by default for a new project), the PO creates no ticket for the order: Plania creates one Ready ticket per step when someone presses "Sí, empiecen". "Cambiar algo" sends the order back to the box and "Cancelar" closes it. Without approval the tickets are created at once and the plan shows as information.

Titles, labels and `understood` use plain words: no ticket keys, branch names or the word sandbox. Anyone at the Mac reads them.

## App-repo merges (protocol 2.20)

Before merging a pull request in filmia, micasa, zigzag, or workia, run this from the plania repo:

```bash
pnpm merge-gate <owner/repo> <pr-number> --merge squash --record <TICKET>
```

`--record` writes the scan result through Plania. The cite is the redacted report, `command` is `merge-gate`, and `commit` is the scanned head (40 hex). Do not call `add_result` yourself for this pass. Exit 0 only when `ok` is true, `gitleaks.ran` is true, and `gitleaks.error` is null.

A finding blocks the merge unless that path or string is on the allowlist. Only Jorge appends an allowlist entry. `SCAN_REQUIRED` blocks Merged unless that pass's commit is exactly the PR head.

A merge that does not go through merge-gate is only detected: the ticket stays In review. Stopping that merge is the PLA-I38-3 ruleset, which is not here yet. When that ruleset is live, the pass should also accept or require a GitHub check named `plania-scan` with success on the head. A bot cannot fabricate that status.

Do not add files to the app repo for this. The write token may be a static token with actor `merge-gate`, or set `PLANIA_MERGE_GATE_AGENT` to the agent named on a bound token. `PLANIA_MCP_URL` defaults to `http://127.0.0.1:3737/mcp`.
