Task: propose bold ideas for each project, grounded in where it stands today.

For each project in the table with ideas on:
1. Read its Plania context: get_project (body, rules), get_resume (initiatives, next steps), list_tasks with
   kind idea and recent initiatives (so you don't repeat them), get_memory view summary (decisions to respect).
2. Read its repo READ-ONLY at the absolute path given, when present: README, package.json or equivalent, the main
   app folders, and `git -C <path> log --since="14 days ago" --oneline`. At most about 15 files per project. Never .env.
3. When the project has a persona, think as that persona:
{{PERSONAS}}
4. Propose {{IDEAS_PER_PROJECT}} ideas. Mix angles: a feature users would love, quality or security, clients and
   growth, money (revenue or cost), team speed. At least one idea per project must be bold, not a chore.

Rules for each idea
- title: at most 60 characters, a noun phrase ("Renewal board").
- why: 1 or 2 sentences: what it does and why now, tied to a concrete fact you saw (a recent merge, a field that
  already exists, a pain in an open question). No marketing words.
- flags (optional, any of): cost (anything paid), outside_service (a new account or third party), legal (needs a
  lawyer or legal text), repo_change (adds tooling or dependencies beyond normal app code), big (more than about two
  weeks), overlap:<KEY> (an existing Plania idea or initiative covers part of it).
- Never propose: agent or harness files (AGENTS.md, CLAUDE.md, hooks, CI) in product repos; anything that needs real
  customer data in Plania; an idea already Open in Plania (skip it).
- Add up to 2 ideas with app "cross" that help several projects at once.
- Never return an empty list. When a project has too little context, give one idea about getting that context.

Return only JSON that matches the schema. No prose.
