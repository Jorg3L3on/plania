// PLA-I42-4: every label of the /brief page and its settings sheet, in English and Spanish (D5: the page follows the
// brief's language; the nav tab stays "Brief"; the rest of Plania stays Spanish). Components never hard-code a label:
// they read BRIEF_LABELS[language]. Weekdays and months come from Intl.DateTimeFormat(language); counts use the
// plural functions below.
import type { BriefLanguage, PlanLine } from "@/lib/brief";

type Plural = (n: number) => string;
export type BriefLabels = {
  kicker: string;
  title: string;
  generate: string;
  generating: string;
  generatingMin: (min: number) => string;
  waitingBuild: string;
  today: string;
  history: string;
  settings: string;
  settingsSoon: string;
  empty: (time: string) => string;
  off: string;
  failed: string;
  refreshFailed: string;
  runFailedAt: (time: string) => string;
  signInFix: string;
  pastDay: string;
  needLine: Plural;
  nothingNeeds: string;
  blockers: Plural;
  ready: Plural;
  ideas: Plural;
  checked: Plural;
  notChecked: string;
  all: string;
  allApps: string;
  view: string;
  appFilter: string;
  openPerApp: string;
  needsYou: string;
  upNext: string;
  noNeeds: string;
  noNext: string;
  blocker: string;
  open: string;
  check: (title: string) => string;
  generated: (stamp: string) => string;
  missing: string;
  ideasTitle: string;
  ideasHint: string;
  ideasCount: Plural;
  from: (source: string) => string;
  flags: { cost: string; outside_service: string; legal: string; repo_change: string; big: string; overlap: (ref: string) => string };
  hideIdea: (title: string) => string;
  selectIdea: (title: string) => string;
  noIdeas: string;
  sendBar: string;
  toPlania: Plural;
  reply: string;
  clear: string;
  copyReply: string;
  copied: string;
  copyFailed: string;
  sendToPlania: string;
  // PLA-I43: the cost line before sending, sending, and the progress per idea.
  sendCost: (bots: number, low: number, high: number) => string;
  sending: string;
  sendFailed: string;
  alreadySent: (codes: string) => string;
  progress: string;
  planLine: (l: PlanLine) => string;
  planOpen: string;
  planDone: string;
  planPartial: string;
  dismiss: string;
  s: SettingsLabels;
  d: DeskLabels;
  c: CityLabels;
};

/** PLA-I51: counts that make the voice line and a tower's accessible name. */
export type CityCounts = { blocked: number; needs: number; next: number; ideas: number };
/** One piece of the voice line; tone colours it (blocked red, owner orange). */
export type VoicePart = { text: string; tone?: "blocked" | "owner" };

/** PLA-I51: the city at dawn's labels (city.tsx retired in PLA-I63-5; the brief in Compañía reuses them). */
export type CityLabels = {
  cross: string;
  projects: string;
  onDesk: string;
  handled: Plural;
  handledTitle: Plural;
  handledEmpty: string;
  upToDate: string;
  isUpToDate: (name: string) => string;
  tower: (name: string, c: CityCounts) => string;
  voice: (c: CityCounts) => VoicePart[];
  pending: string;
  ofTotal: (open: number, total: number) => string;
  ideas: string;
  newTab: string;
  inPlaniaTab: string;
  ideasTabs: string;
  morePlanned: Plural;
  onlyPlanned: Plural;
  noNewIdeas: string;
  noOpenIdeas: string;
  noRows: string;
  prevProject: (name: string) => string;
  nextProject: (name: string) => string;
  position: (i: number, n: number) => string;
  prevCard: string;
  nextCard: string;
  readNow: string;
  doIt: string;
  // PLA-45: under «Activar corridas» when the card is about something else (a PR, a ticket): why that is the button.
  runsWhy: (project: string) => string;
  giveIt: string;
  giveIdea: string;
  keepIt: string;
  seeHere: (key: string) => string;
  readDocs: string;
  sketchLink: string;
  github: string;
  ideaInPlania: string;
  newIdea: string;
  stage: string;
  stages: { idea: string; research: string; design: string; planning: string; ready: string };
  isOpen: string;
  isPlanned: string;
  plannedNote: string;
  inPlaniaNote: string;
  status: { blocker: string; needs_you: string; next: string; open_pr: string; idea: string };
  nextWithWork: string;
  emptyHand: string;
  clear: string;
  clearLine: (n: number, time: string) => string;
  genMenu: string;
  genBoth: [string, string];
  genBrief: [string, string];
  genIdeas: [string, string];
  howToFix: string;
  hide: string;
  fixAuth: string[];
  fixOther: string[];
  failedAt: (time: string) => string;
  authReason: string;
  stillShowing: (time: string) => string;
  partial: { brief: string; ideas: string; both: string; github: string };
  keys: string;
  close: string;
  doc: string;
};

