import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { GOAL_STATUSES, goals, projects, tasks, type Goal, type Task } from "../db/schema.js";
import { bus } from "../events.js";
import { ToolError } from "./errors.js";
import { writeTx, type Ctx, type Q } from "./tx.js";

// Company goals (no project) and the project goals under them. An initiative points at one goal
// with tasks.goal_id; a ticket shows that chain through its parent. Progress is how many of the
// linked initiatives' tickets are Done, rolled up from a project goal to its company goal.
// Nothing here scores an OKR or enforces target_on.

const WRITE_LOCK = 7_264_201; // same advisory lock as writeTx, so a goal write queues with every other write

export type GoalProgress = { done: number; total: number };

export type GoalInitiative = { key: string; title: string; status: string };

export type GoalView = {
  id: string;
  title: string;
  why: string;
  status: (typeof GOAL_STATUSES)[number];
  target_on: string | null;
  position: number;
  project: string | null;
  parent_id: string | null;
  progress: GoalProgress;
  initiatives: GoalInitiative[];
  children: GoalView[];
};

export type WhyLink = {
  level: "task" | "initiative" | "project_goal" | "company_goal";
  key: string | null;
  title: string;
  why: string | null;
};

export type SetGoalInput = {
  id?: string;
  project?: string | null;
  parent_id?: string | null;
  title?: string;
  why?: string;
  status?: string;
  target_on?: string | null;
  position?: number;
};

type Direct = { progress: GoalProgress; initiatives: GoalInitiative[] };

function isStatus(s: string): s is GoalView["status"] {
  return (GOAL_STATUSES as readonly string[]).includes(s);
}

function checkStatus(status: string): GoalView["status"] {
  if (!isStatus(status)) throw new ToolError("INVALID_GOAL", { field: "status", allowed: GOAL_STATUSES });
  return status;
}

