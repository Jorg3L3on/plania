// PLA-I41-4: the Morning brief prompts and JSON schemas (spec §6). render() leaves no {{…}}; both schemas accept
// the §17 sample (checked with the small validator below: no new dependency); the owner override docs
// ("Prompt: Morning brief", "Idea persona") are appended when present and ignored when absent. The doc tests run
// on the throwaway plania_test_<hash> database (resetTestDb), never the live plania database.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { makeDb } = await import("../src/db/client.js");
const P = await import("../src/brief/prompts.js");

type Db = ReturnType<typeof makeDb>["db"];
let raw: pg.Client;
let db: Db;
let closeDb: () => Promise<void>;

before(async () => {
  raw = await resetTestDb();
  ({ db, close: closeDb } = makeDb());
});
after(async () => {
  await closeDb();
  await raw.end();
});

// ---- A small JSON Schema validator: exactly the keywords the two schemas use, and it refuses any other.
type Schema = Record<string, unknown>;
const KNOWN = new Set([
  "$schema", "title", "description", "type", "required", "additionalProperties", "properties", "items",
  "minItems", "maxItems", "enum", "minLength", "maxLength", "pattern",
]);
function keywords(s: Schema, out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(s)) {
    out.add(k);
    if (k === "properties") for (const sub of Object.values(v as Record<string, Schema>)) keywords(sub, out);
    if (k === "items") keywords(v as Schema, out);
  }
  return out;
}
function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;
}
function validate(s: Schema, v: unknown, at = "$"): string[] {
  const errs: string[] = [];
  const t = s.type as string | undefined;
  if (t && typeOf(v) !== t && !(t === "number" && typeOf(v) === "integer")) return [`${at}: expected ${t}, got ${typeOf(v)}`];
  if (s.enum && !(s.enum as unknown[]).includes(v)) errs.push(`${at}: ${JSON.stringify(v)} not in enum`);
  if (typeof v === "string") {
    const n = [...v].length;
    if (typeof s.minLength === "number" && n < s.minLength) errs.push(`${at}: shorter than ${s.minLength}`);
    if (typeof s.maxLength === "number" && n > s.maxLength) errs.push(`${at}: longer than ${s.maxLength}`);
    if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(v)) errs.push(`${at}: does not match ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems) errs.push(`${at}: fewer than ${s.minItems} items`);
    if (typeof s.maxItems === "number" && v.length > s.maxItems) errs.push(`${at}: more than ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => errs.push(...validate(s.items as Schema, x, `${at}[${i}]`)));
  }
  if (typeOf(v) === "object") {
    const o = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const k of (s.required as string[] | undefined) ?? []) if (!(k in o)) errs.push(`${at}: missing ${k}`);
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) errs.push(...validate(props[k], x, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}: unexpected ${k}`);
    }
  }
  return errs;
}

// ---- Spec §17: the sample BriefData (the merged result). The passes return it without the fields the server
// adds in merge.ts: item id; idea id, code and source.
const SAMPLE = {
  "version": 1,
  "generatedAt": "2026-11-13T07:04:12-06:00",
  "timezone": "America/Mexico_City",
  "timezoneLabel": "CDMX",
  "window": {
    "from": "2026-11-12T18:00:00-06:00",
    "to": "2026-11-13T07:04:12-06:00"
  },
  "reply": {
    "prefix": "yes",
    "destination": "Plania"
  },
  "mode": "full",
  "language": "en",
  "sources": [
    {
      "name": "plania",
      "ok": true
    },
    {
      "name": "github",
      "ok": true
    },
    {
      "name": "claude_brief",
      "ok": true
    },
    {
      "name": "claude_ideas",
      "ok": true
    }
  ],
  "apps": [
    {
      "id": "workia",
      "name": "Workia",
      "color": "c0"
    },
    {
      "id": "zigzag",
      "name": "ZigZag",
      "color": "c1"
    },
    {
      "id": "filmia",
      "name": "Filmia",
      "color": "c2"
    },
    {
      "id": "micasa",
      "name": "MiCasa",
      "color": "c3"
    },
    {
      "id": "cross",
      "name": "Cross-app",
      "color": "other"
    }
  ],
  "items": [
    {
      "id": "i|filmia|952a4f17d8ec",
      "app": "filmia",
      "status": "needs_you",
      "ref": "FIL-I50-6 · FIL-I51 · #238",
      "title": "Close Juegos after the iPhone check; Quiniela data comes later",
      "detail": "Extras (La tanda) and the Quinielas went to prod with #238 at 11:11 PM CDMX. FIL-I50-6 (your iPhone test) is the last open ticket on FIL-I50.",
      "url": "https://github.com/Jorg3L3on/filmia/pull/238",
      "action": "Review"
    },
    {
      "id": "i|filmia|f3b3e5963587",
      "app": "filmia",
      "status": "needs_you",
      "ref": "FIL prod record",
      "title": "Filmia prod record in Plania is stale",
      "detail": "Prod moved again last night (#238). Plania still says prod is 1fb7188 from Oct 29, migrations through 0024. Confirm 0027, 0029, 0031 and 0032 in prod and update the record.",
      "action": "Decide"
    },
    {
      "id": "i|micasa|6733290c4106",
      "app": "micasa",
      "status": "needs_you",
      "ref": "#345 · MIC-I16",
      "title": "Release sandbox to main (programados kit)",
      "detail": "Sandbox is 10 commits ahead of main and main is 6 ahead, so a fast-forward fails. Check Neon first.",
      "url": "https://github.com/Jorg3L3on/micasa/compare/main...sandbox",
      "action": "Open compare"
    },
    {
      "id": "i|workia|b05508d1c5df",
      "app": "workia",
      "status": "needs_you",
      "ref": "WRK-I14 · WRK-I15",
      "title": "Release sandbox to main after the legal check",
      "detail": "Sandbox is 9 commits ahead of main and main is 2 merge commits ahead. Prod is on migration 0027, so the release brings 0028 and 0029.",
      "url": "https://github.com/Jorg3L3on/workia/compare/main...sandbox",
      "action": "Open compare"
    },
    {
      "id": "i|filmia|2476a1071b2c",
      "app": "filmia",
      "status": "open_pr",
      "ref": "#235",
      "title": "Dependabot npm minor/patch bump",
      "detail": "Open into sandbox since Nov 12 at 9:56 AM CDMX. Low priority.",
      "url": "https://github.com/Jorg3L3on/filmia/pull/235",
      "action": "Open PR"
    },
    {
      "id": "i|workia|47b742667fa9",
      "app": "workia",
      "status": "next",
      "ref": "WRK-13",
      "title": "Fix expediente crash on contracts with pay",
      "detail": "Next claimable Workia ticket. Issuing a contract with salary fields blanks the person page."
    },
    {
      "id": "i|cross|f87f1294395c",
      "app": "cross",
      "status": "needs_you",
      "ref": "#94 · #95 · PLA-12 · PLA-13",
      "title": "Close the leftover merge-gate PRs",
      "detail": "PLA-19 already shipped the same fix in #99. #94 and #95 are still open and both tickets are still In review.",
      "url": "https://github.com/Jorg3L3on/plania/pull/94",
      "action": "Review"
    }
  ],
  "ideas": [
    {
      "id": "d|workia|f3ceac25381f",
      "code": "W1",
      "app": "workia",
      "title": "Renewal board",
      "why": "Every contract ending in the next 30 days on one board, with batch renew or end. Dozens fall due the same weeks at a multi-branch store.",
      "source": "Workia"
    },
    {
      "id": "d|zigzag|11d5e0e86475",
      "code": "Z1",
      "app": "zigzag",
      "title": "Privacy and terms pack",
      "why": "Privacy notice, terms, and export or delete one end customer's data on request. It's legally required, and buyers will ask.",
      "source": "ZigZag",
      "flags": [
        "legal"
      ]
    },
    {
      "id": "d|zigzag|00e15e4bc3f7",
      "code": "Z2",
      "app": "zigzag",
      "title": "Late-payer flag",
      "why": "Mark customers who usually pay late and show it when a new quote opens, so the shop can ask for an advance.",
      "source": "ZigZag"
    },
    {
      "id": "d|filmia|0b4dbcd96ba2",
      "code": "F1",
      "app": "filmia",
      "title": "Taste map",
      "why": "Map everything watched by country, decade and genre, and point out blind spots with three starter picks.",
      "source": "Filmia"
    },
    {
      "id": "d|filmia|2608d694a946",
      "code": "F2",
      "app": "filmia",
      "title": "Affiliate rent/buy links",
      "why": "Where to rent or buy each title, through free affiliate programs. A first zero-cost revenue stream.",
      "source": "Filmia",
      "flags": [
        "outside_service"
      ]
    },
    {
      "id": "d|micasa|001c1ce8a921",
      "code": "M1",
      "app": "micasa",
      "title": "What-if sandbox",
      "why": "Simulate a big decision on a household copy and see the next 6 to 12 quincenas next to the real ones, using the existing forecast.",
      "source": "MiCasa"
    },
    {
      "id": "d|cross|6211b038eea4",
      "code": "X1",
      "app": "cross",
      "title": "Local fallback lane for builds",
      "why": "When cloud agent usage runs out, Ready tickets go to the local runner with a token cap, so night work keeps moving at $0.",
      "source": "Plania",
      "flags": [
        "big"
      ]
    }
  ]
};
const passA = { items: SAMPLE.items.map(({ id: _id, ...rest }) => rest) };
const passB = { ideas: SAMPLE.ideas.map(({ id: _id, code: _c, source: _s, ...rest }) => rest) };

const VARS = {
  ownerName: "the owner",
  language: "en",
  timezone: "America/Mexico_City",
  timezoneLabel: "CDMX",
  hiddenRefs: ["PLA-I16"],
  projects: [
    { id: "workia", name: "Workia", keyPrefix: "WRK", repoPath: "/repos/workia", githubRepo: "owner/workia" },
    { id: "filmia", name: "Filmia", keyPrefix: "FIL", repoPath: "/repos/filmia", githubRepo: "owner/filmia" },
    { id: "micasa", name: "MiCasa", keyPrefix: "MIC", repoPath: null, githubRepo: null },
  ],
  localDate: "2026-11-13",
  windowStart: "2026-11-12T18:00:00-06:00",
  now: "2026-11-13T07:04:12-06:00",
  factsPath: "/tmp/_brief/2026-11-13/facts.json",
  maxItemsPerApp: 6,
  ideasPerProject: "2 or 3",
};
const LEFTOVER = /\{\{[^}]*\}\}/;

test("render fills every placeholder in one pass and refuses a missing one", () => {
  assert.equal(P.render("a {{X}} b {{Y}} {{X}}", { X: "1", Y: "{{X}}" }), "a 1 b {{X}} 1");
  assert.throws(() => P.render("{{X}} {{Z}}", { X: "1" }), /no value for \{\{Z\}\}/);
});

test("every prompt file renders with no {{…}} left", () => {
  const system = P.systemPrompt(VARS);
  const brief = P.briefPrompt(VARS);
  const ideas = P.ideasPrompt({ ideasPerProject: VARS.ideasPerProject, personas: [] });
  const po = P.poPlanIdeasPrompt({
    briefDate: "2026-11-13",
    requestId: "req-1",
    projectSlug: "workia",
    ideas: SAMPLE.ideas.filter((i) => i.app === "workia"),
  });
  for (const [name, text] of Object.entries({ system, brief, ideas, po })) {
    assert.doesNotMatch(text, LEFTOVER, `${name} still has a placeholder`);
  }
  // Every file has placeholders, so the check above means something.
  for (const f of P.PROMPT_FILES) assert.ok(P.placeholders(P.readPrompt(f)).length > 0, f);
  assert.match(system, /Output language: English\./);
  assert.match(system, /11:11 PM CDMX/);
  assert.match(system, /hidden list: PLA-I16\./);
  assert.match(system, /^ {2}workia \| Workia \| WRK \| \/repos\/workia \| owner\/workia$/m);
  assert.match(system, /^ {2}micasa \| MiCasa \| MIC \| no repo \| no GitHub repo$/m);
  assert.match(brief, /Read \/tmp\/_brief\/2026-11-13\/facts\.json first\./);
  assert.match(brief, /At most 6 items per app/);
  assert.match(ideas, /Propose 2 or 3 ideas\./);
  assert.match(po, /### W1: Renewal board/);
  assert.match(po, /brief-plan:req-1:W1:idea/);
  assert.match(P.systemPrompt({ ...VARS, language: "es", hiddenRefs: [] }), /Output language: Spanish\..*\n[\s\S]*hidden list: \(none\)\./);
});

test("pass A never mentions thread_read; the PO message may, but does not need to", () => {
  assert.doesNotMatch(P.readPrompt("brief.md"), /thread_read/);
  assert.doesNotMatch(P.readPrompt("system.md"), /thread_read/);
  assert.doesNotMatch(P.readPrompt("ideas.md"), /thread_read/);
});

test("the prompts stay generic: no owner name, city or real project", () => {
  for (const f of P.PROMPT_FILES) {
    assert.doesNotMatch(P.readPrompt(f), /Jorge|CDMX|Workia|Filmia|MiCasa|ZigZag|Jorg3L3on/, f);
  }
});

test("both schemas are valid JSON with only known keywords", () => {
  for (const pass of ["brief", "ideas"] as const) {
    const s = P.readSchema(pass);
    const unknown = [...keywords(s)].filter((k) => !KNOWN.has(k));
    assert.deepEqual(unknown, [], pass);
    assert.equal(s.additionalProperties, false);
  }
});

test("both schemas accept the §17 sample", () => {
  assert.deepEqual(validate(P.readSchema("brief"), passA), []);
  assert.deepEqual(validate(P.readSchema("ideas"), passB), []);
  assert.equal(passA.items.length, 7);
  assert.equal(passB.ideas.length, 7);
});

test("the schemas refuse what the merge must never see", () => {
  const brief = P.readSchema("brief");
  const ideas = P.readSchema("ideas");
  const item = passA.items[0]!;
  assert.notDeepEqual(validate(brief, { items: [{ ...item, status: "done" }] }), []);
  assert.notDeepEqual(validate(brief, { items: [{ ...item, url: "javascript:alert(1)" }] }), []);
  assert.notDeepEqual(validate(brief, { items: [{ ...item, id: "i|x|y" }] }), []);
  assert.notDeepEqual(validate(brief, { items: [{ ...item, title: "x".repeat(91) }] }), []);
  assert.notDeepEqual(validate(brief, {}), []);
  assert.notDeepEqual(validate(ideas, { ideas: [] }), []);
  assert.notDeepEqual(validate(ideas, { ideas: [{ ...passB.ideas[0]!, flags: ["paid"] }] }), []);
  assert.deepEqual(validate(ideas, { ideas: [{ ...passB.ideas[0]!, flags: ["overlap:WRK-I14", "cost"] }] }), []);
});

test("override docs are appended when present and ignored when absent", async () => {
  const { rows: projects } = await raw.query<{ id: string; slug: string }>(
    "insert into projects (slug, title, key_prefix) values ('plania', 'Plania', 'PLA') returning id, slug",
  );
  const plania = projects[0]!.id;
  const env = { PLANIA_PROMPTS_PROJECT: "plania" } as NodeJS.ProcessEnv;
  const actor = JSON.stringify({ agent: "test", session_id: "t" });

  // Absent: system.md alone, the "no persona" line in pass B.
  assert.equal(await P.loadSystemOverride(db, env), null);
  const bare = await P.loadPassPrompts(db, "ideas", VARS, env);
  assert.equal(bare.system, P.systemPrompt(VARS));
  assert.doesNotMatch(bare.system, /Owner additions/);
  assert.match(bare.prompt, /No project has a persona/);

  // Present: the override is appended after system.md; each persona lands under its project.
  await raw.query("insert into docs (project_id, title, markdown, actor) values ($1, $2, $3, $4)", [
    plania, "Prompt: Morning brief", "Always list release steps first.", actor,
  ]);
  await raw.query(
    `insert into docs (project_id, title, markdown, actor)
       select id, 'Idea persona', $1, $2 from projects where slug = 'workia'`,
    ["You are the product owner of a staffing app.\nThink about {{RENEWALS}}.", actor],
  );
  // A persona on a project outside the brief is ignored.
  await raw.query(
    `insert into docs (project_id, title, markdown, actor)
       select id, 'Idea persona', 'Not in scope.', $1 from projects where slug = 'zigzag'`,
    [actor],
  );
  const full = await P.loadPassPrompts(db, "ideas", VARS, env);
  assert.ok(full.system.startsWith(P.systemPrompt(VARS).trimEnd()));
  assert.match(full.system, /Owner additions \(from the Plania doc "Prompt: Morning brief"\)\nAlways list release steps first\.\n$/);
  assert.match(full.prompt, /^ {3}- workia \(Workia\):\n {5}You are the product owner of a staffing app\.\n {5}Think about \{\{RENEWALS\}\}\.$/m);
  assert.doesNotMatch(full.prompt, /No project has a persona|Not in scope|filmia \(Filmia\)/);
  const brief = await P.loadPassPrompts(db, "brief", VARS, env);
  assert.match(brief.system, /Always list release steps first/);
  assert.doesNotMatch(brief.prompt, /\{\{|persona/);

  // The override belongs to the prompts project only: another prompts project sees none.
  assert.equal(await P.loadSystemOverride(db, { PLANIA_PROMPTS_PROJECT: "micasa" } as NodeJS.ProcessEnv), null);
  // An empty doc is the same as none.
  await raw.query("update docs set markdown = '  ' where title = 'Prompt: Morning brief'");
  assert.equal(await P.loadSystemOverride(db, env), null);
});

// PLA-I44-2: claude 2.1.302 refuses a --json-schema whose "$schema" is draft 2020-12 (the pass ends with exit 1, no
// turn). The text sent to claude leaves the key out; the file and readSchema keep it, and nothing else changes.
test("the --json-schema text has no $schema key, everything else as in the file", () => {
  for (const pass of ["brief", "ideas"] as const) {
    const text = P.readSchemaText(pass);
    assert.doesNotMatch(text, /\$schema|json-schema\.org/, pass);
    const { $schema: _draft, ...rest } = P.readSchema(pass);
    assert.deepEqual(JSON.parse(text), rest, pass);
  }
});
