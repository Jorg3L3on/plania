// NEWPROJ-5: the ways a run can fail before its process starts. Each is a run summary "fail: <reason>" written by
// runner.ts start(), the preflight, worktree.ts or the admission reaper, with nothing done on the step. The screen
// words each one (ui/src/lib/arranque.ts) and the project's read marks a step whose newest run ended this way
// (src/api/etapa.ts). test/newproj5-start-failures.test.ts reads every "fail: …" the runner code writes and fails
// when one is in neither list here, so a new start-up failure cannot reach the screen without words.
export const START_FAILURES = [
  "missing env PLANIA_RUNNER_TOKEN",
  "no prompt doc",
  // PLA-158 (F-31): a builder run never falls back to the app's own database.
  "no taller database",
  "base not allowed",
  "bad worktree name",
  "worktree inside the repo",
  "no repo",
  "worktree unreadable",
  "fetch origin/sandbox",
  "worktree add",
  "read copy checkout",
  "start lost",
  // PLA-I67-6: a «Probar» run whose trial row is gone before it starts (runner.ts).
  "no such trial",
  // PLA-I67-6: the trial's copy of the work: a base that is not a commit, or a copy git could not make (trial.ts).
  "trial base",
  "trial copy",
  // start() threw before the process ran: "fail: start (<error>)" (runner.ts, where admitted runs start).
  "start",
] as const;
export type StartFailure = (typeof START_FAILURES)[number];

// Failures of a run that did start: they are not the step's start-up problem. Claude's own result subtypes
// ("fail: error_max_turns (…)") are written from a variable and are after-start too.
// PLA-I2-12: "signed out" is Claude Code signed out on this machine (src/runner/signed-out.ts).
export const AFTER_START_FAILURES = ["no result", "signed out", "orphaned", "worker lost", "pack file in the diff"] as const;

// "fail: no prompt doc (Prompt: QA)" → "no prompt doc"; "fail: base not allowed (branch main)" → "base not allowed".
export const failReason = (summary: string): string | null => {
  const m = /^fail:\s*(.*)$/i.exec(summary.trim());
  return m ? m[1]!.split("(")[0]!.trim() : null;
};

export const startFailureOf = (summary: string | null | undefined): StartFailure | null => {
  const r = summary ? failReason(summary) : null;
  return r && (START_FAILURES as readonly string[]).includes(r) ? (r as StartFailure) : null;
};
