// PLA-I8-2: human-only gates, the screen code, and gate C before an initiative becomes Active.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type pg from "pg";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, randomSecret, totp } from "../src/gate/totp.js";
import { keychainReadArgs, keychainWriteInvocation } from "../src/gate/store.js";
import { GATE_ENROLL_STEP, questionMarkLabels } from "../ui/src/lib/inbox.js";
import { summarize } from "../src/mcp/summary.js";
import { resetTestDb, useTestEnv } from "./helpers.js";

useTestEnv();
const { app } = await import("../src/app.js");
const { createSession, SESSION_COOKIE } = await import("../src/auth/session.js");
const { hashPassword } = await import("../src/auth/password.js");
const { makeDb } = await import("../src/db/client.js");
const { createMcpServer } = await import("../src/mcp/register.js");
const { createGateChallenge } = await import("../src/gate/challenge.js");
const { MemoryGateSecretStore, useGateStore } = await import("../src/gate/store.js");
const { gateClock } = await import("../src/gate/totp.js");
const { ToolError } = await import("../src/mcp/errors.js");

type Json = Record<string, any>;

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
// RFC 6238 Appendix B, SHA-1, 8 digits, and the 6-digit codes this server checks.
const RFC_VECTORS: { time: number; digits8: string; digits6: string }[] = [
  { time: 59, digits8: "94287082", digits6: "287082" },
  { time: 1111111109, digits8: "07081804", digits6: "081804" },
  { time: 1111111111, digits8: "14050471", digits6: "050471" },
  { time: 1234567890, digits8: "89005924", digits6: "005924" },
  { time: 2000000000, digits8: "69279037", digits6: "279037" },
  { time: 20000000000, digits8: "65353130", digits6: "353130" },
];

test("RFC 6238 SHA-1 vectors, 8 digits and 6", () => {
  for (const v of RFC_VECTORS) {
    const counter = BigInt(Math.floor(v.time / 30));
    assert.equal(hotp(RFC_SECRET, counter, 8), v.digits8, `8 digits at ${v.time}`);
    assert.equal(totp(RFC_SECRET, v.time * 1000), v.digits6, `6 digits at ${v.time}`);
    assert.equal(matchTotp(RFC_SECRET, v.digits6, v.time * 1000), Number(counter));
  }
});

test("the verifier accepts one step of clock skew and rejects two", () => {
  const at = 1_111_111_111_000;
  const step = Math.floor(at / 1000 / 30);
  assert.equal(matchTotp(RFC_SECRET, totp(RFC_SECRET, at), at), step);
  assert.equal(matchTotp(RFC_SECRET, totp(RFC_SECRET, at - 30_000), at), step - 1);
  assert.equal(matchTotp(RFC_SECRET, totp(RFC_SECRET, at + 30_000), at), step + 1);
  assert.equal(matchTotp(RFC_SECRET, totp(RFC_SECRET, at - 60_000), at), null);
  assert.equal(matchTotp(RFC_SECRET, totp(RFC_SECRET, at + 60_000), at), null);
  assert.equal(matchTotp(RFC_SECRET, "12345", at), null);
  assert.equal(matchTotp(RFC_SECRET, "00000a", at), null);
});