/** PLA-I49-4: the row and idea labels, verbs and stamps per action id (src/brief/actions.ts); V3 (city.tsx) reuses them. */
export type DeskAction = "answer" | "step_done" | "add_to_pr" | "publish" | "accept_pr" | "request_changes" | "resume_runs" | "postpone" | "put_first" | "hold" | "fix_finding" | "close_idea" | "later" | "dismiss" | "give_to_po" | "start_now" | "start_building";
export type DeskKind = "question" | "step" | "release" | "pr" | "ticket" | "initiative" | "idea" | "runs" | "env" | "finding" | "none";
export type DeskConfirm = { project: string; key?: string | null; pr?: number | null; from?: string; into?: string; tickets?: number; migrations?: string[]; path?: string | null; code?: string };
export type DeskLabels = {
  piles: { needs: string; next: string; ideas: string };
  left: Plural;
  handledToday: Plural;
  menu: string;
  labelsIn: string;
  pileEmpty: string;
  clear: string;
  you: string;
  hand: string;
  away: string;
  out: string;
  outEmpty: string;
  none: string;
  readOnly: string;
  backToday: string;
  loading: string;
  retry: string;
  openInPlania: string;
  openOnGithub: string;
  kinds: Record<DeskKind, string>;
  releaseReady: string;
  releaseNotReady: (reason: string) => string;
  reasons: Record<string, string>;
  verbs: Record<DeskAction, string>;
  stamps: Record<DeskAction, string>;
  confirm: { publish: (c: DeskConfirm) => string; accept_pr: (c: DeskConfirm) => string; add_to_pr: (c: DeskConfirm) => string; resume_runs: (c: DeskConfirm) => string; fix_finding: (c: DeskConfirm) => string };
  yourAnswer: string;
  answerText: string;
  changesAsk: string;
  later: string;
  laterHint: string;
  notRelevant: string;
  notRelevantHint: string;
  why: string;
  cancel: string;
  send: string;
  undo: string;
  undone: string;
  failed: string;
  nothingChanged: string;
  tryAgain: string;
  stale: string;
  working: string;
  roles: { po: string; artist: string; research: string; taller: string };
  giveToPo: string;
  soon: string;
  offline: string;
  ideaPo: string;
  ideaCost: (bots: number, low: number, high: number) => string;
  wakeCost: (agent: string, low: number, high: number) => string;
  waitsPaused: (project: string) => string;
  waitsCompany: string;
  afterRun: (agent: string) => string;
  noteForPo: string;
  buildWhat: (keys: string[]) => string;
  waitingPaused: (project: string) => string;
  idea: {
    keep: string;
    keepHint: string;
    discard: string;
    discardHint: string;
    why: string;
    reasons: Record<string, string>;
    sketch: string;
    research: string;
    plan: string;
    fate: Record<string, string>;
    seen: (days: number) => string;
    inMotion: string;
    today: string;
    next: Record<string, string>;
    openDoc: string;
    many: (n: number) => string;
  };
  wake: string;
  ideasInHand: Plural;
  ideaHint: string;
  dropSelection: string;
  hideIdea: string;
  hideIdeaHint: string;
  ev: { asked: string; options: string; step: string; ticket: string; status: string; tickets: string; migrations: string; before: string; checks: string; ahead: string; state: string; pr: string; runs: string; record: string; finding: string };
  paused: string;
  on: string;
  none_: string;
  testCopy: string;
  handledAt: (time: string) => string;
};

/** The settings sheet (spec §8 "Settings sheet") and its Setup check. */
export type SettingsLabels = {
  title: string;
  description: string;
  close: string;
  general: string;
  enabled: string;
  enabledHint: string;
  runAt: string;
  fallbackAt: string;
  fallbackHint: string;
  timezone: string;
  timezoneHint: (resolved: string) => string;
  timezoneLabel: string;
  language: string;
  languages: { en: string; es: string };
  // PLA-I2-10: the brief follows the install's language.
  languageFollows: string;
  ownerName: string;
  ownerHint: (resolved: string) => string;
  content: string;
  hiddenRefs: string;
  hiddenRefsHint: string;
  addRef: string;
  removeRef: (ref: string) => string;
  maxItems: string;
  ideasPerProject: string;
  ideasEnabled: string;
  model: string;
  modelHint: string;
  projects: string;
  projectsHint: string;
  include: (name: string) => string;
  includeIdeas: (name: string) => string;
  inBrief: string;
  ideasOn: string;
  letter: string;
  order: string;
  editPersona: string;
  hidePersona: string;
  persona: (name: string) => string;
  personaHint: string;
  personaNone: string;
  savePersona: string;
  personaSaved: string;
  personaStale: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  cancel: string;
  loading: string;
  setup: string;
  setupHint: string;
  setupOk: string;
  setupBad: string;
  setupFailed: string;
};

const NUM_ES = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];

/** "a, b and c." with the first letter capitalised. */
function joinVoice(parts: VoicePart[], comma: string, and: string): VoicePart[] {
  if (!parts.length) return [];
  const out: VoicePart[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push({ text: i === parts.length - 1 ? and : comma });
    out.push(i === 0 ? { ...p, text: p.text.slice(0, 1).toUpperCase() + p.text.slice(1) } : p);
  });
  out.push({ text: "." });
  return out;
}

