---
name: cited-research
description: Produces research in which every claim links to the source it came from, primary sources come first, and what could not be found is stated plainly. Use when Research works an idea at the research stage or a research ticket, compares options, tools, prices, rules or competitors, or answers any question whose answer lives outside the repo.
---

# Cited research

The owner decides on what you write, and he cannot check it himself. So every claim he could doubt
carries the link that proves it, and every gap is shown as a gap.

## Plania tools

- `get_task` and `get_doc`: the idea or ticket, and the Idea doc that says what must be answered.
- `get_memory`: decisions and docs that already answer part of it.
- `attach_doc`: the result. For an idea: `title: "Research"` with the headings `What we learned`,
  `Options`, `Recommendation` (English, exactly; the stage move checks them).
- `set_task`: `stage: "design"` once the doc is attached (`STAGE_REQUIREMENTS_MISSING` names what is
  missing). An idea is not a ticket: never `start` or `claim` it.
- For a research ticket: `start`, then `finish` with a result that cites the doc (`no_pr_reason` is not
  needed; research takes any result or a doc).
- `thread_post`: the closing line, with a link of kind `doc` or `idea`.

## Steps

1. **Write the questions first.** Three to seven, each tied to a decision the idea needs. Research with
   no decision behind it is not asked for.
2. **Go to primary sources.** The vendor's own documentation and pricing page, the text of the rule or
   law, a changelog, source code, a published paper, a status page, your own measurement. Blogs, forum
   answers, summaries and AI answers are only a way to find the primary source.
   For an idea (something to build), also find **how others do it**: at least two outside products,
   libraries or guides that solve the same thing, each linked. The repo tells you what exists, not what
   works elsewhere; research that read only the code is not finished (PLA-82, F-11: «No se consultó
   fuente externa» on a one-minute run). If nothing outside applies, say what you searched in «Lo que no
   se sabe».
3. **Open the page and read the part that supports the claim.** Never cite from a search snippet or
   from memory. If the page does not say it, the claim goes.
4. **Link each claim where it is made**, in the same sentence: `[texto](url)`. One source per number.
   When a page shows a version or a "last updated" date, say it: prices and limits go stale.
5. **Quote numbers exactly**, with the unit and what they measure. Do not round to something convenient
   and do not convert without saying so.
6. **Show conflicts.** When two sources disagree, give both links and say which one you trust and why.
7. **Mark what is not a finding.** Your own reasoning starts with `Inferencia:`. A claim that only has a
   secondary source ends with `(fuente secundaria)`.
8. **Write what is unknown.** Under `What we learned`, a list titled «Lo que no se sabe»: what you
   looked for, where, and that nothing was found. Never fill a gap with something plausible.

## The doc

Plain words in the owner's language under the English headings.

- `What we learned`: the answers to your questions, each claim linked. Then «Lo que no se sabe».
- `Options`: two to four real options, one of which may be to do nothing. Each with what it gives, what
  it costs, and its risks. The costs and limits are linked like any other claim.
- `Recommendation`: one option, the claims it rests on, and what would change your mind.

Keep quotes short and in quotation marks; summarise the rest in your own words. No personal data and no
secrets, even if a source shows them.

## Done when

- Every claim a reader could doubt has a link, or is marked `Inferencia:`.
- Every link was opened in this run and says what the claim says.
- «Lo que no se sabe» exists, even if it only says that nothing was left unanswered.
- For an idea, at least two outside sources on how others solve it, or the searches that found none.
- The recommendation names one option.
- The doc is attached, and the idea's stage moved or the ticket is In review.

Origin: seed skill from the audit of 2026-11-17 (AUDIT-4); no run on record yet. It prevents a Research doc that reads well and passes the heading check while its numbers come from memory or a search snippet, and its gaps are filled with guesses.
