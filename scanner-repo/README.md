# plania-scan

Private scanner. It posts a commit status named `plania-scan` on open pull requests in `Jorg3L3on/filmia`, `micasa`, `zigzag`, and `workia`. Those four repositories get no workflow and no other files. This directory is the template. Publish it as the root of a new private repository named `plania-scan`. Do not make that repository public.

The status description is a count (`2 findings, 1 rule`) or a fixed phrase (`scan started`, `scan did not finish`, `0 findings, 0 rules`). It does not include a matched value, a path, or a rule id. Custom values are matched from `PLANIA_SCAN_HASHES_JSON` only. Plaintext patterns are not stored in any repository.

Each step below needs your yes before the next one. Nothing here has been created on GitHub.

## Minutes

GitHub Free includes **$12 USD** of Actions compute per month, not a fixed minute counter. On the standard Linux 2-core runner (`ubuntu-latest`, SKU `actions_linux`) the rate is **$0.006 per minute**, so $12 covers **2,000 minutes**. This template stays on `ubuntu-latest`. macOS and Windows cost more per minute and would blow the budget. Standard runners in a public repository are free, and that is not the plan here: the scanner repository is private, so these minutes count.

Sources:

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) (included $12, public repositories free, usage blocked when there is no payment method)
- [Product usage included with each plan](https://docs.github.com/en/billing/reference/product-usage-included)
- [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) ("GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute." Linux 2-core is $0.006.)

One job is billed on its own, rounded up. A 10-second run costs 1 minute. The workflow is one job.

At most **300 minutes / month**, against 2,000:

| Day | Arithmetic | Minutes / month |
| --- | --- | --- |
| Idle day (nothing unmarked) | 30 runs × 1 billed minute | 30 |
| Worst case (every day hits the cap) | 30 runs × 10 minutes (`timeout-minutes: 10`) | 300 |

There is one job per day, so the guard, checkout and Node setup are paid once and the day's scans run inside that job. The job picks up new heads for 7 minutes and is killed at 10, so no day costs more than 10 minutes. Manual dispatches add at least 1 minute each. Headroom is at least 1,700 minutes.

The schedule is `0 9 * * *` (09:00 UTC, 3:00 AM Mexico City, which has no daylight saving) plus `workflow_dispatch`. GitHub can delay scheduled runs at the top of the hour, so the run may start a few minutes after 3:00. Scheduled workflows run only from the default branch. The 60-day auto-disable sentence in the docs applies to a public repository; this one is private.

**Latency.** A head pushed during the day gets its `plania-scan` status at the next 3:00 AM run, up to about 24 hours later. Heads not picked up in the 7-minute window wait for the next day. When a merge cannot wait, dispatch the workflow by hand (Actions, plania-scan, Run workflow; at least 1 billed minute). `pnpm merge-gate` in plania scans locally at merge time and does not depend on this status.

- [Events that trigger workflows: schedule](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)

`concurrency` group `plania-scan` with `cancel-in-progress: false` so a new run waits instead of killing a scan (a kill can leave `pending` on the commit). A queued run still executes later and bills at least a minute. `timeout-minutes: 10` caps a stuck job. Inside the job, new heads stop being picked up after 7 minutes and stay unmarked for the next run.

The usage workflow is `workflow_dispatch` only. It costs about 1 minute when you run it, and it is not part of the 300.

## What a run does

1. The first step uses `curl` to download `src/select.mjs` and `src/guard.mjs`, then `gh api` to list open pull requests. It does not checkout, it does not run `actions/setup-node`, and it does not download gitleaks. Heads that already have a `plania-scan` status are skipped. A `pending` status older than 15 minutes is scanned again, so a killed job does not stick. If nothing is unmarked, the job exits 0. That is the 1-minute idle run.
2. Only then: checkout this repository, restore the gitleaks cache, set up Node 22, and scan each `base...head` with a partial fetch (`--filter=blob:none`, depth 80, one deepen if the merge base is missing).
3. Gitleaks is the CLI **8.30.1**, checked against the SHA-256 in `src/scan/gitleaks.ts` (linux-x64 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`). The binary is cached at `~/.cache/plania/gitleaks`. This is not `gitleaks-action`.
4. For each head the job posts `pending`, then `success` or `failure`. A scan that does not finish is `failure` with description `scan did not finish`, so it does not look clean. Findings fail the status and do not fail the Actions run, so the next run does not rescan that commit. An operational error fails the Actions run.

The hash secret is removed from the environment before git and gitleaks run, and written to a `0600` temp file that is deleted at the end. Actions still masks the secret if it ever reaches a log. Do not print it.

An empty `PLANIA_SCAN_HASHES_JSON` skips name matching and still runs the structural rules and gitleaks. Invalid JSON fails the status (`scan did not finish`).

## 1. Keep the bill at zero

Yes/no. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) says that with no payment method on file, usage stops once the included compute is gone. If a payment method is on file, set an Actions product budget to $0 with "Stop usage when budget limit is reached", or confirm you are willing for overage to be blocked some other way. See [Setting up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets). Do not raise a spending limit to keep this scanner running. When the minutes are gone or Actions is down, run the one command under "Unblock a merge" that sets that ruleset to `enforcement: disabled`. Do not add an admin bypass for this. Bots merge as the repository owner, and the owner is an admin, so an admin bypass lets them through.

## 2. Create the private repository

Yes/no. On GitHub, create a repository named `plania-scan`. Visibility: **Private**. Do not add a README or a .gitignore; this template already has both. Do not add a license. Do not change the repository to public.

The account is the one that owns the four application repositories (`Jorg3L3on`).

## 3. Push this template to the root

Yes/no. The files in this directory, including `.github`, become the root of `plania-scan`. From a plania checkout:

```bash
cp -a scanner-repo /tmp/plania-scan
cd /tmp/plania-scan
git init
git add .
git commit -m "Initial private scanner"
git branch -M main
git remote add origin git@github.com:Jorg3L3on/plania-scan.git
git push -u origin main
```

Enable Actions for the private repository (Settings, Actions, General). Allow GitHub-created actions so `actions/checkout`, `actions/cache`, and `actions/setup-node` can run. Scheduled workflows run only from the default branch, so this push has to land on `main`.

## 4. Create the token

Yes/no. Create a fine-grained personal access token. Resource owner: `Jorg3L3on`. Repository access: **only** `filmia`, `micasa`, `zigzag`, and `workia`. Not all repositories, and not `plania-scan` (the workflow checks itself out with the built-in `GITHUB_TOKEN`).

Repository permissions, and nothing else:

| Permission | Access |
| --- | --- |
| Commit statuses | Read and write |
| Contents | Read-only |
| Pull requests | Read-only |

No account permissions. No Administration, Actions, Secrets, or Workflows. That token cannot edit rulesets. Set an expiration you will rotate. Store the value only as the Actions secret in the next step.

Docs: [fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) and [permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens). Commit statuses are posted with [the commit status API](https://docs.github.com/en/rest/commits/statuses). The context is `plania-scan`. There is no `integration_id`, because this is a token and not a GitHub App. Without `integration_id`, the required check accepts any `plania-scan` status from anyone with commit statuses write on that repository: the owner, a collaborator, or an app whose token has that permission. GitHub does not check who posted it. Pinning `integration_id` is only available when a GitHub App posts the status, which this setup does not use.

## 5. Add the two secrets

Yes/no. In `Jorg3L3on/plania-scan`, Settings, Secrets and variables, Actions:

- `PLANIA_SCAN_TOKEN`: the token from step 4.
- `PLANIA_SCAN_HASHES_JSON`: the hash file below.

Build the hash file on your machine from a plaintext file that never goes into git (one value per line, `#` comments allowed):

```bash
umask 077
mkdir -p ~/.config/plania
pnpm scan:hashes --in ~/private/names.txt --out ~/.config/plania/scan-hashes.json --salt "$(openssl rand -hex 16)"
gh secret set PLANIA_SCAN_HASHES_JSON --repo Jorg3L3on/plania-scan < ~/.config/plania/scan-hashes.json
```

`pnpm scan:hashes` runs from a plania checkout. After this template is published, the same builder is `node --experimental-strip-types src/build-hashes.ts` in the scanner repository. The command prints how many hashes it wrote. It does not print the salt, the values, or the digests. The file mode is `0600`. Shape:

```json
{ "v": 1, "algorithm": "sha256", "salt": "...", "hashes": ["<64 hex chars>"] }
```

`fixtures/hashes.example.json` is the only sample. Its salt is `example-salt`. Do not put a real value in it.

## 6. Dispatch one run

Yes/no. Actions, `plania-scan`, Run workflow. With no unmarked pull requests the run is green in well under a minute and later steps are skipped. With unmarked pull requests it scans and posts statuses. Do not apply the ruleset until this run has succeeded at least once, so a required check does not block merges before the scanner has posted anything.

## 7. Rulesets

Yes/no, and only after step 6. The four application repositories are **public**, so repository rulesets are available on GitHub Free. The private scanner repository does not get a ruleset.

Availability, from the note on [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud. Push rulesets are a different feature and are not used here.

Prepared files, shared by all four repositories (`~DEFAULT_BRANCH` plus `refs/heads/sandbox`):

| File | Enforcement | Bypass |
| --- | --- | --- |
| `rulesets/plania-scan.disabled.json` | `disabled` | none |
| `rulesets/plania-scan.active.json` | `active` | none |
| `rulesets/plania-scan.evaluate.json` | `evaluate` | none |
| `rulesets/plania-scan.active.admin-bypass.json` | `active` | admin, do not apply |

The three default files use `"bypass_actors": []`. They require the status check `plania-scan`, with `strict_required_status_checks_policy` false (loose). Loose avoids a new scan every time the base branch moves. See [Required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging). No `integration_id`. Without `integration_id`, the check accepts any `plania-scan` status from anyone with commit statuses write.

`rulesets/plania-scan.active.admin-bypass.json` is not a default. It adds one bypass actor: repository role admin, `actor_id` 5, `actor_type` `RepositoryRole`, `bypass_mode` `always`. GitHub's REST reference does not publish that role id. The Terraform provider documents admin as 5, maintain as 2, and write as 4: [github_repository_ruleset](https://registry.terraform.io/providers/integrations/github/latest/docs/resources/repository_ruleset). Do not apply this file. Bots merge as the repository owner, and the owner is an admin, so this bypass lets those bots through. Write and maintain are not a safer substitute.

### On Free: disabled, then active

The realistic path on this Free account is `disabled`, then `active`. [Create a repository ruleset](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset) says `evaluate` "is only available with GitHub Enterprise". [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) lists **Active** and **Disabled** as the enforcement statuses on GitHub.com. The evaluate file is kept for an Enterprise account. Do not start there.

Apply `rulesets/plania-scan.disabled.json` first. Disabled does not block merges. Statuses still show on pull requests. Watch the usage numbers. When a month of runs is inside the budget, PUT `rulesets/plania-scan.active.json`.

These commands use your own `gh` login, not `PLANIA_SCAN_TOKEN`.

### Local check (no GitHub calls)

```bash
node rulesets/check.mjs
```

From a plania checkout: `node scanner-repo/rulesets/check.mjs`. This checks the name, an empty `bypass_actors` list on the three defaults, the admin-only alternative file, the two branch targets, the context `plania-scan`, and the absence of `integration_id`.

### Read-only check

```bash
gh api repos/Jorg3L3on/filmia/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/Jorg3L3on/micasa/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/Jorg3L3on/zigzag/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/Jorg3L3on/workia/rulesets --jq '.[] | {id,name,enforcement}'
```

### Apply disabled

```bash
for repo in filmia micasa zigzag workia; do
  gh api --method POST "repos/Jorg3L3on/${repo}/rulesets" \
    --input rulesets/plania-scan.disabled.json
done
```

Save each numeric `id` from the response. Confirm the payload before you do anything else:

```bash
gh api repos/Jorg3L3on/filmia/rulesets/RULESET_ID --jq '{enforcement,bypass:.bypass_actors,context:.rules[0].parameters.required_status_checks}'
```

You want `enforcement` `disabled`, `bypass` `[]`, context `plania-scan`, and no `integration_id`. `current_user_can_bypass` should not be `always`.

`GET /repos/{owner}/{repo}/rules/branches/{branch}` does **not** return rules from an `evaluate` or `disabled` ruleset. Use the ruleset id. After the ruleset is `active`, that branch endpoint should list `plania-scan`. See the same REST page.

### Switch to active

When usage is confirmed under the budget:

```bash
gh api --method PUT "repos/Jorg3L3on/filmia/rulesets/RULESET_ID" \
  --input rulesets/plania-scan.active.json
```

Repeat for `micasa`, `zigzag`, and `workia` with each repository's id. PUT replaces the ruleset, so the input is the full active file, not a tiny patch.

Then:

```bash
gh api repos/Jorg3L3on/filmia/rules/branches/main
```

Use the default branch name if it is not `main`. The payload should include the `plania-scan` status check. `sandbox` is targeted by the same ruleset even when you query `main`.

### Unblock a merge

When the quota is used up or Actions is down, this one command sets that ruleset to `enforcement: disabled`. Merges are not blocked. Statuses already posted stay. Run it with your own `gh` login, not `PLANIA_SCAN_TOKEN`. Replace `REPO` and `RULESET_ID`.

```bash
gh api --method PUT "repos/Jorg3L3on/REPO/rulesets/RULESET_ID" --input rulesets/plania-scan.disabled.json
```

PUT replaces the ruleset, so the input is the full disabled file (empty `bypass_actors`, same status check). When Actions is back and the minutes allow it, PUT `rulesets/plania-scan.active.json` with the same id. Do not use `rulesets/plania-scan.active.admin-bypass.json` for this.

### Roll back

```bash
gh api --method DELETE repos/Jorg3L3on/filmia/rulesets/RULESET_ID
```

Repeat per repository. Deleting the ruleset removes the requirement. Statuses already posted stay on their commits and stop blocking.

Do not run these API commands until you mean to change the four repositories.

## Usage check

Authoritative number, run locally with your own `gh` login (the scan token cannot read billing). The old `/users/{username}/settings/billing/actions` endpoint was shut down; use the consolidated usage report.

- [Billing usage](https://docs.github.com/en/rest/billing/usage) `GET /users/{username}/settings/billing/usage`
- [Product-specific billing APIs are closing down](https://github.blog/changelog/2025-09-26-product-specific-billing-apis-are-closing-down/)

```bash
gh api "/users/Jorg3L3on/settings/billing/usage" | node src/usage.mjs
```

`actionMinutes` sums `quantity` where the product name contains `action` and `unitType` contains `minute`. Compare it with 300 and with 2,000. `actionNet` is the net amount on those rows after GitHub's own discounts; included usage often shows a net of 0. If `actionItems` is 0 and the raw `usageItems` array is not empty, read the `product` strings before trusting the summary.

A cheaper in-repo stand-in, about once a week: Actions, workflow `usage`, Run workflow. It lists this repository's workflow runs and rounds each completed run up to a minute. That is wall-clock, not the bill. It does not use `PLANIA_SCAN_TOKEN`. It has no schedule.

## Tests

`pnpm test:scanner` from plania, or `npm test` from this directory. The manual pull-request plan is [TEST-PLAN.md](TEST-PLAN.md).

## Keeping the copy aligned

`src/scan/` is vendored from `src/lib/scan` in plania. A test fails if the copy drifts, aside from `.ts` import suffixes and the gitleaks config path. When the scan rules change, update the vendor and publish the scanner repository again. Do not put plaintext patterns in the vendor.
