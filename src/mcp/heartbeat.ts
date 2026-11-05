import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Identity } from "../auth/tokens.js";
import type { Db } from "../db/client.js";
import { listHeartbeatRuns, wakeAgent } from "../jobs/heartbeat.js";
import type { Ctx } from "./tx.js";

// PLA-I26: manual wake and the heartbeat log. One registration point for register.ts.

type WriteCtx = (
  tool: string,
  input: { actor: { agent?: string; session_id: string; machine?: string; model?: string }; request_id?: string; verbose?: boolean },
  identity: Identity | undefined,
) => Ctx;

export const registerHeartbeatTools = (
  server: McpServer,
  host: {
    db: Db;
    identity: Identity | undefined;
    writeCtx: WriteCtx;
    actor: z.ZodType;
    request_id: z.ZodType;
    run: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
    readOnly: { readOnlyHint: true; openWorldHint: false };
    write: { readOnlyHint: false; destructiveHint: false; openWorldHint: false };
  },
): void => {
  const { db, identity, writeCtx, actor, request_id, run, readOnly, write } = host;

  server.registerTool(
    "wake_agent",
    {
      description: [
        "Wake one roster agent through its adapter when its heartbeat is due.",
        "A second call inside heartbeat_minutes writes nothing.",
        "dry_run returns before any socket or process and does not record a run.",
        "Pass task_key to wake that Ready ticket, or omit it and Plania picks Ready work for this owner or role.",
      ].join(" "),
      inputSchema: {
        actor,
        request_id,
        agent: z.string().min(1).describe("Roster slug"),
        task_key: z.string().optional().describe("Ready ticket key. Omit to pick one"),
        dry_run: z.boolean().optional().describe("Do not open a socket or process and do not record a run"),
      },
      annotations: write,
    },
    (raw) =>
      run(() => {
        const body = raw as {
          actor: { agent?: string; session_id: string; machine?: string; model?: string };
          request_id?: string;
          agent: string;
          task_key?: string;
          dry_run?: boolean;
        };
        writeCtx("wake_agent", body, identity);
        return wakeAgent(db, { agent: body.agent, taskKey: body.task_key, dryRun: body.dry_run });
      }),
  );

  server.registerTool(
    "list_heartbeat_runs",
    {
      description: [
        "Recent heartbeat runs: agent, status, adapter, summary and task key, newest first.",
        "Filter by roster slug. Summaries do not include adapter config.",
      ].join(" "),
      inputSchema: {
        agent: z.string().optional().describe("Roster slug"),
        limit: z.number().int().min(1).max(100).optional().describe("How many runs, newest first. Default 50"),
      },
      annotations: readOnly,
    },
    (raw) => run(() => listHeartbeatRuns(db, raw as { agent?: string; limit?: number })),
  );
};
