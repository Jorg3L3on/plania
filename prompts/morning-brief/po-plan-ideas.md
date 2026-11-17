## Plan these ideas (from the Morning brief, {{BRIEF_DATE}})

The owner picked these ideas in the Morning brief and pressed "Send to Plania". That choice is the owner's yes to
PLAN them now. It is not a yes to build them. Request: {{REQUEST_ID}}.

{{IDEAS}}

For each idea, in this project ({{PROJECT_SLUG}}):
1. list_tasks with search to look for duplicates. If an Open idea or initiative already covers it, create nothing
   and report "duplicate" with its key.
2. create_task kind "idea" with the title, then attach_doc titled "Idea" on it, with these headings exactly:
   ## Problem / ## Who it is for / ## Why now / ## Constraints
3. create_task kind "initiative" (it starts in Planning) with base_branch "sandbox" and the plan in scope, then
   attach_doc titled "Plan" on the initiative with these headings exactly:
   ## Description / ## Steps / ## Sketch link / ## Affected code and impacts / ## Risks / ## Cost / ## Split assessment / ## Done when
   - Affected code and impacts: real paths you read in the repo (read-only), with the repo HEAD short sha and today's date.
   - Cost: "$0", or the paid item marked "needs the owner's yes".
   - Sketch link: "none yet" unless one exists.
   - Split assessment: one initiative or several, and why.
4. One ticket per phase (parent_key = the initiative key), each with scope and executable checks (the Done when
   list), status "Backlog", NEVER "Ready" (Ready work can start on its own), priority P2, work_type code unless it
   is ops or research.
5. Put the initiative key in the Idea doc's Constraints section.
6. Do not use propose for these ideas, and do not ask the owner to pick between them: they already picked.
   If something truly blocks planning (for example a paid service is the only way), plan it anyway, mark it in
   Cost and Risks, and say so in your thread line.
7. Pass request_id "brief-plan:{{REQUEST_ID}}:<idea code>:<step>" on every write, so a retry repeats nothing.
   Steps: idea, idea-doc, initiative, plan-doc, ticket-1, ticket-2, ..., constraints (the Idea doc update), and
   line (your closing thread line, with the first code). For example "brief-plan:{{REQUEST_ID}}:{{FIRST_CODE}}:idea".
8. End with ONE thread line in this format, one entry per idea:
   "Brief plan {{REQUEST_ID}}: W1 -> ABC-I18 (4 tickets, Backlog); W2 -> duplicate of ABC-IDEA7."
For a cross-app idea (code X…): plan it in this project ({{PROJECT_SLUG}}). In the Plan doc, name each
affected project under "Affected code and impacts" and "Split assessment", but create the tickets here only.
