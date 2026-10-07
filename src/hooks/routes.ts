import { Hono, type Context } from "hono";
import { withDb } from "../db/client.js";
import { setMetricInTx } from "../mcp/blockers.js";
import { setEnv, type SetEnvInput } from "../mcp/env.js";
import { findProject } from "../mcp/queries.js";
import { writeTx } from "../mcp/tx.js";
import { ToolError } from "../mcp/errors.js";
import { addResult } from "../mcp/evidence.js";
import { checkSizes } from "../mcp/limits.js";
import { setTaskLinks } from "../mcp/writes.js";
import type { Ctx } from "../mcp/tx.js";

// Inbound integrations: CI posts results, a deploy job posts environment state. JSON in and out,
// real HTTP status codes, Bearer PLANIA_CI_TOKEN (checked in app.ts). request_id is required so a
// redelivered webhook is a no-op. Nothing calls these yet: Plania listens on localhost only.
export const hooks = new Hono();

type Json = Record<string, unknown>;

class BadInput extends Error {}

const str = (body: Json, field: string, required = false): string | undefined => {
  const v = body[field];
  if (v === undefined || v === null) {
    if (required) throw new BadInput(field);
    return undefined;
  }
  if (typeof v !== "string") throw new BadInput(field);
  return v;
};

function ciCtx(requestId: string, tool: string): Ctx {
  return { actor: { agent: "ci", session_id: requestId, machine: "hooks" }, requestId, tool, verbose: true };
}

async function handle(c: Context, fn: (body: Json) => Promise<unknown>) {
  let body: Json;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_INPUT", field: "body" }, 400);
  }
  try {
    checkSizes(body);
    return c.json((await fn(body)) as Json, 200);
  } catch (e) {
    if (e instanceof BadInput) return c.json({ error: "INVALID_INPUT", field: e.message }, 400);
    if (e instanceof ToolError) return c.json({ error: e.code, ...e.detail }, e.status);
    throw e;
  }
}

// CI finished: a result on the ticket (kind ci unless told otherwise), plus its PR and branch.
hooks.post("/hooks/result", (c) =>
  handle(c, (body) => {
    const requestId = str(body, "request_id", true)!;
    const input = {
      project: str(body, "project", true)!,
      key: str(body, "key", true)!,
      kind: str(body, "kind") ?? "ci",
      verdict: str(body, "verdict", true)!,
      cite: str(body, "cite", true)!,
      url: str(body, "url"),
    };
    const links = { pr_url: str(body, "pr_url"), branch: str(body, "branch") };
    return withDb(async (db) => {
      const out = await addResult(db, input, ciCtx(requestId, "hooks.result"));
      if (!links.pr_url && !links.branch) return out;
      const linked = await setTaskLinks(db, { project: input.project, key: input.key, ...links }, ciCtx(`${requestId}:links`, "hooks.links"));
      return { ...linked, result: out.result };
    });
  }),
);

// A deploy finished: what the environment runs now. deployed carries the provider's record
// ({provider, deployment_id, url}); flags and migrations as in set_env.
hooks.post("/hooks/env", (c) =>
  handle(c, (body) => {
    const requestId = str(body, "request_id", true)!;
    const m = body.migrations_applied;
    if (m !== undefined && typeof m !== "number") throw new BadInput("migrations_applied");
    const strings = (field: string) => {
      const v = body[field];
      if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) throw new BadInput(field);
      return v as string[] | undefined;
    };
    const deployed = body.deployed;
    if (deployed !== undefined && typeof deployed !== "boolean" && !(deployed && typeof deployed === "object")) throw new BadInput("deployed");
    if (body.flags !== undefined && (!body.flags || typeof body.flags !== "object" || Array.isArray(body.flags))) throw new BadInput("flags");
    return withDb((db) =>
      setEnv(
        db,
        {
          project: str(body, "project", true)!,
          env: str(body, "env", true)!,
          commit: str(body, "commit"),
          branch: str(body, "branch"),
          migrations_applied: m as number | undefined,
          migrations: strings("migrations"),
          flags: body.flags as Record<string, string | number | boolean | null> | undefined,
          commits: strings("commits"),
          deployed: deployed as SetEnvInput["deployed"],
        },
        ciCtx(requestId, "hooks.env"),
      ),
    );
  }),
);

// A metric measured outside Plania (a cron, a dashboard export), for metric_gte blockers.
hooks.post("/hooks/metric", (c) =>
  handle(c, (body) => {
    const requestId = str(body, "request_id", true)!;
    if (typeof body.value !== "number") throw new BadInput("value");
    return withDb(async (db) => {
      const p = await findProject(db, str(body, "project", true)!);
      const ctx = ciCtx(requestId, "hooks.metric");
      return writeTx(db, p, ctx, (tx, emit) => setMetricInTx(tx, emit, p.id, str(body, "name", true)!, body.value as number, ctx.actor));
    });
  }),
);