test("base32 round-trips and the otpauth URI names the product, not a person", () => {
  assert.equal(base32Encode(RFC_SECRET), RFC_BASE32);
  const fresh = randomSecret();
  assert.equal(fresh.length, 20);
  assert.deepEqual(base32Decode(base32Encode(fresh)), fresh);
  const uri = otpauthUri(RFC_BASE32);
  assert.equal(uri.includes("@"), false);
  assert.match(uri, /^otpauth:\/\/totp\/Plania%3Agates\?/);
  assert.match(uri, new RegExp(`secret=${RFC_BASE32}`));
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

test("the keychain invocation keeps the secret off argv", () => {
  const plan = keychainWriteInvocation(RFC_BASE32);
  assert.equal(plan.file, "security");
  assert.deepEqual(plan.args, ["-i"]);
  assert.equal(JSON.stringify(plan.args).includes(RFC_BASE32), false);
  assert.equal(plan.stdin, `add-generic-password -U -T /usr/bin/security -s plania-gate -a plania -w\n${RFC_BASE32}\n`);
  const read = keychainReadArgs();
  assert.deepEqual(read, ["find-generic-password", "-s", "plania-gate", "-a", "plania", "-w"]);
  assert.equal(read.join(" ").includes(RFC_BASE32), false);
});

test("a question card labels the gate and Solo tú", () => {
  assert.deepEqual(questionMarkLabels("A", true), ["Compuerta A", "Solo tú"]);
  assert.deepEqual(questionMarkLabels("B", true), ["Compuerta B", "Solo tú"]);
  assert.deepEqual(questionMarkLabels("C", true), ["Compuerta C", "Solo tú"]);
  assert.deepEqual(questionMarkLabels(null, false), []);
  assert.deepEqual(questionMarkLabels("nope", true), ["Solo tú"]);
  const resume = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/resume.tsx"), "utf8");
  const home = readFileSync(path.resolve(import.meta.dirname, "../ui/src/components/home/te-toca.tsx"), "utf8");
  for (const source of [resume, home]) {
    assert.match(source, /QuestionMarks/);
    assert.match(source, /GATE_ENROLL_STEP/);
  }
  assert.match(GATE_ENROLL_STEP, /Bandeja, sección Compuertas/);
  assert.match(GATE_ENROLL_STEP, /base32/);
  assert.match(GATE_ENROLL_STEP, /otpauth/);
  const line = summarize({
    type: "gate.code.rejected",
    task_key: "WRK-01",
    actor: { agent: "jorge", session_id: "web", machine: "screen" },
    payload: { reason: "invalid", nonce: "nonce-only" },
  });
  assert.match(line, /invalid/);
  assert.equal(line.includes("287082"), false);
});

const A = { agent: "test-agent", session_id: "s1", machine: "ci" };
const P = { project: "workia" };
const PASSWORD = "test-password-123";

let client: Client;
let raw: pg.Client;
let cookie: string;
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let tick = 1_600_000_000_000;
let secret: Buffer = Buffer.alloc(0);
let secretB32 = "";
let openGate: { key: string; id: string } | null = null;
const seenCodes: string[] = [];

function req(method: string, url: string, opts: { body?: unknown; cookie?: string | null } = {}) {
  const headers: Record<string, string> = {};
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.Cookie = c;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function call(name: string, args: Json = {}): Promise<Json> {
  const r = (await client.callTool({ name, arguments: { actor: A, ...P, ...args } })) as { isError?: boolean; content: { text: string }[] };
  const data = JSON.parse(r.content[0]!.text) as Json;
  return r.isError ? { __error: data.error, __status: data.status, ...data } : data;
}

async function setStatus(key: string, status: string) {
  const version = (await call("get_task", { key })).version;
  return call("set_task", { key, status, version });
}

function bump() {
  tick += 31_000;
}

async function challenge(questionId: string, option: string) {
  const res = await req("POST", `/api/projects/workia/questions/${questionId}/challenge`, { body: { option } });
  return { status: res.status, body: (await res.json()) as Json };
}

async function answerScreen(questionId: string, option: string, code: string, nonce?: string) {
  let used = nonce;
  if (!used) {
    const ch = await challenge(questionId, option);
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    used = ch.body.nonce as string;
  }
  seenCodes.push(code);
  const res = await req("POST", `/api/projects/workia/questions/${questionId}/answer`, { body: { answer: option, nonce: used, code } });
  return { status: res.status, body: (await res.json()) as Json, nonce: used };
}

async function answerFresh(questionId: string, option: string) {
  bump();
  return answerScreen(questionId, option, totp(secret, tick));
}

function leaves(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) leaves(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) leaves(item, out);
  else if (typeof value === "string" || typeof value === "number") out.push(String(value));
  return out;
}

describe("screen gates", () => {
  before(async () => {
    process.env.PLANIA_PASSWORD_HASH = await hashPassword(PASSWORD);
    raw = await resetTestDb();
    cookie = `${SESSION_COOKIE}=${createSession()}`;
    const mem = new MemoryGateSecretStore();
    useGateStore(mem);
    gateClock.now = () => tick;
    db = makeDb().db;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(db).connect(serverSide);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
  });

  after(async () => {
    gateClock.now = () => Date.now();
    await client?.close();
    await raw?.end();
  });

  test("migration 0027 applies twice and adds gate_challenges", async () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../drizzle/migrations/0027_gate_challenges.sql"), "utf8");
    await raw.query(sql);
    await raw.query(sql);
    const { rows } = await raw.query(
      "select column_name from information_schema.columns where table_name = 'gate_challenges' order by column_name",
    );
    assert.deepEqual(rows.map((r) => r.column_name), [
      "attempts", "created_at", "expires_at", "id", "nonce", "option", "question_id", "state", "totp_step", "used_at",
    ]);
  });

  test("a question that is not a gate is still answered by an agent", async () => {
    const ticket = await call("create_task", { title: "Color", scope: "s", checks: ["c"] });
    assert.equal(ticket.__error, undefined);
    const asked = await call("ask", { key: ticket.key, question: "¿Color?", options: ["azul"] });
    assert.equal(asked.question.human_only, false);
    assert.equal(asked.question.gate, null);
    const answered = await call("answer", { question_id: asked.question.id, answer: "azul" });
    assert.equal(answered.__error, undefined);
    const row = (await raw.query("select answer, answered_by from questions where id = $1", [asked.question.id])).rows[0];
    assert.equal(row.answer, "azul");
    assert.equal(row.answered_by.agent, "test-agent");
  });

  test("a gate answered by MCP is HUMAN_ONLY, and the screen cannot answer before enrolment", async () => {
    const idea = await call("create_task", { kind: "idea", title: "Puerta" });
    const asked = await call("ask", { key: idea.key, gate: "A", question: "¿La seguimos?" });
    assert.equal(asked.__error, undefined);
    assert.equal(asked.question.human_only, true);
    assert.deepEqual(asked.question.options, ["pursue", "drop", "later"]);
    const refused = await call("answer", { question_id: asked.question.id, answer: "pursue" });
    assert.equal(refused.__error, "HUMAN_ONLY");
    assert.equal(refused.__status, 403);
    let thrown: unknown;
    try {
      await createGateChallenge(db, "workia", asked.question.id, "pursue", { actor: A });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ToolError);
    if (!(thrown instanceof ToolError)) return;
    assert.equal(thrown.code, "HUMAN_ONLY");
    const ch = await challenge(asked.question.id, "pursue");
    assert.equal(ch.status, 409);
    assert.equal(ch.body.error, "GATE_CODE_NOT_ENROLLED");
    const bare = await req("POST", `/api/projects/workia/questions/${asked.question.id}/answer`, { body: { answer: "pursue" } });
    const bareBody = (await bare.json()) as Json;
    assert.equal(bare.status, 409);
    assert.equal(bareBody.error, "GATE_CODE_NOT_ENROLLED");
    const still = (await raw.query("select answer from questions where id = $1", [asked.question.id])).rows[0];
    assert.equal(still.answer, null);
    openGate = { key: idea.key, id: asked.question.id };
    const inbox = await call("get_inbox", { project: "workia" });
    const item = inbox.items.find((i: Json) => i.id === asked.question.id);
    assert.equal(item.gate, "A");
    assert.equal(item.human_only, true);
  });

  test("enrolment needs the cookie and the current password, and shows the secret once", async () => {
    assert.equal((await req("GET", "/api/gate")).status, 200);
    assert.deepEqual(await (await req("GET", "/api/gate")).json(), { enrolled: false });
    const noCookie = await req("POST", "/api/gate/enroll", { cookie: null, body: { password: PASSWORD } });
    assert.equal(noCookie.status, 401);
    const wrong = await req("POST", "/api/gate/enroll", { body: { password: "not-the-password" } });
    assert.equal(wrong.status, 401);
    assert.equal(((await wrong.json()) as Json).error, "INVALID_PASSWORD");
    const good = await req("POST", "/api/gate/enroll", { body: { password: PASSWORD } });
    assert.equal(good.status, 200);
    const body = (await good.json()) as Json;
    assert.match(body.secret_base32, /^[A-Z2-7]+$/);
    assert.match(body.otpauth_uri, /^otpauth:\/\/totp\/Plania%3Agates\?/);
    assert.equal(String(body.otpauth_uri).includes("@"), false);
    secretB32 = body.secret_base32;
    secret = base32Decode(secretB32);
    assert.deepEqual(await (await req("GET", "/api/gate")).json(), { enrolled: true });
    const again = await req("GET", "/api/gate");
    assert.equal(JSON.stringify(await again.json()).includes(secretB32), false);
  });

  test("the screen accepts the code and records answered_by jorge", async () => {
    const askedId = openGate!.id;
    const out = await answerFresh(askedId, "pursue");
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.question.answer, "pursue");
    assert.equal(out.body.question.answered_by.agent, "jorge");
    assert.equal(out.body.question.answered_by.session_id, "web");
    const events = (await raw.query(
      "select type, payload, actor from events where task_key = $1 and type like 'gate.%' order by id",
      [openGate!.key],
    )).rows;
    assert.deepEqual(events.map((e) => e.type), ["gate.code.rejected", "gate.challenge.created", "gate.answered"]);
    assert.equal(events[2].actor.agent, "jorge");
    assert.equal(events[2].payload.option, "pursue");
    const row = (await raw.query("select answered_by from questions where id = $1", [askedId])).rows[0];
    assert.equal(row.answered_by.agent, "jorge");
  });

  test("a wrong code, a mismatched option, a replay, an expiry and a lock do not answer", async () => {
    async function askGate(title: string, gate: "A" | "B" | "C", question: string) {
      const idea = await call("create_task", { kind: "idea", title });
      const asked = await call("ask", { key: idea.key, gate, question });
      assert.equal(asked.__error, undefined);
      return asked.question as Json;
    }

    const wrongQ = await askGate("Mal", "A", "¿Mal?");
    bump();
    const wrong = await answerScreen(wrongQ.id, "drop", "000000");
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error, "GATE_CODE_INVALID");
    assert.equal(wrong.body.reason, "invalid");
    const open = (await raw.query("select answer from questions where id = $1", [wrongQ.id])).rows[0];
    assert.equal(open.answer, null);

    const mismatch = await answerScreen(wrongQ.id, "pursue", totp(secret, tick), wrong.nonce);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error, "GATE_CODE_INVALID");
    assert.equal(mismatch.body.reason, "mismatch");

    const first = await askGate("Una", "A", "¿Una?");
    const second = await askGate("Dos", "A", "¿Dos?");
    bump();
    const code = totp(secret, tick);
    const ok = await answerScreen(first.id, "later", code);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const replay = await answerScreen(second.id, "later", code);
    assert.equal(replay.status, 403);
    assert.equal(replay.body.error, "GATE_CODE_INVALID");
    assert.equal(replay.body.reason, "replay");

    const stale = await askGate("Caduca", "A", "¿Caduca?");
    const opened = await challenge(stale.id, "drop");
    assert.equal(opened.status, 200);
    tick += 121_000;
    const expired = await answerScreen(stale.id, "drop", totp(secret, tick), opened.body.nonce);
    assert.equal(expired.status, 409);
    assert.equal(expired.body.error, "GATE_CODE_EXPIRED");
    const expiredRow = (await raw.query("select state from gate_challenges where nonce = $1", [opened.body.nonce])).rows[0];
    assert.equal(expiredRow.state, "expired");

    const lockedQ = await askGate("Cierre", "A", "¿Cierre?");
    const ch = await challenge(lockedQ.id, "drop");
    for (const codeTry of ["111111", "222222"]) {
      const attempt = await answerScreen(lockedQ.id, "drop", codeTry, ch.body.nonce);
      assert.equal(attempt.body.error, "GATE_CODE_INVALID");
    }
    const third = await answerScreen(lockedQ.id, "drop", "333333", ch.body.nonce);
    assert.equal(third.status, 409);
    assert.equal(third.body.error, "GATE_CHALLENGE_LOCKED");
    const fourth = await answerScreen(lockedQ.id, "drop", "444444", ch.body.nonce);
    assert.equal(fourth.body.error, "GATE_CHALLENGE_LOCKED");
    const lockedRow = (await raw.query("select state, attempts from gate_challenges where nonce = $1", [ch.body.nonce])).rows[0];
    assert.equal(lockedRow.state, "locked");
    assert.equal(lockedRow.attempts, 3);
  });

  test("a human_only question that is not a gate also needs the screen code", async () => {
    const ticket = await call("create_task", { title: "Solo", scope: "s", checks: ["c"] });
    const asked = await call("ask", { key: ticket.key, question: "¿Sigues tú?", human_only: true });
    assert.equal(asked.question.gate, null);
    assert.equal(asked.question.human_only, true);
    assert.equal((await call("answer", { question_id: asked.question.id, answer: "sí" })).__error, "HUMAN_ONLY");
    const out = await answerFresh(asked.question.id, "sí");
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.question.answered_by.agent, "jorge");
  });

  test("re-enrolling needs the password again and replaces the secret", async () => {
    const wrong = await req("POST", "/api/gate/enroll", { body: { password: "still-wrong" } });
    assert.equal(wrong.status, 401);
    const kept = totp(secret, tick);
    const next = await req("POST", "/api/gate/enroll", { body: { password: PASSWORD } });
    const body = (await next.json()) as Json;
    assert.equal(next.status, 200);
    assert.notEqual(body.secret_base32, secretB32);
    secretB32 = body.secret_base32;
    secret = base32Decode(secretB32);
    assert.notEqual(totp(secret, tick), kept);
    const idea = await call("create_task", { kind: "idea", title: "Nuevo secreto" });
    const asked = await call("ask", { key: idea.key, gate: "A", question: "¿Con el nuevo?" });
    const out = await answerFresh(asked.question.id, "pursue");
    assert.equal(out.status, 200, JSON.stringify(out.body));
  });

  test("a promoted initiative cannot become Active until gate C is answered on the screen", async () => {
    const initiative = await call("create_task", { kind: "initiative", title: "Linea", scope: "PRD" });
    const plain = await call("create_task", { kind: "initiative", title: "Sin puerta", scope: "PRD" });
    const legacyInit = await call("create_task", { kind: "initiative", title: "Vieja", scope: "PRD" });
    const idea = await call("create_task", { kind: "idea", title: "Promovida" });
    const untouched = await call("create_task", { kind: "idea", title: "Sin compuerta C" });
    const legacyIdea = await call("create_task", { kind: "idea", title: "Fila vieja" });
    await raw.query("update tasks set stage = 'planning', promoted_to = $1 where key = $2", [initiative.key, idea.key]);
    await raw.query("update tasks set stage = 'planning', promoted_to = $1 where key = $2", [plain.key, untouched.key]);
    await raw.query("update tasks set stage = 'planning', promoted_to = $1 where key = $2", [legacyInit.key, legacyIdea.key]);

    const gate = await call("ask", { key: idea.key, gate: "C", question: "¿Lista?" });
    const blocked = await setStatus(initiative.key, "Active");
    assert.equal(blocked.__error, "GATE_NOT_PASSED");
    assert.equal(blocked.__status, 409);
    assert.equal(blocked.gate, "C");
    assert.equal(blocked.from, "Planning");
    assert.equal(blocked.to, "Active");
    assert.equal(blocked.idea, idea.key);
    const parked = await setStatus(initiative.key, "On hold");
    assert.equal(parked.__error, undefined);
    const bypass = await setStatus(initiative.key, "Active");
    assert.equal(bypass.__error, "GATE_NOT_PASSED");
    assert.equal(bypass.from, "On hold");

    const answered = await answerFresh(gate.question.id, "ready");
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.equal(answered.body.question.answered_by.agent, "jorge");
    const active = await setStatus(initiative.key, "Active");
    assert.equal(active.__error, undefined, JSON.stringify(active));
    assert.equal(active.status, "Active");

    const free = await setStatus(plain.key, "Active");
    assert.equal(free.__error, undefined, "an initiative with no gate C question is unchanged");
    assert.equal(free.status, "Active");

    const ids = (await raw.query(
      "select t.id as task_id, t.project_id from tasks t join projects p on p.id = t.project_id where p.slug = 'workia' and t.key = $1",
      [legacyIdea.key],
    )).rows[0];
    const inserted = await raw.query(
      `insert into questions (project_id, task_id, question, options, gate, human_only, asked_by)
       values ($1, $2, 'Fila anterior', $3, 'C', false, $4::jsonb) returning id`,
      [ids.project_id, ids.task_id, ["ready", "rework", "drop"], JSON.stringify(A)],
    );
    const legacyId = inserted.rows[0].id as string;
    const byAgent = await call("answer", { question_id: legacyId, answer: "ready" });
    assert.equal(byAgent.__error, undefined, "a gate row that was not human_only stays answerable by an agent");
    const who = (await raw.query("select answered_by from questions where id = $1", [legacyId])).rows[0];
    assert.equal(who.answered_by.agent, "test-agent");
    const legacyActive = await setStatus(legacyInit.key, "Active");
    assert.equal(legacyActive.__error, undefined);
    assert.equal(legacyActive.status, "Active");
  });

  test("events and challenge rows never store the code or the secret", async () => {
    const { rows } = await raw.query("select payload from events");
    const found = rows.flatMap((r) => leaves(r.payload));
    assert.equal(found.some((v) => v.includes(secretB32)), false);
    for (const code of seenCodes) assert.equal(found.includes(code), false, `code leaked: ${code}`);
    const challenges = await raw.query("select nonce, option, state, totp_step::text as step from gate_challenges");
    const blob = JSON.stringify(challenges.rows);
    assert.equal(blob.includes(secretB32), false);
    for (const code of seenCodes) assert.equal(blob.includes(`"${code}"`), false);
  });
});
