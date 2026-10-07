import type { Db } from "../db/client.js";
import type { Project } from "../db/schema.js";
import { addDecisionInTx, type AddDecisionInput } from "./decisions.js";
import { addResultInTx, validateEvidence, type AddResultInput } from "./evidence.js";
import { setCheckInTx, type SetCheckInput } from "./checks.js";
import { checkSizes } from "./limits.js";
import { ToolError, findProject } from "./queries.js";
import { writeTx, type Ctx, type Emit, type Q } from "./tx.js";
import { createTaskInTx, setTaskInTx, type CreateInput, type SetTaskInput } from "./writes.js";

// batch (2.1, R-29): several writes in one call. Atomic (default): one writeTx, one project lock,
// one request_id replay; the first ToolError aborts everything as BATCH_FAILED {index, ...}.
// Non-atomic: one writeTx per op, replayed by "<request_id>:<index>", failures inline.
// A later op on a key an earlier op changed may omit version: the batch chains it.

type OpBase = { op: string } & Record<string, unknown>;
export type BatchInput = { project: string; atomic?: boolean; ops: OpBase[] };

const OPS = ["create_task", "set_task", "set_check", "add_result", "add_decision", "note"] as const;

type Reply = { key?: string; version?: number } & Record<string, unknown>;

async function runOp(tx: Q, emit: Emit, p: Project, op: OpBase, ctx: Ctx, versions: Map<string, number>): Promise<Reply> {
  const { op: name, ...rest } = op;
  if (!(OPS as readonly string[]).includes(name)) throw new ToolError("INVALID_BATCH_OP", { op: name, allowed: OPS });
  checkSizes(rest);
  const input = { ...rest, project: p.slug };
  let reply: Reply;
  switch (name) {
    case "create_task":
      reply = await createTaskInTx(tx, emit, p, input as unknown as CreateInput, ctx);
      break;
    case "set_task": {
      const st = input as unknown as SetTaskInput;
      if (st.version === undefined && versions.has(st.key)) st.version = versions.get(st.key);
      reply = await setTaskInTx(tx, emit, p, st, ctx);
      break;
    }
    case "note": {
      const { key, text } = input as unknown as { key: string; text: string };
      reply = await setTaskInTx(tx, emit, p, { project: p.slug, key, note: text }, ctx);
      break;
    }
    case "set_check":
      reply = await setCheckInTx(tx, emit, p, input as unknown as SetCheckInput, ctx, validateEvidence);
      break;
    case "add_result":
      reply = await addResultInTx(tx, emit, p, input as unknown as AddResultInput, ctx);
      break;
    default:
      reply = await addDecisionInTx(tx, emit, p, input as unknown as AddDecisionInput, ctx);
  }
  if (typeof reply.key === "string" && typeof reply.version === "number") versions.set(reply.key, reply.version);
  return reply;
}

export async function runBatch(db: Db, input: BatchInput, ctx: Ctx) {
  const p = await findProject(db, input.project);
  const atomic = input.atomic ?? true;
  const versions = new Map<string, number>();

  if (atomic) {
    return writeTx(db, p, ctx, async (tx, emit) => {
      const results: unknown[] = [];
      for (const [index, op] of input.ops.entries()) {
        try {
          results.push(await runOp(tx, emit, p, op, ctx, versions));
        } catch (e) {
          if (e instanceof ToolError) throw new ToolError("BATCH_FAILED", { index, op: op.op, failed: { error: e.code, status: e.status, ...e.detail } });
          throw e;
        }
      }
      return { applied: results.length, results };
    });
  }

  const results: unknown[] = [];
  let applied = 0;
  for (const [index, op] of input.ops.entries()) {
    const opCtx: Ctx = { ...ctx, tool: `batch.${op.op}`, requestId: ctx.requestId ? `${ctx.requestId}:${index}` : undefined };
    try {
      results.push(await writeTx(db, p, opCtx, (tx, emit) => runOp(tx, emit, p, op, opCtx, versions)));
      applied++;
    } catch (e) {
      if (e instanceof ToolError) results.push({ error: e.code, status: e.status, ...e.detail });
      else throw e;
    }
  }
  return { applied, results };
}
