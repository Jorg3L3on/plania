# Test plan

Two pull requests, both synthetic. Close them without merging. Do not put these files in filmia, micasa, zigzag, or workia until you are ready to throw the branch away.

Run the unit tests first, from a plania checkout:

```bash
pnpm test:scanner
```

From the published scanner repository the same command is `npm test`.

## Local fixture check

This uses the TypeScript rules only. It does not download gitleaks and it does not post a status.

```bash
pnpm scan:diff --no-gitleaks --path scanner-repo/fixtures/clean
pnpm scan:diff --no-gitleaks --path scanner-repo/fixtures/fail
```

The clean path exits 0. The failing path exits 1 and prints `plania-email` with a file and a line. It does not print the address.

`fixtures/clean/note.md` contains `fixture@example.com`, which the scanner ignores. `fixtures/fail/note.md` contains `fixture.scanner@mail-ficticio.mx`, a synthetic address on a domain the rule does not ignore. Neither file contains a wallet, a secret, or an amount.

## Clean pull request

1. In one application repository, branch from the default branch. Name the branch `scan-fixture-clean`.
2. Copy `fixtures/clean/note.md` in as `scan-fixture-clean.md`.
3. Open a pull request into the default branch. Do not merge it.
4. Dispatch the `plania-scan` workflow, or wait for the `17 * * * *` run.
5. The head commit gets `plania-scan` pending, then success. The description is `0 findings, 0 rules`.

## Failing pull request

1. Branch `scan-fixture-fail` in the same or another application repository.
2. Copy `fixtures/fail/note.md` in as `scan-fixture-fail.md`.
3. Open a pull request. Do not merge it.
4. After the scanner runs, `plania-scan` is failure. The description is a count, such as `1 finding, 1 rule`. It has no address and no file path.
5. While the ruleset is `disabled`, the pull request can still merge. After you switch it to `active`, this pull request cannot merge. To unblock a merge when Actions is out of minutes or down, run the one command in the README that sets `enforcement` to `disabled`. Do not apply `plania-scan.active.admin-bypass.json` for that.

## After both

Close the pull requests and delete the branches. The status stays on those commits, which is fine: the commits are not on the default branch.

A wallet check is covered by `scanner-repo/test/fixtures.test.ts`. It builds an address with `syntheticEvm("scanner-fixture")` in a temp file, expects rule `plania-evm-address`, and checks that the report JSON does not contain the address. Do not commit that address.
