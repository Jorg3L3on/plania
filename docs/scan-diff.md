# Pre-merge scan

`pnpm scan:diff` checks a branch, or a checkout, for secrets and for real personal data. It prints a rule id, a file, and a line. It does not print the matched text.

Gitleaks is the [official CLI](https://github.com/gitleaks/gitleaks), MIT license, pinned at **8.30.1** (tag `v8.30.1`, copyright 2019 Zachary Rice). The binary is not in this repo. On a run, `scan:diff` uses `gitleaks` on `PATH` when that copy reports 8.30.1. Otherwise it downloads the release archive for the current OS, checks the SHA-256 pinned in `src/lib/scan/gitleaks.ts`, and caches the binary under `~/.cache/plania/gitleaks/8.30.1/`. If the download fails, any `gitleaks` already on `PATH` is used. `--gitleaks-bin` skips the lookup. This is not `gitleaks-action`.

## Run

```bash
pnpm scan:diff <repo> [base]
pnpm scan:diff --json --base main --head HEAD <repo>
pnpm scan:diff --path <checkout-or-file>
```

`base` defaults to `main`, `head` to `HEAD`. Added lines come from `git diff <base>...<head>` (three dots: changes on the head since the merge base). Gitleaks scans commits with `git log -p <base>..<head>` (two dots: commits reachable from the head and not from the base). `--path` reads the tree as it is and runs `gitleaks dir`. Nothing is written into the scanned repo.

Exit `0` when the scan finishes with no findings. Exit `1` when there is at least one finding (including emails and RFC-shaped strings). Exit `2` when the scan does not finish: usage, a bad ref, git, a hash-list problem, or gitleaks. A bad base is never a pass.

`--no-gitleaks` runs only the TypeScript rules. A merge gate should not use it. Treat a run as clean only when the process exits `0`, `ok` is true, `gitleaks.ran` is true, and `gitleaks.error` is null.

## Output

Human stdout, one finding per line, then a count:

```text
src/note.ts:4 plania-email
scan: 1 finding
```

`--json` prints one object on stdout. Logs stay on stderr and do not include matched text. Shape:

```json
{
  "version": 1,
  "ok": false,
  "mode": "diff",
  "repo": "/absolute/repo",
  "base": "main",
  "head": "HEAD",
  "diff": "main...HEAD",
  "gitleaksRange": "main..HEAD",
  "findings": [{ "rule": "plania-email", "file": "src/note.ts", "line": 4, "engine": "plania" }],
  "gitleaks": { "ran": true, "version": "8.30.1", "pinned": "8.30.1", "skipped": false, "error": null },
  "error": null
}
```

`engine` is `plania` or `gitleaks`. `line` is `0` for a file-level finding (`env-file`). `ok` is true only when `error` is null and `findings` is empty. In `--path` mode, `base`, `head`, `diff`, and `gitleaksRange` are null.

Flags: `--json`, `--path <dir>`, `--base <ref>`, `--head <ref>`, `--allowlist <file>`, `--hashes <file>`, `--gitleaks-bin <bin>`, `--no-gitleaks`. A positional `[base]` still works.

## Rules

TypeScript, on every added line (and on every text line in `--path` mode): the existing token, private-key, credential-url, CLABE, payment-card, CURP, RFC, and email checks; EVM `0x` + 40 hex (not the all-zero address); Bitcoin bech32 (`bc1` / `tb1`) and base58 (version byte and checksum); Solana base58 that decodes to 32 bytes; and a currency-shaped number on the same line as `saldo`, `monto`, `importe`, `balance`, `amount`, `MXN`, `USD`, `EUR`, or the same family (`CAD`, `GBP`, `USDT`, `USDC`, `$`, `€`, `£`). `balance` and `amount` count only when the number has cents, a thousands separator, or a currency symbol or code. Emails at `example.com`, `*.test`, `*.invalid`, `*.localhost`, and `users.noreply.github.com` are skipped. A committed `.env` file that is not an example or template is `env-file`. The TypeScript pass skips binary files, files over 1 MB, and the directories `node_modules`, `.git`, and `dist`. Gitleaks is given those directories as path allowlists too.

`config/plania-gitleaks.toml` turns on the default gitleaks secret rules and adds regexes for email, EVM, Bitcoin bech32, and balance-like amounts. Base58 and Solana stay in TypeScript because they need a checksum or a decoded length. The same rule id on the same file and line is reported once.

## Allowlist

`~/.config/plania/scan-allowlist`, or `PLANIA_SCAN_ALLOWLIST`, or `--allowlist`. One entry per line. `#` starts a comment.

```text
fixture@example.com
/^4111/
path:src/fixtures/
path:.env
path:/^vendor\//
```

A literal or `/regex/` matches the value. `path:` matches that path, anything under it, or a suffix, so `path:.env` matches `apps/web/.env`. The same entries are passed through to gitleaks. Regexes there must be RE2 (no lookaheads).

## Local hash file

Names and other exact strings are matched as `sha256(salt + normalized)`, hex, with no separator. Normalized means trim, lowercase, strip accents, and collapse whitespace. The scanner hashes each whitespace token on an added line and each 2- and 3-word sequence. A longer name has to be listed the way it should match within that window.

The list stays off the repo. Point `PLANIA_SCAN_HASHES` at the file, pass `--hashes`, or set `PLANIA_SCAN_HASHES_JSON` to the same JSON. A missing file is an error, not a pass. Build it from a local plaintext file (one value per line, `#` comments allowed):

```bash
umask 077
mkdir -p ~/.config/plania
pnpm scan:hashes --in ~/private/names.txt --out ~/.config/plania/scan-hashes.json --salt "$(openssl rand -hex 16)"
```

The salt can also come from `PLANIA_SCAN_HASH_SALT`. The command prints how many hashes it wrote. It does not print the salt, the names, or the digests. The file mode is `0600`:

```json
{ "v": 1, "algorithm": "sha256", "salt": "...", "hashes": ["<64 hex chars>"] }
```

`scripts/scan/hashes.example.json` is the sample hash file. The private scanner template copies it to `scanner-repo/fixtures/hashes.example.json`. Its salt is `example-salt` and its digests are the three synthetic lines `persona ficticia`, `nombre ejemplo`, and `cuenta-demo-000`. Do not put a real name, email, id, or salt in that file. `scan-hashes.json`, `scan-hashes.local.json`, and `.scan-hashes.json` are gitignored.

## External status

`scanner-repo/` is the template for a private repository that posts the `plania-scan` commit status onto open pull requests in filmia, micasa, zigzag, and workia. Those repositories get no workflow and no other files. Setup, the Free-plan minute budget, and the prepared rulesets are in [scanner-repo/README.md](../scanner-repo/README.md). The template vendors this scan library. Custom values still come only from `PLANIA_SCAN_HASHES_JSON`.
