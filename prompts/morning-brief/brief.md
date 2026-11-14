Task: build today's brief items.

Inputs
1. Read {{FACTS_PATH}} first. Per project it has: tickets In progress and In review, tasks and initiatives created
   in the window, initiatives (state, done/total, next action), questions waiting on the owner (get_inbox), audit
   findings, pull requests opened/merged/closed in the window and every open PR with its age and base, the release
   compare (from -> into: ahead/behind/diverged), env records (commit, deployed_at, migrations), the previous brief's
   items (id, title, ref), and source_errors.
2. Use Plania tools only to fill a gap (get_task for details on a key, get_resume for a project's state).
3. Use read-only `git -C <repo> log` only when facts.json says a source is missing.

What to look for (cross-check, don't just copy)
- Blockers: a release blocker, a failing check on work going to prod, a broken prod.
- Needs the owner: questions waiting on them; PRs waiting for their review or merge; a release step that is ready or
  cannot fast-forward (diverged: give ahead/behind counts); planned initiatives with Ready tickets waiting for their
  start; decisions only they can take.
- Inconsistencies: PR merged but ticket still In review, or Merged and not Done; initiative with every ticket Done but
  still Active; an env/prod record older than the last merge into the release target (say what Plania has and what
  moved since); branches merged but not deleted; PRs open more than 14 days; PRs with no Plania key; duplicate PRs
  for the same fix.
- Up next: the next claimable ticket per project, Ready work; low-priority open PRs get status open_pr.

Rules for items
- status: blocker | needs_you | next | open_pr. Never an item for something Done, merged and closed, or settled.
- app: a project id from the table, or "cross" for cross-project or Plania-itself items.
- ref: the keys and PR numbers involved, joined with " · ", e.g. "ABC-I12-3 · #45". Omit when there are none.
- title: at most 80 characters, verb first, what to do. When it is the same thing as a previous item, reuse the
  previous title and ref exactly, so the owner's check keeps hiding it.
- detail: 1 to 3 short sentences: what happened (with time), why it matters, what is next.
- url: only a real URL from facts or tools (PR, compare). action: Review | Open PR | Open compare | Decide | Open.
- At most {{MAX_ITEMS_PER_APP}} items per app (blockers and needs_you first). Merge related things into one item.
- For each entry in facts.source_errors, add ONE "cross" needs_you item that says what is missing and the fix.
- Inside each status, most urgent first.

Return only JSON that matches the schema. No prose.
