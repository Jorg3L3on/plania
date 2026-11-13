# Spike: plania's write path on devva

A prototype of the commit-log design from the "Plania on Devva" audit. Plania owns the
transaction; devva stores it in one atomic statement. Nothing here is wired into plania.

## What it is

| File | What |
|---|---|
| `src/store.ts` | The store: lock, build a write set, commit one record to `<prefix>_log` (unique `cid` anchor), apply to the entity and event lobes, recover on boot |
| `src/domain.ts` | Three plania-shaped tools (`create_task`, `claim`, `finish`) and a read-modify-write `increment` |
| `src/run.ts` | The checks. Prints `PASS` / `FAIL` with the numbers it saw |
| `src/worker.ts` | A second writer process, used by the race, crash and kill checks |
| `src/probe.ts` | Confirms the statement shapes the store relies on |
| `src/probe-update-durability.ts` | Reproduces the engine defect below |
| `compose.yml` | Its own engine: project `plania-devva-spike`, image `devva-engine:dev01`, port 2511 |

`vendor/xyzdb` is the client copied from `devva-eval/app/vendor` (not committed). `.token` is generated locally.

## Run

It needs the local image `devva-engine:dev01` and a built devva TypeScript client. The first command
copies the client and generates the engine token; pass the client's path if it is not in
`../../xyz/devva-eval/app/vendor/xyzdb`.

```bash
node spike/devva-commit-log/setup.mjs
```

```bash
docker compose -f spike/devva-commit-log/compose.yml up -d
```

```bash
pnpm exec tsx spike/devva-commit-log/src/run.ts
```

```bash
pnpm exec tsx spike/devva-commit-log/src/probe-update-durability.ts upsert restart
```

The kill and restart checks stop and start the spike's own container only.

## Result, 2026-11-13, engine `devva-engine:dev01` (`cb73b55`), `--durability durable`

All 16 checks pass (`out/run.log`):

- One tool flow is three commits; the projection equals the log.
- A retried request id replays the first reply and writes nothing. A reused id on another tool is refused.
- A stale version is refused with nothing committed. A handler that throws after its first put leaves no trace.
- The process dying after the commit, or after the first projection statement, is repaired on the next boot.
- Two writer processes doing 100 read-modify-write increments each end at 200, with 96 to 100 commit conflicts per writer, each resolved by catching up and retrying.
- `kill -9` on the engine while a writer streams: every acknowledged commit is in the log after restart, and writes resume.
- One write (commit, two projection statements, watermark) has a median of 36 to 45 ms; the slowest was 966 ms.

## Engine defect found

**Acknowledged updates of an existing record are lost across an engine restart.** Inserts survive.

`probe-update-durability.ts` updates one record in a loop, restarts the engine and reads it back.
Twelve of thirteen runs lost the most recent 182 to 556 acknowledged updates:

- with `PUT … ON CONFLICT UPDATE` and with `SET`;
- after `kill -9` and after a clean `docker stop`;
- in a plain lobe and in a lobe with gravity;
- on `devva-engine:dev` (`55c9c91`) and on `dev01` (`cb73b55`).

A read just before the stop returns the acknowledged value. The evaluation's durability scenario
(s16) measures inserts, which is why it did not show this.

The store survives it because the log is insert-only. On boot it treats the watermark as a lower
bound, re-applies from it, and rewrites any entity record that differs from what the log folds to.

## What this does not show

- Projection order with two concurrent appliers. The run saw no stale record, but nothing prevents an
  older image landing last. Keep one applying process, or rebuild on boot as the store does.
- Scale. The log is replayed in full at boot; the largest run had 840 commits.
- Plania itself. No plania handler runs on this store yet.