function checkTarget(v: string | null | undefined): string | null | undefined {
  if (v === undefined || v === null) return v;
  const day = new Date(`${v}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== v) {
    throw new ToolError("INVALID_GOAL", { field: "target_on", hint: "YYYY-MM-DD" });
  }
  return v;
}

function checkPosition(v: number | undefined): number | undefined {
  if (v === undefined) return v;
  if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new ToolError("INVALID_GOAL", { field: "position" });
  return v;
}

// The goal an initiative may point at: a company goal, or a goal of this project. Anything else is missing.
export async function resolveInitiativeGoal(db: Q, projectId: string, goalId: string | null): Promise<string | null> {
  if (goalId === null) return null;
  const [g] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!g || (g.projectId !== null && g.projectId !== projectId)) throw new ToolError("GOAL_NOT_FOUND", { field: "goal_id" });
  return g.id;
}

// task → initiative → project goal → company goal. Null when the initiative (or the ticket's parent) has no goal.
export async function whyChainOf(db: Q, task: Task): Promise<WhyLink[] | null> {
  const initiative =
    task.kind === "initiative"
      ? task
      : task.kind === "ticket" && task.parentId
        ? ((await db.select().from(tasks).where(eq(tasks.id, task.parentId)).limit(1))[0] ?? null)
        : null;
  if (!initiative?.goalId) return null;
  const [goal] = await db.select().from(goals).where(eq(goals.id, initiative.goalId)).limit(1);
  if (!goal) return null;
  const parent = goal.parentId ? ((await db.select().from(goals).where(eq(goals.id, goal.parentId)).limit(1))[0] ?? null) : null;
  const chain: WhyLink[] = [];
  if (task.kind === "ticket") chain.push({ level: "task", key: task.key, title: task.title, why: null });
  chain.push({ level: "initiative", key: initiative.key, title: initiative.title, why: null });
  const link = (g: Goal, level: WhyLink["level"]): WhyLink => ({ level, key: null, title: g.title, why: g.why || null });
  if (goal.projectId) {
    chain.push(link(goal, "project_goal"));
    if (parent) chain.push(link(parent, "company_goal"));
  } else {
    chain.push(link(goal, "company_goal"));
  }
  return chain;
}

async function loadBoard(db: Q): Promise<GoalView[]> {
  const rows = await db.select().from(goals);
  const slugRows = await db.select({ id: projects.id, slug: projects.slug }).from(projects);
  const slugs = new Map(slugRows.map((p) => [p.id, p.slug]));
  const counts = await db.execute<{ goal_id: string; done: number; total: number }>(sql`
    select i.goal_id as goal_id,
           count(*)::int as total,
           count(*) filter (where c.status = 'Done')::int as done
    from tasks c
    join tasks i on i.id = c.parent_id
    where c.kind = 'ticket' and i.kind = 'initiative' and i.goal_id is not null
    group by i.goal_id`);
  const progress = new Map<string, GoalProgress>();
  for (const row of counts.rows) progress.set(row.goal_id, { done: row.done, total: row.total });
  const inits = await db
    .select({ key: tasks.key, title: tasks.title, status: tasks.status, goalId: tasks.goalId })
    .from(tasks)
    .where(sql`${tasks.kind} = 'initiative' and ${tasks.goalId} is not null`);
  const byGoal = new Map<string, GoalInitiative[]>();
  for (const init of inits) {
    if (!init.goalId) continue;
    const list = byGoal.get(init.goalId) ?? [];
    list.push({ key: init.key, title: init.title, status: init.status });
    byGoal.set(init.goalId, list);
  }
  const views = new Map<string, GoalView>();
  for (const row of rows) {
    const direct: Direct = {
      progress: progress.get(row.id) ?? { done: 0, total: 0 },
      initiatives: (byGoal.get(row.id) ?? []).sort((a, b) => a.key.localeCompare(b.key)),
    };
    views.set(row.id, {
      id: row.id,
      title: row.title,
      why: row.why,
      status: checkStatus(row.status),
      target_on: row.targetOn,
      position: row.position,
      project: row.projectId ? (slugs.get(row.projectId) ?? null) : null,
      parent_id: row.parentId,
      progress: direct.progress,
      initiatives: direct.initiatives,
      children: [],
    });
  }
  const byParent = new Map<string, GoalView[]>();
  const roots: GoalView[] = [];
  for (const view of views.values()) {
    const parent = view.parent_id ? views.get(view.parent_id) : undefined;
    if (parent) {
      const list = byParent.get(parent.id) ?? [];
      list.push(view);
      byParent.set(parent.id, list);
    } else roots.push(view);
  }
  const order = (a: GoalView, b: GoalView) => a.position - b.position || a.title.localeCompare(b.title);
  const roll = (view: GoalView): GoalView => {
    const children = (byParent.get(view.id) ?? []).sort(order).map(roll);
    const progress = children.reduce((sum, child) => ({ done: sum.done + child.progress.done, total: sum.total + child.progress.total }), {
      done: view.progress.done,
      total: view.progress.total,
    });
    return { ...view, progress, children };
  };
  return roots.sort(order).map(roll);
}

function findGoal(nodes: GoalView[], id: string): GoalView | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findGoal(node.children, id);
    if (child) return child;
  }
  return undefined;
}

export async function listGoals(db: Q, project?: string): Promise<{ goals: GoalView[] }> {
  const tree = await loadBoard(db);
  if (!project) return { goals: tree };
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, project)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND");
  const flat: GoalView[] = [];
  const walk = (nodes: GoalView[]) => {
    for (const node of nodes) {
      if (node.project === project) flat.push({ ...node, children: [] });
      walk(node.children);
    }
  };
  walk(tree);
  return { goals: flat };
}

async function goalView(db: Q, id: string): Promise<GoalView> {
  const found = findGoal(await loadBoard(db), id);
  if (!found) throw new ToolError("GOAL_NOT_FOUND", { field: "id" });
  return found;
}

async function resolveParent(db: Q, parentId: string | null, selfId?: string): Promise<string | null> {
  if (parentId === null) return null;
  if (selfId && parentId === selfId) throw new ToolError("INVALID_GOAL", { field: "parent_id" });
  const [parent] = await db.select().from(goals).where(eq(goals.id, parentId)).limit(1);
  if (!parent) throw new ToolError("GOAL_NOT_FOUND", { field: "parent_id" });
  if (parent.projectId !== null) throw new ToolError("INVALID_GOAL", { field: "parent_id", hint: "the parent is a company goal" });
  return parent.id;
}

async function resolveProject(db: Q, slug: string | null): Promise<{ id: string; slug: string } | null> {
  if (slug === null) return null;
  const [p] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!p) throw new ToolError("PROJECT_NOT_FOUND");
  return p;
}

async function nextPosition(db: Q, projectId: string | null, parentId: string | null): Promise<number> {
  const [row] = (
    await db.execute<{ n: number }>(sql`
      select coalesce(max(position), -1)::int + 1 as n
      from goals
      where project_id is not distinct from ${projectId}::uuid
        and parent_id is not distinct from ${parentId}::uuid`)
  ).rows;
  return row?.n ?? 0;
}

async function assertNoLinkedMove(db: Q, goalId: string): Promise<void> {
  const [linked] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.goalId, goalId)).limit(1);
  if (linked) throw new ToolError("INVALID_GOAL", { field: "project", hint: "unlink the initiatives first" });
}

async function writeGoal(db: Q, input: SetGoalInput): Promise<string> {
  const targetOn = checkTarget(input.target_on);
  const position = checkPosition(input.position);
  if (!input.id) {
    const title = input.title?.trim();
    if (!title) throw new ToolError("INVALID_GOAL", { field: "title" });
    const status = checkStatus(input.status ?? "active");
    const project = await resolveProject(db, input.project ?? null);
    const parentId = await resolveParent(db, input.parent_id ?? null);
    if (!project && parentId) throw new ToolError("INVALID_GOAL", { field: "parent_id", hint: "a company goal has no parent" });
    const [row] = await db
      .insert(goals)
      .values({
        projectId: project?.id ?? null,
        parentId,
        title,
        why: input.why?.trim() ?? "",
        status,
        targetOn: targetOn ?? null,
        position: position ?? (await nextPosition(db, project?.id ?? null, parentId)),
      })
      .returning({ id: goals.id });
    return row!.id;
  }

  const [existing] = await db.select().from(goals).where(eq(goals.id, input.id)).limit(1);
  if (!existing) throw new ToolError("GOAL_NOT_FOUND", { field: "id" });
  const title = input.title === undefined ? existing.title : input.title.trim();
  if (!title) throw new ToolError("INVALID_GOAL", { field: "title" });
  const status = input.status === undefined ? checkStatus(existing.status) : checkStatus(input.status);
  const project = input.project === undefined ? null : await resolveProject(db, input.project);
  const projectId = input.project === undefined ? existing.projectId : (project?.id ?? null);
  const parentId = input.parent_id === undefined ? existing.parentId : await resolveParent(db, input.parent_id, existing.id);
  if (!projectId && parentId) throw new ToolError("INVALID_GOAL", { field: "parent_id", hint: "a company goal has no parent" });
  if (projectId !== existing.projectId) {
    const [child] = await db.select({ id: goals.id }).from(goals).where(eq(goals.parentId, existing.id)).limit(1);
    if (child) throw new ToolError("INVALID_GOAL", { field: "project", hint: "a goal with project goals under it stays a company goal" });
    await assertNoLinkedMove(db, existing.id);
  }
  if (parentId && parentId === existing.id) throw new ToolError("INVALID_GOAL", { field: "parent_id" });
  await db
    .update(goals)
    .set({
      title,
      why: input.why === undefined ? existing.why : input.why.trim(),
      status,
      targetOn: targetOn === undefined ? existing.targetOn : targetOn,
      position: position === undefined ? existing.position : position,
      projectId,
      parentId,
      updatedAt: sql`now()`,
    })
    .where(eq(goals.id, existing.id));
  return existing.id;
}

async function projectOf(db: Q, input: SetGoalInput): Promise<{ id: string; slug: string } | null> {
  if (input.project) return resolveProject(db, input.project);
  if (!input.id || input.project === null) return null;
  const [row] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(goals)
    .innerJoin(projects, eq(projects.id, goals.projectId))
    .where(eq(goals.id, input.id))
    .limit(1);
  return row ?? null;
}

export async function setGoal(db: Db, input: SetGoalInput, ctx: Ctx): Promise<GoalView> {
  const project = await projectOf(db, input);
  const run = async (tx: Q) => {
    const id = await writeGoal(tx, input);
    return goalView(tx, id);
  };
  if (project) {
    return writeTx(db, project, ctx, async (tx, emit) => {
      const view = await run(tx);
      await emit("goal.set", null, { id: view.id, title: view.title, status: view.status });
      return view;
    });
  }
  const view = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`);
    return run(tx);
  });
  bus.publish({ type: "project", project: "" });
  return view;
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const actor = z
  .object({
    agent: z.string().min(1).max(60).optional(),
    session_id: z.string().min(1).max(120),
    machine: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
  })
  .describe("Who is writing. Required on every write; recorded in the event log");

