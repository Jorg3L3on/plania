// PLA-I57-1: Preguntar en Pedir. The owner asks something about a project and gets an answer, with nothing created:
// no idea, no ticket, nothing in the tube or on the board.
//   askConsulta     keeps the question (consultas) and queues the project's PO for a read-only run. The run's summary
//                   carries «[pregunta] [consulta <id>]»: the runner then works in the project's own checkout under
//                   CONSULTA_DENY_RULES, skips skill packs and does not keep the session (src/runner/runner.ts).
//   retryConsultas  a PO that was busy when the question came gets it queued again on the next heartbeat tick.
//   answerConsulta  the PO's answer (MCP answer_consulta): short answer, why, file sources, branch and commit, how sure,
//                   and the fix as request text when there is something to fix.
//   listConsultas   the project's questions for the side page, each with its state and what the PO read so far
//                   (from the run's stream log).
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentRuns, agents, consultas, projects, type Agent, type Consulta, type ConsultaAnswer } from "../db/schema.js";
import { ToolError } from "../mcp/errors.js";
import { PREGUNTA_MARK } from "../captures/preguntas.js";
import { enqueueWake } from "../runner/events.js";
import { isSessionOf } from "../runner/run-session.js";

export const CONSULTA_RE = /\[consulta ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/;
export const consultaIdOf = (summary: string | null | undefined): string | null => CONSULTA_RE.exec(summary ?? "")?.[1] ?? null;
export const consultaReason = (id: string) => `${PREGUNTA_MARK} [consulta ${id}] Jorge pregunta algo del proyecto; contesta con answer_consulta`;
const RETRY_HOURS = 6;

export type ConsultaWake = "queued" | "busy" | "off";

async function queue(db: Db, c: Pick<Consulta, "id">, po: Agent, project: { id: string; slug: string }): Promise<ConsultaWake> {
  const w = await enqueueWake(db, { agent: po, project, taskKey: null, reason: consultaReason(c.id), trigger: "consulta", consultaId: c.id });
  if (w.kind === "queued") {
    await db.update(consultas).set({ runId: w.runId }).where(eq(consultas.id, c.id));
    return "queued";
  }
  return w.reason === "coalesced" ? "busy" : "off";
}

export async function askConsulta(db: Db, project: { id: string; slug: string }, po: Agent, text: string): Promise<{ id: string; wake: ConsultaWake }> {
  const q = text.trim();
  const [row] = await db.insert(consultas).values({ projectId: project.id, agentId: po.id, text: q }).returning({ id: consultas.id });
  return { id: row!.id, wake: await queue(db, row!, po, project) };
}

// Questions whose PO was busy (no run yet) get queued again; one that waited more than RETRY_HOURS is left alone.
export async function retryConsultas(db: Db, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RETRY_HOURS * 3_600_000);
  const rows = await db
    .select({ c: consultas, p: { id: projects.id, slug: projects.slug } })
    .from(consultas)
    .innerJoin(projects, eq(projects.id, consultas.projectId))
    .where(and(isNull(consultas.runId), isNull(consultas.answer), gt(consultas.askedAt, since)));
  let queued = 0;
  for (const { c, p } of rows) {
    if (!c.agentId) continue;
    const [po] = await db.select().from(agents).where(eq(agents.id, c.agentId)).limit(1);
    if (po && (await queue(db, c, po, p)) === "queued") queued++;
  }
  return queued;
}