const en: BriefLabels = {
  kicker: "Today",
  title: "Morning brief",
  generate: "Generate now",
  generating: "Generating…",
  generatingMin: (m) => `Generating… ${m} min`,
  waitingBuild: "Waiting for the current build",
  today: "Today",
  history: "Brief of",
  settings: "Settings",
  settingsSoon: "Settings (coming soon)",
  empty: (time) => `No brief yet. It runs at ${time}, or press Generate now.`,
  off: "Morning brief is off. Turn it on in settings.",
  failed: "Couldn't load the brief.",
  refreshFailed: "Couldn't refresh",
  runFailedAt: (time) => `Couldn't update at ${time}`,
  signInFix: "Claude is not signed in. Run `claude` on the machine, type /login, then press Generate now.",
  pastDay: "A past brief, read-only.",
  needLine: (n) => (n === 1 ? "1 thing needs you" : `${n} things need you`),
  nothingNeeds: "Nothing needs you",
  blockers: (n) => (n === 1 ? "1 release blocker" : `${n} release blockers`),
  ready: (n) => `${n} ready to pick up`,
  ideas: (n) => (n === 1 ? "1 new idea" : `${n} new ideas`),
  checked: (n) => `${n} checked`,
  notChecked: "Not checked",
  all: "All",
  allApps: "All apps",
  view: "Show",
  appFilter: "Filter by app",
  openPerApp: "Open items per app",
  needsYou: "Needs you",
  upNext: "Up next",
  noNeeds: "Nothing needs you here.",
  noNext: "Nothing up next here.",
  blocker: "Blocker",
  open: "Open",
  check: (t) => `Done: ${t}`,
  generated: (s) => `Generated ${s}`,
  missing: "Some parts are missing. See Needs you.",
  ideasTitle: "Today's ideas",
  ideasHint: "Select ideas to send to Plania, or reply with their codes.",
  ideasCount: (n) => (n === 1 ? "1 idea" : `${n} ideas`),
  from: (s) => `from ${s}`,
  flags: { cost: "costs money", outside_service: "new outside service", legal: "legal review", repo_change: "repo change", big: "big", overlap: (r) => `overlaps ${r}` },
  hideIdea: (t) => `Hide: ${t}`,
  selectIdea: (t) => `Select: ${t}`,
  noIdeas: "No ideas here.",
  sendBar: "Selected ideas",
  toPlania: (n) => (n === 1 ? "1 idea → Plania" : `${n} ideas → Plania`),
  reply: "Reply",
  clear: "Clear",
  copyReply: "Copy reply",
  copied: "Copied",
  copyFailed: "Couldn't copy",
  sendToPlania: "Send to Plania",
  sendCost: (bots, low, high) => `This wakes ${bots === 1 ? "1 project bot" : `${bots} project bots, one after another,`} about ${low}–${high} min`,
  sending: "Sending…",
  sendFailed: "Couldn't send. Try again.",
  alreadySent: (codes) => `Already sent: ${codes}`,
  progress: "Send to Plania progress",
  planLine: (l) => {
    switch (l.kind) {
      case "queued":
        return "Queued";
      case "planning":
        return `Planning in ${l.project}`;
      case "planned":
        return `Planned as ${l.key}, ${l.tickets === 1 ? "1 ticket" : `${l.tickets} tickets`}, Backlog`;
      case "duplicate":
        return `Duplicate of ${l.key}`;
      case "proposed":
        return "Proposed in Te toca instead of planned";
      case "failed":
        return l.note ? `Failed: ${l.note}` : "Failed";
      case "waiting":
        return `Waiting: ${l.project} runs are paused`;
      case "waitingCompany":
        return "Waiting: company runs are paused";
    }
  },
  planOpen: "The project bots plan these one after another.",
  planDone: "Every idea is planned. Nothing starts until you move a ticket to Ready.",
  planPartial: "Done, with some failed. Select them and send again.",
  dismiss: "Close",
  s: {
    title: "Brief settings",
    description: "The morning brief for every project. Changes apply to the next brief.",
    close: "Close",
    general: "Schedule",
    enabled: "Morning brief on",
    enabledHint: "Off means no scheduled run. Generate now still works.",
    runAt: "Run time",
    fallbackAt: "Fallback time",
    fallbackHint: "If the full brief hasn't started by then, a facts-only brief is stored.",
    timezone: "Time zone",
    timezoneHint: (r) => `Blank uses the server zone (now ${r}).`,
    timezoneLabel: "Zone label",
    language: "Language",
    languages: { en: "English", es: "Spanish" },
    languageFollows: "Follows Plania's language, set in Plomería.",
    ownerName: "Owner name",
    ownerHint: (r) => `Blank uses the server default (now “${r}”).`,
    content: "Content",
    hiddenRefs: "Hidden refs",
    hiddenRefsHint: "Items and ideas that mention one of these are left out.",
    addRef: "Add",
    removeRef: (r) => `Remove ${r}`,
    maxItems: "Max items per app",
    ideasPerProject: "Ideas per project",
    ideasEnabled: "Ideas on",
    model: "Model",
    modelHint: "Blank uses Claude's default.",
    projects: "Projects",
    projectsHint: "Include, ideas, idea letter and order for each project.",
    include: (n) => `Include ${n} in the brief`,
    includeIdeas: (n) => `Ideas for ${n}`,
    inBrief: "In brief",
    ideasOn: "Ideas",
    letter: "Letter",
    order: "Order",
    editPersona: "Edit persona",
    hidePersona: "Close persona",
    persona: (n) => `Idea persona for ${n}`,
    personaHint: "Who suggests this project's ideas. Saved as the project doc “Idea persona”.",
    personaNone: "No persona yet.",
    savePersona: "Save persona",
    personaSaved: "Persona saved",
    personaStale: "Someone changed it meanwhile. Reopen it and try again.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Couldn't save. Check the fields.",
    cancel: "Cancel",
    loading: "Loading…",
    setup: "Setup check",
    setupHint: "Read-only. The Claude login check runs only in pnpm brief:doctor.",
    setupOk: "OK",
    setupBad: "Needs attention",
    setupFailed: "Couldn't run the setup check.",
  },
  d: {
    piles: { needs: "Needs you", next: "Up next", ideas: "Ideas" },
    left: (n) => (n === 1 ? "left on your desk" : "left on your desk"),
    handledToday: (n) => `${n} handled today`,
    menu: "Brief menu",
    labelsIn: "Labels: English",
    pileEmpty: "This pile is empty.",
    clear: "Your desk is clear.",
    you: "Do it yourself",
    hand: "Hand it to",
    away: "Put it away",
    out: "Out tray",
    outEmpty: "Handled papers land here.",
    none: "Nothing to stamp here. Hand it over or put it away.",
    readOnly: "A past day: read only.",
    backToday: "Back to today",
    loading: "Reading your projects…",
    retry: "Retry",
    openInPlania: "Open in Plania",
    openOnGithub: "Open on GitHub",
    kinds: { question: "Question", step: "Your step", release: "Release", pr: "PR waiting", ticket: "Ticket", initiative: "Initiative", idea: "Idea", runs: "Paused project", env: "Inconsistency", finding: "Inconsistency", none: "Note" },
    releaseReady: "Release · ready",
    releaseNotReady: (r) => `Release · not ready: ${r}`,
    reasons: { mode_command: "ships by command", no_repo: "no GitHub repo", no_github_data: "no GitHub data yet", nothing_to_ship: "nothing to ship", before_steps: "steps before", open_checks: "checks open", merged: "already merged" },
    verbs: { answer: "Answer", step_done: "Done", add_to_pr: "Add to PR", publish: "Publish to main", accept_pr: "Approve into the test copy", request_changes: "Ask for changes", resume_runs: "Turn on runs", postpone: "Postpone", put_first: "Put first", hold: "Put on hold", fix_finding: "Fix it", close_idea: "Discard", later: "Later", dismiss: "Not relevant", give_to_po: "Give to PO", start_now: "Start now", start_building: "Start building" },
    stamps: { answer: "Answered", step_done: "Done", add_to_pr: "Added", publish: "Published", accept_pr: "Approved", request_changes: "Sent back", resume_runs: "Runs on", postpone: "Postponed", put_first: "First", hold: "On hold", fix_finding: "Fixed", close_idea: "Discarded", later: "Later", dismiss: "Not relevant", give_to_po: "To PO", start_now: "To Taller", start_building: "Building" },
    confirm: {
      publish: (c) => `This publishes ${c.from && c.from !== "sandbox" ? c.from : "the test copy"} to ${c.into ?? "main"} for ${c.project}: ${c.tickets ?? 0} ticket${c.tickets === 1 ? "" : "s"}${c.migrations?.length ? `, migrations ${c.migrations.join(", ")}` : ", no migrations"}. Prod deploys from ${c.into ?? "main"}.`,
      accept_pr: (c) => `This merges PR #${c.pr} into ${c.project}'s test copy. Nothing published changes.`,
      add_to_pr: (c) => `Plania commits the lines to ${c.path ?? "the file"} on ${c.key ?? "the ticket"}'s PR branch, then marks the step done.`,
      resume_runs: (c) => `This turns on ${c.project}'s runs. Its bots start within a few minutes and use your plan ($0).`,
      fix_finding: (c) => `Plania runs the fix for ${c.code ?? "this finding"}${c.key ? ` on ${c.key}` : ""} and audits ${c.project} again.`,
    },
    yourAnswer: "Your answer",
    answerText: "Or write it",
    changesAsk: "What should change? It goes back to its owner with your note.",
    later: "Later",
    laterHint: "Back tomorrow",
    notRelevant: "Not relevant",
    notRelevantHint: "Leaves the brief",
    why: "Why? (optional)",
    cancel: "Cancel",
    send: "Send back",
    undo: "Undo",
    undone: "Undone",
    failed: "Could not do it",
    nothingChanged: "Nothing changed.",
    tryAgain: "Try again",
    stale: "This changed meanwhile; the paper shows it as it is now.",
    working: "Working…",
    roles: { po: "PO", artist: "Artist", research: "Research", taller: "Taller" },
    giveToPo: "Give to PO",
    soon: "not for this paper",
    offline: "Plania did not answer (it may be restarting). Try again in a moment.",
    ideaPo: "Plan it",
    ideaCost: (bots, low, high) => `Wakes ${bots} project bot${bots === 1 ? "" : "s"} · about ${low}–${high} min · uses your plan, $0`,
    wakeCost: (agent, low, high) => `Wakes ${agent} · about ${low}–${high} min · uses your plan, $0`,
    waitsPaused: (p) => `waits until ${p} runs are on`,
    waitsCompany: "waits until the company is running again",
    afterRun: (a) => `after ${a}'s current run`,
    noteForPo: "A note for the PO (optional)",
    buildWhat: (keys) => `This moves ${[keys].flat().join(", ")} to Ready. Taller starts the first one; the later phases stay in Backlog.`,
    waitingPaused: (p) => `Waiting: ${p} runs are paused.`,
    idea: {
      keep: "Keep",
      keepHint: "Saved in Plania as an idea",
      discard: "Discard",
      discardHint: "Not proposed again",
      why: "Why not?",
      reasons: { not_now: "Not now", not_for_product: "Not for this product", exists: "Already exists", too_big: "Too big", costs_money: "Costs money", other: "Other" },
      sketch: "Sketch it",
      research: "Research it",
      plan: "Plan it",
      fate: { kept: "Kept", discarded: "Discarded", research: "Research", sketch: "Sketch", planned: "To PO", open: "Open" },
      seen: (n) => `seen ${n} day${n === 1 ? "" : "s"}`,
      inMotion: "In motion",
      today: "Today's ideas",
      next: { sketch_ready: "Sketch ready", research_ready: "Research ready", planned: "Planned", in_motion: "In Plania" },
      openDoc: "Open it",
      many: (n) => `${n} ideas`,
    },
    wake: "Wake",
    ideasInHand: (n) => `${n} ideas in hand`,
    ideaHint: "Hand them to the PO on the right, or put them away.",
    dropSelection: "Clear selection",
    hideIdea: "Hide",
    hideIdeaHint: "Out of today's ideas",
    ev: { asked: "Asked", options: "Options", step: "Step", ticket: "Ticket", status: "Status", tickets: "Ships", migrations: "Migrations", before: "Steps before", checks: "Open checks", ahead: "Ahead", state: "State", pr: "PR", runs: "Runs", record: "Record", finding: "Finding" },
    paused: "paused",
    on: "on",
    none_: "None",
    testCopy: "test copy",
    handledAt: (t) => `at ${t}`,
  },
  c: {
    cross: "Between apps",
    projects: "Projects",
    onDesk: "on your desk",
    handled: (n) => `${n} handled today`,
    handledTitle: (n) => `Handled today · ${n}`,
    handledEmpty: "Handled cards land here, with Undo.",
    upToDate: "up to date",
    isUpToDate: (name) => `${name} is up to date.`,
    tower: (name, c) => (c.blocked + c.needs + c.next + c.ideas ? `${name}: ${[c.blocked ? `${c.blocked} blocker${c.blocked === 1 ? "" : "s"}` : "", c.needs ? `${c.needs} your turn` : "", c.next ? `${c.next} next` : "", c.ideas ? `${c.ideas} idea${c.ideas === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")}` : `${name}: up to date`),
    voice: (c) => {
      const parts: VoicePart[] = [];
      if (c.blocked) parts.push({ text: c.blocked === 1 ? "one blocker goes first" : `${c.blocked} blockers go first`, tone: "blocked" });
      if (c.needs) parts.push({ text: c.needs === 1 ? "one thing is your turn" : `${c.needs} things are your turn`, tone: "owner" });
      if (c.next) parts.push({ text: c.next === 1 ? "one is next" : `${c.next} are next` });
      if (c.ideas) parts.push({ text: c.ideas === 1 ? "there is one new idea" : `there are ${c.ideas} new ideas` });
      return joinVoice(parts, ", ", " and ");
    },
    pending: "Pending",
    ofTotal: (o, t) => `${o} of ${t}`,
    ideas: "Ideas",
    newTab: "New",
    inPlaniaTab: "Already in Plania",
    ideasTabs: "Ideas",
    morePlanned: (n) => `and ${n} more, already planned`,
    onlyPlanned: (n) => (n === 1 ? "1 idea already planned" : `${n} ideas already planned`),
    noNewIdeas: "No new ideas for this project today.",
    noOpenIdeas: "No open ideas in Plania.",
    noRows: "Nothing pending here.",
    prevProject: (n) => `Previous: ${n}`,
    nextProject: (n) => `Next: ${n}`,
    position: (i, n) => `${i} of ${n}`,
    prevCard: "Previous card",
    nextCard: "Next card",
    readNow: "Read from Plania now",
    doIt: "Do it yourself",
    runsWhy: (p) => `${p} is paused: its bots do nothing here until you turn its runs on. Turning them on lets them pick this up.`,
    giveIt: "Hand it to",
    giveIdea: "Hand it to",
    keepIt: "Put it away",
    seeHere: (k) => `See ${k} here`,
    readDocs: "Read its docs here",
    sketchLink: "Sketch",
    github: "GitHub",
    ideaInPlania: "Idea in Plania",
    newIdea: "New idea",
    stage: "Stage",
    stages: { idea: "Idea", research: "Research", design: "Design", planning: "Planning", ready: "Ready" },
    isOpen: "Open",
    isPlanned: "Already an initiative",
    plannedNote: "Already planned. It stays here to look at.",
    inPlaniaNote: "Its next step is set in Plania: open it here to move it.",
    status: { blocker: "Blocker", needs_you: "Your turn", next: "Next", open_pr: "Next", idea: "Idea" },
    nextWithWork: "Next project",
    emptyHand: "Nothing in hand.",
    clear: "Your desk is clear.",
    clearLine: (n, t) => `${n} handled today. Tomorrow's brief comes at ${t}.`,
    genMenu: "Generate now · uses your plan, $0",
    genBoth: ["Pending and ideas", "about 3 min"],
    genBrief: ["Pending only", "1 min · today's ideas stay"],
    genIdeas: ["Ideas only", "2 min · the part that uses most of your plan"],
    howToFix: "How to fix it",
    hide: "Hide",
    fixAuth: ["Open Terminal on the machine.", "Type claude, then /login.", "Come back here and press Retry."],
    fixOther: ["On the machine, run pnpm brief:doctor to see what failed.", "Come back here and press Retry."],
    failedAt: (t) => `Couldn't update at ${t}.`,
    authReason: "Claude lost its sign-in on this machine, so no new rows or ideas came in.",
    stillShowing: (t) => `You are still seeing the brief of ${t}.`,
    partial: { brief: "Claude's rows did not come in; the rows from Plania's own data still work.", ideas: "Today's ideas did not come in.", both: "Claude's part did not come in: these rows are Plania's own data.", github: "GitHub data did not come in; PRs may be out of date." },
    keys: "J K move · ← → project · Enter first action · L later · X not relevant · Z undo",
    close: "Close",
    doc: "Docs",
  },
};

const es: BriefLabels = {
  kicker: "Hoy",
  title: "Brief de la mañana",
  generate: "Generar ahora",
  generating: "Generando…",
  generatingMin: (m) => `Generando… ${m} min`,
  waitingBuild: "Esperando la construcción en curso",
  today: "Hoy",
  history: "Brief del",
  settings: "Ajustes",
  settingsSoon: "Ajustes (pronto)",
  empty: (time) => `Aún no hay brief. Corre a las ${time}, o pulsa Generar ahora.`,
  off: "El brief de la mañana está apagado. Enciéndelo en ajustes.",
  failed: "No se pudo cargar el brief.",
  refreshFailed: "No se pudo actualizar",
  runFailedAt: (time) => `No se pudo actualizar a las ${time}`,
  signInFix: "Claude no tiene sesión iniciada. Corre `claude` en la máquina, escribe /login y pulsa Generar ahora.",
  pastDay: "Un brief pasado, solo lectura.",
  needLine: (n) => (n === 1 ? "1 cosa te necesita" : `${n} cosas te necesitan`),
  nothingNeeds: "Nada te necesita",
  blockers: (n) => (n === 1 ? "1 bloqueo de release" : `${n} bloqueos de release`),
  ready: (n) => (n === 1 ? "1 lista para tomar" : `${n} listas para tomar`),
  ideas: (n) => (n === 1 ? "1 idea nueva" : `${n} ideas nuevas`),
  checked: (n) => (n === 1 ? "1 marcada" : `${n} marcadas`),
  notChecked: "Sin marcar",
  all: "Todo",
  allApps: "Todas las apps",
  view: "Mostrar",
  appFilter: "Filtrar por app",
  openPerApp: "Pendientes por app",
  needsYou: "Te necesita",
  upNext: "Lo siguiente",
  noNeeds: "Aquí nada te necesita.",
  noNext: "Aquí no hay nada siguiente.",
  blocker: "Bloqueo",
  open: "Abrir",
  check: (t) => `Hecho: ${t}`,
  generated: (s) => `Generado ${s}`,
  missing: "Faltan algunas partes. Mira Te necesita.",
  ideasTitle: "Ideas de hoy",
  ideasHint: "Elige ideas para mandarlas a Plania, o responde con sus códigos.",
  ideasCount: (n) => (n === 1 ? "1 idea" : `${n} ideas`),
  from: (s) => `de ${s}`,
  flags: { cost: "cuesta dinero", outside_service: "servicio externo nuevo", legal: "revisión legal", repo_change: "cambio de repo", big: "grande", overlap: (r) => `se cruza con ${r}` },
  hideIdea: (t) => `Ocultar: ${t}`,
  selectIdea: (t) => `Elegir: ${t}`,
  noIdeas: "Aquí no hay ideas.",
  sendBar: "Ideas elegidas",
  toPlania: (n) => (n === 1 ? "1 idea → Plania" : `${n} ideas → Plania`),
  reply: "Respuesta",
  clear: "Limpiar",
  copyReply: "Copiar respuesta",
  copied: "Copiada",
  copyFailed: "No se pudo copiar",
  sendToPlania: "Mandar a Plania",
  sendCost: (bots, low, high) => `Esto despierta ${bots === 1 ? "a 1 bot de proyecto" : `a ${bots} bots de proyecto, uno tras otro,`} unos ${low}–${high} min`,
  sending: "Mandando…",
  sendFailed: "No se pudo mandar. Inténtalo de nuevo.",
  alreadySent: (codes) => `Ya mandadas: ${codes}`,
  progress: "Avance de Mandar a Plania",
  planLine: (l) => {
    switch (l.kind) {
      case "queued":
        return "En cola";
      case "planning":
        return `Planeando en ${l.project}`;
      case "planned":
        return `Planeada como ${l.key}, ${l.tickets === 1 ? "1 ticket" : `${l.tickets} tickets`}, Backlog`;
      case "duplicate":
        return `Duplicada de ${l.key}`;
      case "proposed":
        return "Propuesta en Te toca en vez de planeada";
      case "failed":
        return l.note ? `Falló: ${l.note}` : "Falló";
      case "waiting":
        return `En espera: las corridas de ${l.project} están en pausa`;
      case "waitingCompany":
        return "En espera: las corridas de la compañía están en pausa";
    }
  },
  planOpen: "Los bots de cada proyecto las planean una tras otra.",
  planDone: "Todas las ideas quedaron planeadas. Nada empieza hasta que pases un ticket a Ready.",
  planPartial: "Listo, con algunas fallidas. Elígelas y mándalas otra vez.",
  dismiss: "Cerrar",
  s: {
    title: "Ajustes del brief",
    description: "El brief de la mañana para todos los proyectos. Los cambios valen para el siguiente brief.",
    close: "Cerrar",
    general: "Horario",
    enabled: "Brief de la mañana encendido",
    enabledHint: "Apagado no hay corrida programada. Generar ahora sigue funcionando.",
    runAt: "Hora de corrida",
    fallbackAt: "Hora límite",
    fallbackHint: "Si el brief completo no ha empezado a esa hora, se guarda uno solo con datos.",
    timezone: "Zona horaria",
    timezoneHint: (r) => `Vacío usa la zona del servidor (ahora ${r}).`,
    timezoneLabel: "Etiqueta de zona",
    language: "Idioma",
    languages: { en: "Inglés", es: "Español" },
    languageFollows: "Sigue el idioma de Plania, que se cambia en Plomería.",
    ownerName: "Nombre del dueño",
    ownerHint: (r) => `Vacío usa el valor del servidor (ahora “${r}”).`,
    content: "Contenido",
    hiddenRefs: "Refs ocultas",
    hiddenRefsHint: "Se omiten los pendientes e ideas que mencionen alguna.",
    addRef: "Agregar",
    removeRef: (r) => `Quitar ${r}`,
    maxItems: "Máximo de pendientes por app",
    ideasPerProject: "Ideas por proyecto",
    ideasEnabled: "Ideas encendidas",
    model: "Modelo",
    modelHint: "Vacío usa el modelo por defecto de Claude.",
    projects: "Proyectos",
    projectsHint: "Incluir, ideas, letra de idea y orden de cada proyecto.",
    include: (n) => `Incluir ${n} en el brief`,
    includeIdeas: (n) => `Ideas para ${n}`,
    inBrief: "En el brief",
    ideasOn: "Ideas",
    letter: "Letra",
    order: "Orden",
    editPersona: "Editar persona",
    hidePersona: "Cerrar persona",
    persona: (n) => `Persona de ideas de ${n}`,
    personaHint: "Quién propone las ideas de este proyecto. Se guarda como el doc del proyecto “Idea persona”.",
    personaNone: "Aún no hay persona.",
    savePersona: "Guardar persona",
    personaSaved: "Persona guardada",
    personaStale: "Alguien la cambió mientras tanto. Ábrela de nuevo e inténtalo otra vez.",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    saveFailed: "No se pudo guardar. Revisa los campos.",
    cancel: "Cancelar",
    loading: "Cargando…",
    setup: "Revisión de instalación",
    setupHint: "Solo lectura. La revisión del login de Claude corre solo en pnpm brief:doctor.",
    setupOk: "Bien",
    setupBad: "Requiere atención",
    setupFailed: "No se pudo correr la revisión de instalación.",
  },
  d: {
    piles: { needs: "Te toca", next: "Sigue", ideas: "Ideas" },
    left: () => "en tu escritorio",
    handledToday: (n) => `${n} resueltos hoy`,
    menu: "Menú del brief",
    labelsIn: "Etiquetas: español",
    pileEmpty: "Esta pila está vacía.",
    clear: "Tu escritorio está limpio.",
    you: "Hazlo tú",
    hand: "Dáselo a",
    away: "Guárdalo",
    out: "Bandeja de salida",
    outEmpty: "Aquí caen los papeles resueltos.",
    none: "Aquí no hay nada que sellar. Dáselo a alguien o guárdalo.",
    readOnly: "Un día pasado: solo lectura.",
    backToday: "Volver a hoy",
    loading: "Leyendo tus proyectos…",
    retry: "Reintentar",
    openInPlania: "Abrir en Plania",
    openOnGithub: "Abrir en GitHub",
    kinds: { question: "Pregunta", step: "Tu paso", release: "Publicación", pr: "PR en espera", ticket: "Ticket", initiative: "Iniciativa", idea: "Idea", runs: "Proyecto en pausa", env: "Inconsistencia", finding: "Inconsistencia", none: "Nota" },
    releaseReady: "Publicación · lista",
    releaseNotReady: (r) => `Publicación · no lista: ${r}`,
    reasons: { mode_command: "se publica por comando", no_repo: "sin repo de GitHub", no_github_data: "aún sin datos de GitHub", nothing_to_ship: "nada que publicar", before_steps: "pasos antes", open_checks: "checks abiertos", merged: "ya fusionada" },
    verbs: { answer: "Responder", step_done: "Hecho", add_to_pr: "Agregar al PR", publish: "Publicar a main", accept_pr: "Aprobar y pasar a prueba", request_changes: "Pedir cambios", resume_runs: "Activar corridas", postpone: "Aplazar", put_first: "Hacer primero", hold: "Poner en espera", fix_finding: "Corregir", close_idea: "Descartar", later: "Después", dismiss: "No aplica", give_to_po: "Dárselo al PO", start_now: "Empezar ya", start_building: "Empezar a construir" },
    stamps: { answer: "Respondido", step_done: "Hecho", add_to_pr: "Agregado", publish: "Publicado", accept_pr: "Aprobado", request_changes: "Devuelto", resume_runs: "Activado", postpone: "Aplazado", put_first: "Primero", hold: "En espera", fix_finding: "Corregido", close_idea: "Descartada", later: "Después", dismiss: "No aplica", give_to_po: "Al PO", start_now: "A Taller", start_building: "Construyendo" },
    confirm: {
      publish: (c) => `Esto publica ${c.from && c.from !== "sandbox" ? c.from : "la copia de prueba"} en ${c.into ?? "main"} para ${c.project}: ${c.tickets ?? 0} ticket${c.tickets === 1 ? "" : "s"}${c.migrations?.length ? `, migraciones ${c.migrations.join(", ")}` : ", sin migraciones"}. Prod se despliega desde ${c.into ?? "main"}.`,
      accept_pr: (c) => `Esto integra el PR #${c.pr} a la copia de prueba de ${c.project}. Lo publicado no cambia.`,
      add_to_pr: (c) => `Plania agrega las líneas a ${c.path ?? "el archivo"} en la rama del PR de ${c.key ?? "el ticket"} y marca el paso como hecho.`,
      resume_runs: (c) => `Esto activa las corridas de ${c.project}. Sus bots arrancan en unos minutos y usan tu plan ($0).`,
      fix_finding: (c) => `Plania corre la corrección de ${c.code ?? "este hallazgo"}${c.key ? ` en ${c.key}` : ""} y vuelve a auditar ${c.project}.`,
    },
    yourAnswer: "Tu respuesta",
    answerText: "O escríbela",
    changesAsk: "¿Qué debe cambiar? Vuelve a su dueño con tu nota.",
    later: "Después",
    laterHint: "Vuelve mañana",
    notRelevant: "No aplica",
    notRelevantHint: "Sale del brief",
    why: "¿Por qué? (opcional)",
    cancel: "Cancelar",
    send: "Devolver",
    undo: "Deshacer",
    undone: "Deshecho",
    failed: "No se pudo",
    nothingChanged: "Nada cambió.",
    tryAgain: "Intentar otra vez",
    stale: "Esto cambió mientras tanto; el papel lo muestra como está ahora.",
    working: "Trabajando…",
    roles: { po: "PO", artist: "Artist", research: "Research", taller: "Taller" },
    giveToPo: "Dárselo al PO",
    soon: "no es para este papel",
    offline: "Plania no respondió (puede estar reiniciando). Intenta de nuevo en un momento.",
    ideaPo: "Que lo planee",
    ideaCost: (bots, low, high) => `Despierta ${bots} bot${bots === 1 ? "" : "s"} de proyecto · unos ${low}–${high} min · usa tu plan, $0`,
    wakeCost: (agent, low, high) => `Despierta a ${agent} · unos ${low}–${high} min · usa tu plan, $0`,
    waitsPaused: (p) => `espera a que ${p} tenga corridas`,
    waitsCompany: "espera a que la compañía vuelva a correr",
    afterRun: (a) => `después de la corrida actual de ${a}`,
    noteForPo: "Una nota para el PO (opcional)",
    buildWhat: (keys) => `Esto pasa ${[keys].flat().join(", ")} a Listo. Taller empieza el primero; las fases siguientes se quedan en Backlog.`,
    waitingPaused: (p) => `En espera: las corridas de ${p} están en pausa.`,
    idea: {
      keep: "Guardar",
      keepHint: "Queda en Plania como idea",
      discard: "Descartar",
      discardHint: "No se propone otra vez",
      why: "¿Por qué no?",
      reasons: { not_now: "Ahora no", not_for_product: "No es para este producto", exists: "Ya existe", too_big: "Muy grande", costs_money: "Cuesta dinero", other: "Otra razón" },
      sketch: "Boceto",
      research: "Investigar",
      plan: "Que lo planee",
      fate: { kept: "Guardada", discarded: "Descartada", research: "Investigación", sketch: "Boceto", planned: "Al PO", open: "Abierta" },
      seen: (n) => `vista ${n} día${n === 1 ? "" : "s"}`,
      inMotion: "En marcha",
      today: "Ideas de hoy",
      next: { sketch_ready: "Boceto listo", research_ready: "Investigación lista", planned: "Planeada", in_motion: "En Plania" },
      openDoc: "Abrirlo",
      many: (n) => `${n} ideas`,
    },
    wake: "Despertar a",
    ideasInHand: (n) => `${n} ideas en la mano`,
    ideaHint: "Dáselas al PO a la derecha, o guárdalas.",
    dropSelection: "Soltar selección",
    hideIdea: "Ocultar",
    hideIdeaHint: "Fuera de las ideas de hoy",
    ev: { asked: "Pregunta", options: "Opciones", step: "Paso", ticket: "Ticket", status: "Estado", tickets: "Lleva", migrations: "Migraciones", before: "Pasos antes", checks: "Checks abiertos", ahead: "Adelante", state: "Estado", pr: "PR", runs: "Corridas", record: "Registro", finding: "Hallazgo" },
    paused: "en pausa",
    on: "activas",
    none_: "Ninguna",
    testCopy: "copia de prueba",
    handledAt: (t) => `a las ${t}`,
  },
  c: {
    cross: "Entre apps",
    projects: "Proyectos",
    onDesk: "en tu mesa",
    handled: (n) => (n === 1 ? "1 resuelto hoy" : `${n} resueltos hoy`),
    handledTitle: (n) => `Resueltos hoy · ${n}`,
    handledEmpty: "Aquí caen las fichas resueltas, con Deshacer.",
    upToDate: "al día",
    isUpToDate: (name) => `${name} está al día.`,
    tower: (name, c) => (c.blocked + c.needs + c.next + c.ideas ? `${name}: ${[c.blocked ? `${c.blocked} bloqueo${c.blocked === 1 ? "" : "s"}` : "", c.needs ? `${c.needs} te toca${c.needs === 1 ? "" : "n"}` : "", c.next ? `${c.next} sigue${c.next === 1 ? "" : "n"}` : "", c.ideas ? `${c.ideas} idea${c.ideas === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")}` : `${name}: al día`),
    voice: (c) => {
      const parts: VoicePart[] = [];
      if (c.blocked) parts.push({ text: c.blocked === 1 ? "un bloqueo va primero" : `${NUM_ES[c.blocked] ?? c.blocked} bloqueos van primero`, tone: "blocked" });
      if (c.needs) parts.push({ text: c.needs === 1 ? "una cosa te toca" : `${NUM_ES[c.needs] ?? c.needs} cosas te tocan`, tone: "owner" });
      if (c.next) parts.push({ text: c.next === 1 ? "una sigue" : `${NUM_ES[c.next] ?? c.next} siguen` });
      if (c.ideas) parts.push({ text: c.ideas === 1 ? "hay una idea nueva" : `hay ${NUM_ES[c.ideas] ?? c.ideas} ideas nuevas` });
      return joinVoice(parts, ", ", " y ");
    },
    pending: "Pendientes",
    ofTotal: (o, t) => `${o} de ${t}`,
    ideas: "Ideas",
    newTab: "Nuevas",
    inPlaniaTab: "Ya en Plania",
    ideasTabs: "Ideas",
    morePlanned: (n) => `y ${n} más, ya planeada${n === 1 ? "" : "s"}`,
    onlyPlanned: (n) => (n === 1 ? "1 idea ya planeada" : `${n} ideas ya planeadas`),
    noNewIdeas: "Hoy no hay ideas nuevas para este proyecto.",
    noOpenIdeas: "No hay ideas abiertas en Plania.",
    noRows: "Aquí no hay pendientes.",
    prevProject: (n) => `Anterior: ${n}`,
    nextProject: (n) => `Siguiente: ${n}`,
    position: (i, n) => `${i} de ${n}`,
    prevCard: "Ficha anterior",
    nextCard: "Ficha siguiente",
    readNow: "Leído de Plania ahora",
    doIt: "Hazlo tú",
    runsWhy: (p) => `${p} está en pausa: sus bots no hacen nada aquí hasta que actives sus corridas. Al activarlas, ellos lo retoman.`,
    giveIt: "Dáselo a",
    giveIdea: "Dásela a",
    keepIt: "Guárdalo",
    seeHere: (k) => `Ver ${k} aquí`,
    readDocs: "Leer sus docs aquí",
    sketchLink: "Boceto",
    github: "GitHub",
    ideaInPlania: "Idea en Plania",
    newIdea: "Idea nueva",
    stage: "Etapa",
    stages: { idea: "Idea", research: "Investigación", design: "Diseño", planning: "Planeación", ready: "Lista" },
    isOpen: "Abierta",
    isPlanned: "Ya es iniciativa",
    plannedNote: "Ya está planeada. Se queda aquí solo para consultarla.",
    inPlaniaNote: "Su siguiente paso se decide en Plania: ábrela aquí para moverla.",
    status: { blocker: "Bloqueo", needs_you: "Te toca", next: "Sigue", open_pr: "Sigue", idea: "Idea" },
    nextWithWork: "Siguiente proyecto",
    emptyHand: "Nada en la mano.",
    clear: "Tu mesa está limpia.",
    clearLine: (n, t) => `${n === 1 ? "1 resuelto" : `${n} resueltos`} hoy. El brief de mañana llega a las ${t}.`,
    genMenu: "Generar ahora · usa tu plan, $0",
    genBoth: ["Pendientes e ideas", "unos 3 min"],
    genBrief: ["Solo pendientes", "1 min · las ideas de hoy se quedan"],
    genIdeas: ["Solo ideas", "2 min · la parte que más usa tu plan"],
    howToFix: "Cómo arreglarlo",
    hide: "Ocultar",
    fixAuth: ["Abre Terminal en la máquina.", "Escribe claude y luego /login.", "Vuelve aquí y pulsa Reintentar."],
    fixOther: ["En la máquina, corre pnpm brief:doctor para ver qué falló.", "Vuelve aquí y pulsa Reintentar."],
    failedAt: (t) => `No se pudo actualizar a las ${t}.`,
    authReason: "Claude perdió su sesión en esta máquina, así que no llegaron pendientes ni ideas nuevas.",
    stillShowing: (t) => `Sigues viendo el brief de las ${t}.`,
    partial: { brief: "No llegaron los pendientes de Claude; los que salen de los datos de Plania sí funcionan.", ideas: "No llegaron las ideas de hoy.", both: "No llegó la parte de Claude: estos pendientes salen de los datos de Plania.", github: "No llegaron los datos de GitHub; los PR pueden estar desactualizados." },
    keys: "J K mover · ← → proyecto · Enter primera acción · L después · X no aplica · Z deshacer",
    close: "Cerrar",
    doc: "Docs",
  },
};

export const BRIEF_LABELS: Record<BriefLanguage, BriefLabels> = { en, es };

/** The header stamp, e.g. "Fri · Nov 13 · 07:04 CDMX", in the brief's zone and language. */
export function briefStamp(iso: string, timezone: string, label: string, language: BriefLanguage): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: timezone, ...o }).format(d);
  const time = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${part({ weekday: "short" })} · ${part({ month: "short", day: "numeric" })} · ${time} ${label}`;
}

/** A history entry's label from its local date, e.g. "Thu · Nov 12" (a calendar date, so read in UTC). */
export function dayLabel(localDate: string, language: BriefLanguage): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: "UTC", ...o }).format(d);
  return `${part({ weekday: "short" })} · ${part({ month: "short", day: "numeric" })}`;
}

// ---- PLA-I63-3: the brief inside Compañía speaks La corriente's words. These override a few of the desk's words
// (the old /brief keeps its own until I63-5 retires it): «Aprobar y pasar a prueba» → Aceptar, «Pedir cambios» →
// Pedir ajuste, «Publicar a main» → Publicar, Ticket → Paso, PR en espera → Entrega.
export type CorWords = {
  verbs: Partial<Record<DeskAction, string>>;
  stamps: Partial<Record<DeskAction, string>>;
  kinds: Partial<Record<DeskKind, string>>;
  ev: Partial<DeskLabels["ev"]>;
  send: string;
};
export const COR_WORDS: Record<BriefLanguage, CorWords> = {
  es: {
    verbs: { accept_pr: "Aceptar", request_changes: "Pedir ajuste", publish: "Publicar" },
    stamps: { accept_pr: "Aceptado", request_changes: "Devuelto" },
    kinds: { ticket: "Paso", pr: "Entrega" },
    ev: { ticket: "Paso" },
    send: "Enviar nota",
  },
  en: {
    verbs: { accept_pr: "Accept", request_changes: "Ask for changes", publish: "Publish" },
    stamps: { accept_pr: "Accepted", request_changes: "Sent back" },
    kinds: { ticket: "Step", pr: "Delivery" },
    ev: { ticket: "Step" },
    send: "Send note",
  },
};

/** The brief's labels with La corriente's words laid over them. */
export function corLabels(language: BriefLanguage): BriefLabels {
  const t = BRIEF_LABELS[language];
  const w = COR_WORDS[language];
  return {
    ...t,
    d: {
      ...t.d,
      verbs: { ...t.d.verbs, ...w.verbs },
      stamps: { ...t.d.stamps, ...w.stamps },
      kinds: { ...t.d.kinds, ...w.kinds },
      ev: { ...t.d.ev, ...w.ev },
      send: w.send,
    },
  };
}