const request_id = z.string().min(1).optional().describe("Optional idempotency key. Retrying a project goal with the same request_id returns the first response");

type Hooks = {
  run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
  writeHandler: (
    tool: string,
    fn: (input: SetGoalInput, ctx: Ctx) => Promise<unknown>,
  ) => (input: { actor: { session_id: string } }) => Promise<CallToolResult>;
};

export function registerGoalTools(server: McpServer, db: Db, hooks: Hooks): void {
  server.registerTool(
    "list_goals",
    {
      description: [
        "Company goals and the project goals under them. Without project: company goals, each with its project goals in children.",
        "With project: only that project's goals. progress is {done, total} of the linked initiatives' tickets (status Done over every ticket); a company goal adds its children's progress.",
        "initiatives lists the initiatives whose goal_id is this goal. target_on is stored and never enforced. Dropped goals stay in the list.",
      ].join(" "),
      inputSchema: {
        project: z.string().min(1).optional().describe("Project slug. Omit for the whole company tree"),
      },
      annotations: readOnly,
    },
    ({ project }) => hooks.run(() => listGoals(db, project)),
  );

  server.registerTool(
    "set_goal",
    {
      description: [
        "Create or update a goal. Omit id to create (title required). Pass id to update; only the fields you pass change.",
        "project is the slug of a project goal. Omit it, or pass null, for a company goal (no parent). parent_id is a company goal; a project goal may omit it.",
        "status is active, done or dropped. target_on is YYYY-MM-DD and only a label. Link an initiative with create_task or set_task goal_id, not here.",
        "A goal another project owns, or an unknown id, is GOAL_NOT_FOUND. A company goal with a parent, a parent that is itself a project goal, or a bad date is INVALID_GOAL.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        id: z.string().uuid().optional().describe("Omit to create; pass the id from list_goals to update"),
        project: z.string().min(1).nullable().optional().describe("Project slug, or null for a company goal. Omit on update to leave it"),
        parent_id: z.string().uuid().nullable().optional().describe("The company goal this project goal sits under. Null clears it"),
        title: z.string().min(1).optional(),
        why: z.string().optional().describe("The reason, shown on the goal and in a task's why chain"),
        status: z.string().optional().describe("active | done | dropped"),
        target_on: z.string().nullable().optional().describe("YYYY-MM-DD. Stored only; nothing becomes overdue from it"),
        position: z.number().int().optional().describe("Order among its siblings. Omit to append"),
      },
      annotations: write,
    },
    hooks.writeHandler("set_goal", (input, ctx) => setGoal(db, input as SetGoalInput, ctx)),
  );
}