// What the run is told. The role prompt still goes first; this replaces the ticket prompt.
export function consultaPrompt(input: {
  agent: string;
  project: { slug: string; title: string };
  consulta: Pick<Consulta, "id" | "text">;
  cwd: string;
  sessionId: string;
  /** PLA-66: the read copy the run is in (origin/sandbox just fetched), or why it fell back to the owner's checkout. */
  copy?: { branch: string | null; commit: string | null; fallback?: string } | null;
}): string {
  const where = input.copy?.branch
    ? `You are in a read-only copy of the project at origin/${input.copy.branch} ${input.copy.commit ?? ""}, fetched just now: ${input.cwd}. In answer_consulta, branch is "${input.copy.branch}" and commit is "${input.copy.commit ?? ""}" unless you read another branch. This run is read-only: you may read and search files and use read-only git (git status, git log, git show, git diff, git for-each-ref). You may not edit, commit, push, install or run the app, and you start no work in Plania.`
    : `You are in the project's own checkout: ${input.cwd}.${input.copy?.fallback ? ` A fresh copy could not be made (${input.copy.fallback}), so this checkout may be behind origin; check with git log -1 --format=%cd and say how old it is.` : ""} This run is read-only: you may read and search files and use read-only git (git status, git log, git show, git diff, git for-each-ref). You may not edit, commit, push, install or run the app, and you start no work in Plania.`;
  return [
    `You are ${input.agent}, the product owner of project ${input.project.slug} (${input.project.title}), woken by the Plania runner to answer one question from Jorge. Nothing else.`,
    `His question (consulta ${input.consulta.id}):`,
    `«${input.consulta.text}»`,
    where,
    "First see which branch is checked out and its commit (git rev-parse --abbrev-ref HEAD; git rev-parse --short HEAD). If what he asks about is not on that branch, look for it on the open branches (git for-each-ref refs/heads refs/remotes, then git show <branch>:<path>) and say which branch you read.",
    "Answer in the language of his question, in plain words: one short answer (two sentences at most), then the reasons (up to four, one or two sentences each). Name every file you rely on with its line. Say whether you saw it in the code or are guessing, and that you did not try it live. If knowing for sure needs running the app, say so instead of guessing.",
    "If there is something to fix, write it as a request he could send to the team (fix: one or two sentences in Spanish, naming the branch when it is not main). Otherwise leave fix out. Never start the fix.",
    `Finish with exactly one call: answer_consulta {project: "${input.project.slug}", id: "${input.consulta.id}", short, why, sources [{path, line}], branch, commit, sure ("seen" or "guess"), fix?} with actor session_id ${input.sessionId}. Paths are relative to the repo root; a file you looked for that does not exist goes in sources with missing true. Then stop.`,
  ].join("\n");
}

