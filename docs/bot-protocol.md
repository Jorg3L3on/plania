# Bot loop

Plania wakes an agent on its heartbeat, or when someone calls `wake_agent`. The agent then:

1. `check_in` with the roster slug.
2. Claim Ready work (`claim` or `start`) that it owns or that matches its role.
3. Do the work.
4. `report_tokens` for that run.
5. `check_in` again when it is idle.

`adapter_config` stores environment variable names only. Do not put secrets, URLs, or token values in it.

A second `wake_agent` inside `heartbeat_minutes` does nothing. `dry_run` does not open a socket or a process and does not record a run.
