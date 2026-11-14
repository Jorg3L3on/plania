// PLA-I36-7/8 (protocol 2.19): `propose`, a PO's proposal as data in its project thread.
//   kind choice  2 to 6 options, each with label, effect and cost {tickets, days, tokens, delays}; the recommended
//                one with recommended_reason; combinable lists the option sets Jorge may pick together ([[1, 2]]).
//   kind plan    the answer to one of Jorge's orders (order: its key): what the PO understood, the steps (each with
//                what done means and its work_type) and the total cost. When the project approves plans
//                (settings.plan_approval) nothing is made until someone presses "Sí, empiecen" in Te toca; then
//                Plania makes one Ready ticket per step. Without approval the tickets are made now and the plan
//                shows as information.
//   PLA-I46-11, a plan for a leg (leg: the initiative's key, or found from the order's «title»): at most 4 steps,
//                up to 3 closed questions {text, options (2 to 4), suggested (0-based)}, and the check list (exactly
//                3 things to verify). It always waits for the owner (Aceptar plan / Cambiar algo / Después on the
//                floor), whatever the project's switch says; accepting makes the steps under that initiative, each
//                with the check list (tasks.po_checklist) for QA. A leg that is On hold (postponed) is refused.
// The message body is a prose copy (numbered options), so an older screen still reads it through parseProposal.
// Only the project's PO (or Asistente) may propose; the author is the agent behind the actor.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { projects, tasks, type PlanQuestion, type PoCheck, type ProposalCost, type ProposalData, type ThreadLink } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { assertThreadAccess, checkLinks, messageView, postMessage, projectThread } from "../runner/threads.js";
import { ToolError } from "./errors.js";
import type { Ctx } from "./tx.js";
import { createTask, setTask } from "./writes.js";

type ActorIn = { agent?: string; session_id: string; machine?: string; model?: string };
export type ProposeInput = {
  project: string;
  kind: "choice" | "plan";
  title: string;
  options?: { label: string; effect?: string; cost?: ProposalCost; recommended?: boolean }[];
  recommended_reason?: string;
  combinable?: number[][];
  order?: string;
  understood?: string;
  steps?: { title: string; done_when: string; work_type?: string }[];
  cost?: ProposalCost;
  links?: unknown;
  leg?: string;
  questions?: { text: string; options: string[]; suggested?: number }[];
  checklist?: string[];
};

export const PLAN_MAX_STEPS = 4;
export const PLAN_MAX_QUESTIONS = 3;
export const CHECKLIST_SIZE = 3;
// «Planea «<title>»: …» is how the floor's Que PO lo planee words an order (company-move.ts PLAN_LEG).
export const legTitleOf = (text: string) => /Planea «([^»]+)»/.exec(text)?.[1]?.trim() ?? null;
// A leg plan carries the questions and the check list; an order's plan (PLA-I36-8) does not.
export const isLegPlan = (p: Pick<ProposalData, "kind" | "leg">) => p.kind === "plan" && !!p.leg;
// The owner's edited list, as stored on each step.
export const poChecks = (list: string[]): PoCheck[] => list.map((text, i) => ({ n: i + 1, text, done: false, done_at: null, done_by: null }));

const STEP_TYPES = ["code", "ops", "research", "bug", "debt"];