const clean = (s: unknown, max: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export type AnswerInput = {
  project: string;
  id: string;
  short: string;
  why?: string[];
  sources?: { path: string; line?: number | null; missing?: boolean }[];
  branch?: string | null;
  commit?: string | null;
  sure?: "seen" | "guess";
  fix?: string | null;
};

// Who may answer: the PO the question woke, named by its slug or roster name, or the run it was queued for (the
// runner's token is shared, so its run session «run-<first 8 of the run id>» is what proves it).
export async function answerConsulta(db: Db, input: AnswerInput, who: { agent: string; session_id?: string | null }): Promise<{ id: string; answered_at: string }> {
  const agentSlug = who.agent;
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  if (!/^[0-9a-f-]{36}$/.test(input.id)) throw new ToolError("CONSULTA_NOT_FOUND", { consulta: input.id });
  const [c] = await db.select().from(consultas).where(and(eq(consultas.id, input.id), eq(consultas.projectId, p.id))).limit(1);
  if (!c) throw new ToolError("CONSULTA_NOT_FOUND", { consulta: input.id });
  const [po] = c.agentId ? await db.select({ slug: agents.slug, name: agents.name }).from(agents).where(eq(agents.id, c.agentId)).limit(1) : [];
  const ownRun = !!c.runId && isSessionOf(who.session_id, c.runId);
  if (!po || !(ownRun || po.slug === agentSlug || po.name === agentSlug)) throw new ToolError("CONSULTA_FORBIDDEN", { consulta: input.id, agent: agentSlug });
  const short = clean(input.short, 600);
  if (!short) throw new ToolError("INVALID_FILTER", { field: "short", hint: "the answer is empty" });
  const answer: ConsultaAnswer = {
    short,
    why: (input.why ?? []).map((w) => String(w ?? "").trim().slice(0, 700)).filter(Boolean).slice(0, 6),
    sources: (input.sources ?? [])
      .map((s) => ({ path: clean(s.path, 200), line: typeof s.line === "number" && s.line > 0 ? Math.floor(s.line) : null, missing: s.missing === true }))
      .filter((s) => s.path)
      .slice(0, 12),
    branch: clean(input.branch, 120) || null,
    commit: clean(input.commit, 40) || null,
    sure: input.sure === "seen" ? "seen" : "guess",
    tried: false,
    fix: clean(input.fix, 1200) || null,
    by: po.slug,
  };
  const at = new Date();
  await db.update(consultas).set({ answer, answeredAt: at }).where(eq(consultas.id, c.id));
  return { id: c.id, answered_at: at.toISOString() };
}

// ---- What the side page reads

export type ConsultaState = "cola" | "leyendo" | "lista" | "sin_respuesta";
export type ConsultaView = {
  id: string;
  text: string;
  asked_at: string;
  state: ConsultaState;
  trail: string[];
  started_at: string | null;
  answered_at: string | null;
  answer: ConsultaAnswer | null;
};

// One line per thing the run looked at, from the stream-json log (assistant tool_use blocks). Missing or unreadable
// logs give an empty trail.
export function trailOf(logText: string, cwd: string | null): string[] {
  const out: string[] = [];
  const rel = (p: unknown) => {
    const s = String(p ?? "");
    return cwd && s.startsWith(cwd) ? path.relative(cwd, s) || "." : s;
  };
  for (const line of logText.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let m: { type?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type !== "assistant") continue;
    for (const b of m.message?.content ?? []) {
      if (b.type !== "tool_use") continue;
      const i = b.input ?? {};
      if (b.name === "Read") out.push(`Abrió ${rel(i.file_path)}`);
      else if (b.name === "Grep") out.push(`Buscó «${clean(i.pattern, 60)}»${i.path ? ` en ${rel(i.path)}` : ""}`);
      else if (b.name === "Glob") out.push(`Buscó archivos ${clean(i.pattern, 60)}`);
      else if (b.name === "Bash") out.push(`Corrió ${clean(i.command, 70)}`);
    }
  }
  return out.slice(-14);
}

function readTrail(logPath: string | null, cwd: string | null): string[] {
  if (!logPath) return [];
  try {
    return trailOf(readFileSync(logPath, "utf8"), cwd);
  } catch {
    return [];
  }
}

export async function listConsultas(db: Db, projectId: string, limit = 20): Promise<ConsultaView[]> {
  const rows = await db.select().from(consultas).where(eq(consultas.projectId, projectId)).orderBy(desc(consultas.askedAt)).limit(limit);
  const runIds = rows.map((r) => r.runId).filter((x): x is string => !!x);
  const runs = runIds.length
    ? await db
        .select({ id: agentRuns.id, status: agentRuns.status, logPath: agentRuns.logPath, cwd: agentRuns.cwd, startedAt: agentRuns.startedAt })
        .from(agentRuns)
        .where(inArray(agentRuns.id, runIds))
    : [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  return rows.map((c, i) => {
    const run = c.runId ? byId.get(c.runId) : undefined;
    const state: ConsultaState = c.answer ? "lista" : !run ? "cola" : run.status === "queued" || run.status === "running" ? "leyendo" : "sin_respuesta";
    // Only the newest few carry their trail: it is read from a log file each time.
    const trail = run && i < 5 ? readTrail(run.logPath, run.cwd) : [];
    return {
      id: c.id,
      text: c.text,
      asked_at: c.askedAt.toISOString(),
      state,
      trail,
      started_at: run?.startedAt?.toISOString() ?? null,
      answered_at: c.answeredAt?.toISOString() ?? null,
      answer: c.answer ?? null,
    };
  });
}

// PLA-I57-1: «Pedirlo» carries the answer into the new idea or ticket, so nobody has to find it again.
export async function answerNote(db: Db, projectId: string, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [c] = await db.select().from(consultas).where(and(eq(consultas.id, id), eq(consultas.projectId, projectId))).limit(1);
  if (!c?.answer) return null;
  const a = c.answer;
  const src = a.sources.map((s) => `${s.path}${s.line ? `:${s.line}` : ""}${s.missing ? " (no existe)" : ""}`).join(", ");
  return [
    `Viene de una pregunta a Plania: «${c.text.slice(0, 300)}»`,
    `Respuesta del PO: ${a.short}`,
    ...a.why.map((w) => `- ${w}`),
    src ? `Dónde: ${src}` : "",
    a.branch ? `Leído en ${a.branch}${a.commit ? ` @ ${a.commit}` : ""}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function consultaById(db: Db, id: string): Promise<Consulta | null> {
  const [c] = await db.select().from(consultas).where(eq(consultas.id, id)).limit(1);
  return c ?? null;
}
