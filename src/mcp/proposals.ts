// PLA-I36-7/8 (protocol 2.19): `propose`, a PO's proposal as data in its project thread.
//   kind choice  2 to 6 options, each with label, effect and cost {tickets, days, tokens, delays}; the recommended
//                one with recommended_reason; combinable lists the option sets Jorge may pick together ([[1, 2]]).
//   kind plan    the answer to one of Jorge's orders (order: its key): what the PO understood, the steps (each with
//                what done means and its work_type) and the total cost. When the project approves plans
//                (settings.plan_approval) nothing is made until someone presses "Sí, empiecen" in Te toca; then
//                Plania makes one Ready ticket per step. Without approval the tickets are made now and the plan
//                shows as information.
// The message body is a prose copy (numbered options), so an older screen still reads it through parseProposal.
// Only the project's PO (or Asistente) may propose; the author is the agent behind the actor.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { projects, tasks, type ProposalCost, type ProposalData, type ThreadLink } from "../db/schema.js";
import { agentOfActor } from "../runner/events.js";
import { assertThreadAccess, checkLinks, messageView, postMessage, projectThread } from "../runner/threads.js";
import { ToolError } from "./errors.js";
import type { Ctx } from "./tx.js";
import { createTask } from "./writes.js";

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
};

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
  if (steps.length < 1 || steps.length > 10) throw bad("steps", "1 to 10 steps");
  if (steps.some((s) => !s.title || !s.done_when)) throw bad("steps", "each step has a title and done_when");
  if (steps.some((s) => !STEP_TYPES.includes(s.work_type))) throw bad("steps", `work_type one of ${STEP_TYPES.join(", ")}`);
  return { kind: "plan", title, options: [], recommended_reason: null, combinable: [], order: input.order.trim(), understood: input.understood.trim(), steps, cost: input.cost ?? {}, links, needs_approval: approval, created: [] };
}

// The plan's tickets: one Ready ticket per step, in the order's project. Returns their keys.
export async function makeSteps(db: Db, slug: string, p: ProposalData, ctx: Ctx): Promise<string[]> {
  const keys: string[] = [];
  for (const s of p.steps) {
    const made = (await createTask(
      db,
      {
        project: slug,
        title: s.title.slice(0, 200),
        status: "Ready",
        work_type: s.work_type,
        priority: "P2",
        scope: `Paso del pedido ${p.order}: ${p.title}\n\nLo que se entendió: ${p.understood ?? ""}\n\nHecho cuando: ${s.done_when}`,
        checks: [s.done_when],
      } as never,
      ctx,
    )) as { key: string };
    keys.push(made.key);
  }
  return keys;
}

export async function propose(db: Db, input: ProposeInput, ctx: Ctx) {
  const [p] = await db.select().from(projects).where(eq(projects.slug, input.project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND", { project: input.project });
  const ref = { thread: await projectThread(db, p.id), project: p };
  const { agent, role } = await assertThreadAccess(db, await agentOfActor(db, ctx.actor), ref);
  if (role !== "product-owner" && role !== "asistente") throw new ToolError("THREAD_FORBIDDEN", { hint: "only the project's PO proposes" });
  const data = checkProposal(input, !!p.settings.plan_approval, checkLinks(input.links));
  if (data.kind === "plan") {
    const [order] = await db.select({ id: tasks.id, origin: tasks.origin }).from(tasks).where(and(eq(tasks.projectId, p.id), eq(tasks.key, data.order!))).limit(1);
    if (!order) throw new ToolError("TASK_NOT_FOUND", { key: data.order, hint: "order is the key of Jorge's order in this project" });
    if (!data.needs_approval) data.created = await makeSteps(db, p.slug, data, ctx);
    if (!data.links.some((l) => l.kind === "ticket" && l.ref === data.order)) data.links.unshift({ kind: "ticket", ref: data.order!, title: data.title.slice(0, 200) });
  }
  const msg = await postMessage(db, ref, { author: { agent: agent.slug, role }, body: proposalBody(data), links: data.links.slice(0, 10), proposal: data }, ctx);
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