export function costText(c: ProposalCost | undefined): string {
  if (!c) return "";
  return [
    c.tickets != null ? `${c.tickets} ${c.tickets === 1 ? "ticket" : "tickets"}` : "",
    c.days != null ? `${c.days} ${c.days === 1 ? "día" : "días"}` : "",
    c.tokens != null ? `~${c.tokens >= 1_000_000 ? `${Math.round(c.tokens / 100_000) / 10}M` : `${Math.round(c.tokens / 1000)}k`} tokens` : "",
    c.delays ? `retrasa ${c.delays}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The prose copy kept in the body.
export function proposalBody(p: ProposalData): string {
  if (p.kind === "plan") {
    const lines = [
      `Plan para tu pedido: ${p.title}`,
      p.understood ? `Entendí: ${p.understood}` : "",
      ...p.steps.map((s, i) => `${i + 1}. ${s.title} — hecho cuando: ${s.done_when}`),
      ...(p.questions ?? []).map((q) => `¿${q.text.replace(/^¿|\?$/g, "")}? ${q.options.map((o, i) => (i === q.suggested ? `[${o}]` : o)).join(" / ")}`),
      (p.checklist ?? []).length ? `Check list: ${p.checklist!.join(" · ")}` : "",
      costText(p.cost) ? `Costo: ${costText(p.cost)}` : "",
      p.needs_approval ? "Nada empieza hasta que digas «Sí, empiecen»." : "Empieza ya; el plan queda como información.",
    ];
    return lines.filter(Boolean).join("\n");
  }
  const lines = [
    `${p.title}:`,
    ...p.options.map((o) => `${o.n}. ${o.label}${o.recommended ? " (recomendado)" : ""}${o.effect ? ` — ${o.effect}` : ""}${costText(o.cost) ? ` · ${costText(o.cost)}` : ""}`),
    p.recommended_reason ? `Recomiendo la ${p.options.find((o) => o.recommended)?.n ?? 1}: ${p.recommended_reason}` : "",
    ...p.combinable.map((set) => `${set.join(" y ")} pueden ir juntas.`),
  ];
  return lines.filter(Boolean).join("\n");
}

export function checkProposal(input: ProposeInput, approval: boolean, links: ThreadLink[]): ProposalData {
  const bad = (field: string, hint: string) => new ToolError("INVALID_FILTER", { field, hint });
  const title = input.title?.trim();
  if (!title) throw bad("title", "one line");
  if (input.kind === "choice") {
    const opts = input.options ?? [];
    if (opts.length < 2 || opts.length > 6) throw bad("options", "2 to 6 options");
    const recommended = opts.filter((o) => o.recommended).length;
    if (recommended > 1) throw bad("options", "one recommended option at most");
    const options = opts.map((o, i) => ({ n: i + 1, label: o.label.trim(), effect: (o.effect ?? "").trim(), cost: o.cost ?? {}, recommended: !!o.recommended }));
    if (options.some((o) => !o.label)) throw bad("options", "every option has a label");
    const combinable = (input.combinable ?? []).map((set) => [...new Set(set)].sort((a, b) => a - b));
    for (const set of combinable) if (set.length < 2 || set.some((n) => n < 1 || n > options.length)) throw bad("combinable", "sets of two or more option numbers");
    return { kind: "choice", title, options, recommended_reason: input.recommended_reason?.trim() || null, combinable, order: null, understood: null, steps: [], cost: input.cost ?? {}, links, needs_approval: false, created: [] };
  }
  if (input.kind !== "plan") throw bad("kind", "choice or plan");
  if (!input.order?.trim()) throw bad("order", "the key of Jorge's order this plan answers");
  if (!input.understood?.trim()) throw bad("understood", "what you understood, one line");
  const steps = (input.steps ?? []).map((s) => ({ title: s.title.trim(), done_when: s.done_when.trim(), work_type: s.work_type ?? "code" }));
  const leg = input.leg?.trim() || null;
  const max = leg ? PLAN_MAX_STEPS : 10;
  if (steps.length < 1 || steps.length > max) throw bad("steps", `1 to ${max} steps`);
  if (steps.some((s) => !s.title || !s.done_when)) throw bad("steps", "each step has a title and done_when");
  if (steps.some((s) => !STEP_TYPES.includes(s.work_type))) throw bad("steps", `work_type one of ${STEP_TYPES.join(", ")}`);
  const base: ProposalData = { kind: "plan", title, options: [], recommended_reason: null, combinable: [], order: input.order.trim(), understood: input.understood.trim(), steps, cost: input.cost ?? {}, links, needs_approval: approval, created: [] };
  if (!leg) {
    if (input.questions?.length || input.checklist?.length) throw bad("leg", "questions and checklist go with a plan for a leg: pass leg (the initiative's key)");
    return base;
  }
  return { ...base, needs_approval: true, leg, questions: checkQuestions(input.questions ?? [], bad), checklist: checkChecklist(input.checklist, bad), later_at: null, answers: null };
}

type Bad = (field: string, hint: string) => ToolError;
function checkQuestions(raw: NonNullable<ProposeInput["questions"]>, bad: Bad): PlanQuestion[] {
  if (raw.length > PLAN_MAX_QUESTIONS) throw bad("questions", `${PLAN_MAX_QUESTIONS} closed questions at most`);
  return raw.map((q) => {
    const text = q.text.trim();
    const options = q.options.map((o) => o.trim()).filter(Boolean);
    const suggested = q.suggested ?? 0;
    if (!text || options.length < 2 || options.length > 4) throw bad("questions", "each question has text and 2 to 4 answers");
    if (!Number.isInteger(suggested) || suggested < 0 || suggested >= options.length) throw bad("questions", "suggested is the index (0-based) of one of its answers");
    return { text, options, suggested };
  });
}
export function checkChecklist(raw: string[] | undefined, bad: Bad = (field, hint) => new ToolError("INVALID_FILTER", { field, hint })): string[] {
  const list = (raw ?? []).map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (list.length !== CHECKLIST_SIZE) throw bad("checklist", `${CHECKLIST_SIZE} things to verify, one line each`);
  if (list.some((c) => c.length > 200)) throw bad("checklist", "200 characters per line at most");
  return list;
}

// The plan's tickets: one Ready ticket per step, in the order's project. Returns their keys.
// PLA-I46-11: a leg plan's steps go under its initiative, in order (phase 1..n, each blocked by the one before), with the answers the owner kept
// and the check list in the scope, and the list itself on tasks.po_checklist for QA to tick.
export async function makeSteps(db: Db, slug: string, p: ProposalData, ctx: Ctx): Promise<string[]> {
  const keys: string[] = [];
  const legPlan = isLegPlan(p);
  const answers = legPlan ? (p.questions ?? []).map((q, i) => `- ${q.text}: ${q.options[p.answers?.[i] ?? q.suggested]}`) : [];
  const list = legPlan ? (p.checklist ?? []) : [];
  const pid = list.length ? await projectIdOf(db, slug) : null;
  for (const [i, s] of p.steps.entries()) {
    const scope = [
      `Paso del pedido ${p.order}: ${p.title}`,
      `Lo que se entendió: ${p.understood ?? ""}`,
      `Hecho cuando: ${s.done_when}`,
      answers.length ? `Respuestas del dueño:\n${answers.join("\n")}` : "",
      list.length ? `Check list del PO (QA la verifica):\n${list.map((c) => `- ${c}`).join("\n")}` : "",
    ].filter(Boolean);
    const made = (await createTask(
      db,
      {
        project: slug,
        title: s.title.slice(0, 200),
        status: "Ready",
        work_type: s.work_type,
        priority: "P2",
        scope: scope.join("\n\n"),
        checks: [s.done_when],
        // A leg's steps run in order: each waits for the one before it (the runner wakes it when that one lands).
        ...(legPlan ? { parent_key: p.leg, phase: i + 1, ...(i > 0 ? { blocked_by: [keys[i - 1]] } : {}) } : {}),
      } as never,
      ctx,
    )) as { key: string };
    if (pid) await db.update(tasks).set({ poChecklist: poChecks(list) }).where(and(eq(tasks.key, made.key), eq(tasks.projectId, pid)));
    keys.push(made.key);
  }
  return keys;
}

const projectIdOf = async (db: Db, slug: string) => (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1))[0]?.id ?? null;

// The leg a plan fills: the key the PO passed, else the open initiative whose title the order names.
export async function legOf(db: Db, projectId: string, leg: string | null, orderText: string) {
  const all = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "initiative")));
  if (leg) return all.find((t) => t.key === leg) ?? null;
  const title = legTitleOf(orderText);
  return title ? (all.find((t) => t.title === title && !["Done", "Won't do", "Released"].includes(t.status)) ?? null) : null;
}
export const POSTPONED = ["On hold"];

async function parkOrder(db: Db, slug: string, key: string, ctx: Ctx) {
  const [o] = await db.select({ status: tasks.status, version: tasks.version }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(eq(projects.slug, slug), eq(tasks.key, key))).limit(1);
  if (!o || !["Ready", "In progress"].includes(o.status)) return;
  await setTask(db, { project: slug, key, status: "Backlog", version: o.version, note: "Plan propuesto: espera «Aceptar plan» en el piso." } as never, ctx);
}

export async function propose(db: Db, input: ProposeInput, ctx: Ctx) {
  const [p] = await db.select().from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  const ref = { thread: await projectThread(db, p.id), project: p };
  const { agent, role } = await assertThreadAccess(db, await agentOfActor(db, ctx.actor), ref);
  if (role !== "product-owner" && role !== "asistente") throw new ToolError("THREAD_FORBIDDEN", { hint: "only the project's PO proposes" });
  let leg: string | null = input.kind === "plan" ? input.leg?.trim() || null : null;
  if (input.kind === "plan" && input.order) {
    const [o] = await db.select({ scope: tasks.scope, title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, input.order.trim()))).limit(1);
    const found = o ? await legOf(db, p.id, leg, `${o.title}\n${o.scope}`) : null;
    if (leg && !found) throw new ToolError("TASK_NOT_FOUND", { key: leg, hint: "leg is the key of the initiative this plan fills" });
    if (found && POSTPONED.includes(found.status)) throw new ToolError("LEG_POSTPONED", { key: found.key, status: found.status, hint: "that leg is postponed on purpose: planning it is not permission to start it" });
    leg = found?.key ?? null;
  }
  const data = checkProposal({ ...input, leg: leg ?? undefined }, !!p.settings.plan_approval, checkLinks(input.links));
  if (data.kind === "plan") {
    const [order] = await db.select({ id: tasks.id, origin: tasks.origin }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, data.order!))).limit(1);
    if (!order) throw new ToolError("TASK_NOT_FOUND", { key: data.order, hint: "order is the key of Jorge's order in this project" });
    if (!data.needs_approval) data.created = await makeSteps(db, p.slug, data, ctx);
    if (!data.links.some((l) => l.kind === "ticket" && l.ref === data.order)) data.links.unshift({ kind: "ticket", ref: data.order!, title: data.title.slice(0, 200) });
  }
  const msg = await postMessage(db, ref, { author: { agent: agent.slug, role }, body: proposalBody(data), links: data.links.slice(0, 10), proposal: data }, ctx);
  // PLA-I46-11: a leg plan is the whole answer to its order. The order is parked in Backlog so it neither wakes the
  // PO again nor reads as a delivery; the plan waits on the floor, and Aceptar plan closes the order.
  if (isLegPlan(data)) await parkOrder(db, p.slug, data.order!, ctx);
  return { thread: ref.thread.id, message: await messageView(db, msg, p.id), proposal: data };
}

type WriteCtx = (tool: string, input: { actor: ActorIn; request_id?: string; verbose?: boolean }, identity: Identity | undefined) => Ctx;

export const registerProposalTools = (
  server: McpServer,
  host: { db: Db; identity: Identity | undefined; writeCtx: WriteCtx; actor: z.ZodType; request_id: z.ZodType; run: (fn: () => Promise<unknown>) => Promise<CallToolResult>; write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false } },
): void => {
  const { db, identity, writeCtx, actor, request_id, run, write } = host;
  const cost = z.object({ tickets: z.number().int().min(0).max(100).optional(), days: z.number().min(0).max(365).optional(), tokens: z.number().int().min(0).max(100_000_000).optional(), delays: z.string().max(200).optional() });
  server.registerTool(
    "propose",
    {
      description: [
        "Post a proposal as data in your project's thread; Jorge decides it in Te toca. Only the project's PO.",
        "kind choice: title, 2 to 6 options {label, effect (what changes), cost {tickets, days, tokens, delays}, recommended}, recommended_reason, combinable (sets of option numbers that may go together, e.g. [[1, 2]]; omit when they exclude each other). It stays in Te toca until answered, even if you write again.",
        "kind plan: the answer to one of Jorge's orders. order (the order ticket's key), understood (one line, plain words), steps [{title, done_when, work_type code|ops|research|bug|debt}], cost. When the project approves plans, do not create tickets: Plania makes one Ready ticket per step when someone presses \"Sí, empiecen\". Otherwise the tickets are made now.",
        "Plan for a leg of the route (the order says «Planea «<title>»»): also pass leg (that initiative's key; found from the title when omitted), at most 4 steps, questions (up to 3 closed ones: {text, options 2 to 4 short answers, suggested: index of the one you recommend}) and checklist (exactly 3 short things QA verifies on every step). It always waits for the owner's Aceptar plan; then the steps are made under that initiative. A postponed (On hold) leg is refused: never plan it to start it.",
        "No keys, branch names or the word sandbox in title, labels or understood: anyone at the Mac reads them.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        project: z.string().min(1),
        kind: z.enum(["choice", "plan"]),
        title: z.string().min(1).max(200),
        options: z.array(z.object({ label: z.string().min(1).max(200), effect: z.string().max(300).optional(), cost: cost.optional(), recommended: z.boolean().optional() })).max(6).optional(),
        recommended_reason: z.string().max(300).optional(),
        combinable: z.array(z.array(z.number().int().min(1).max(6)).min(2).max(6)).max(6).optional(),
        order: z.string().max(40).optional(),
        understood: z.string().max(300).optional(),
        steps: z.array(z.object({ title: z.string().min(1).max(200), done_when: z.string().min(1).max(300), work_type: z.string().optional() })).max(10).optional(),
        cost: cost.optional(),
        leg: z.string().min(1).max(40).optional(),
        questions: z.array(z.object({ text: z.string().min(1).max(200), options: z.array(z.string().min(1).max(80)).min(2).max(4), suggested: z.number().int().min(0).max(3).optional() })).max(3).optional(),
        checklist: z.array(z.string().min(1).max(200)).max(3).optional(),
        links: z.array(z.object({ kind: z.enum(["ticket", "doc", "pr", "idea", "question"]), ref: z.string().min(1).max(300), title: z.string().max(200) })).max(9).optional(),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const input = raw as ProposeInput & { actor: ActorIn; request_id?: string };
        return propose(db, input, writeCtx("propose", input, identity));
      }),
  );
};
